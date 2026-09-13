// Business logic — routes stay thin and call these.
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { classifyTool } from "../classify.js";
import { encryptToken, decryptToken } from "../crypto.js";
import { listTools, McpDiscoveryError } from "../mcpClient.js";
import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from "../tenancy.js";
import { splitAuthValues, attachAuth, type AuthSpec } from "../authSpec.js";
import { IMPLEMENTED_TRANSPORTS, type Transport } from "../transport.js";

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface ServerCreateInput {
  name: string;
  transport: Transport;
  address: string;
  visibility: "open" | "private";
  /**
   * Describes the SHAPE of the credential this server needs — never a
   * value. Registration is discovery-only; the registrant fills this in
   * because real MCP servers don't advertise it themselves (DESIGN-NOTES
   * §2.7). Read-only after registration.
   */
  authSpec?: AuthSpec;
  /**
   * A credential value used ONLY to authenticate the one discovery call
   * below — for a server that requires auth just to answer `tools/list`
   * (e.g. the real github-mcp-server, unlike WorkingServer's mock). Never
   * written to `connections` or anywhere else; falls out of scope the
   * moment this function returns. Storing a credential is still exclusively
   * the Connect step's job (DESIGN-NOTES §2.7 addendum, 2026-09-11).
   */
  discoveryValues?: Record<string, string>;
}

export interface ToolOut {
  name: string;
  description: string | null;
  sensitivity: string;
  sensitivitySource: string;
}

export interface ServerOut {
  id: string;
  name: string;
  transport: string;
  address: string;
  visibility: string;
  authSpec: AuthSpec | null;
  connected: boolean;
  /** Set by the periodic health check (health.ts) — 'ok' | 'dead' | 'unknown' until the first check runs. */
  status: string;
  lastCheckedAt: string | null;
  createdAt: string;
  /** When the credential currently on file was stored — null when not connected. */
  connectedAt: string | null;
  /** Last time the stored credential was actually attached to an outgoing call (health.ts today; the Run lane later) — null if never. */
  lastUsedAt: string | null;
  /** 'active' | 'expired' (credential rejected by the server with 401/403 on last use) — null when not connected. */
  connectionStatus: "active" | "expired" | null;
  tools: ToolOut[];
}

export async function registerServer(input: ServerCreateInput): Promise<ServerOut> {
  const pool = getPool();

  const existing = await pool.query("SELECT id FROM mcp_servers WHERE owner_id = $1 AND address = $2", [
    DEFAULT_OWNER_ID,
    input.address,
  ]);
  if ((existing.rowCount ?? 0) > 0) throw new ServiceError(409, "That address is already registered.");

  if (!IMPLEMENTED_TRANSPORTS.includes(input.transport)) {
    throw new ServiceError(400, `Transport '${input.transport}' isn't implemented yet — only streamable_http is.`);
  }

  // Auth attachment for discovery only — built and discarded in this scope.
  // Not the same thing as a stored connection: nothing here ever reaches
  // `connections` or `storeConnection()`.
  const discoveryAuth =
    input.authSpec && input.discoveryValues ? attachAuth(input.authSpec, input.discoveryValues) : undefined;

  let discovered;
  try {
    discovered = await listTools(input.address, discoveryAuth);
  } catch (err) {
    if (err instanceof McpDiscoveryError) throw new ServiceError(400, err.message);
    throw err;
  }

  const serverId = randomUUID();
  await pool.query(
    `INSERT INTO mcp_servers (id, owner_id, tenant_id, name, transport, address, visibility, auth_spec, status, last_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ok', now())`,
    [
      serverId,
      DEFAULT_OWNER_ID,
      DEFAULT_TENANT_ID,
      input.name || input.address,
      input.transport,
      input.address,
      input.visibility,
      input.authSpec ? JSON.stringify(input.authSpec) : null,
    ]
  );

  for (const tool of discovered) {
    const { sensitivity, source } = classifyTool(tool.name, tool.description, tool.annotations);
    await pool.query(
      `INSERT INTO mcp_tools (id, server_id, owner_id, tenant_id, name, description, sensitivity, sensitivity_source, annotations, input_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        serverId,
        DEFAULT_OWNER_ID,
        DEFAULT_TENANT_ID,
        tool.name,
        tool.description ?? null,
        sensitivity,
        source,
        tool.annotations ? JSON.stringify(tool.annotations) : null,
        tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
      ]
    );
  }

  return getServerOrThrow(serverId);
}

export async function listServers(): Promise<ServerOut[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM mcp_servers WHERE owner_id = $1 ORDER BY created_at",
    [DEFAULT_OWNER_ID]
  );
  const out: ServerOut[] = [];
  for (const row of rows) out.push(await getServerOrThrow(row.id));
  return out;
}

export async function deleteServer(serverId: string): Promise<void> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM mcp_servers WHERE id = $1 AND owner_id = $2", [
    serverId,
    DEFAULT_OWNER_ID,
  ]);
  if ((result.rowCount ?? 0) === 0) throw new ServiceError(404, "Server not found.");
}

/** Removes the stored credential without removing the server itself — the server just goes back to "not connected". */
export async function removeConnection(serverId: string): Promise<ServerOut> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM connections WHERE server_id = $1 AND owner_id = $2", [
    serverId,
    DEFAULT_OWNER_ID,
  ]);
  if ((result.rowCount ?? 0) === 0) throw new ServiceError(404, "No connection on file for that server.");
  return getServerOrThrow(serverId);
}

/**
 * The reactive path: attach or replace a credential on an already-registered
 * server. Same entry point the future build-time gate will call — one
 * connections table, two entry points, never at registration.
 */
export async function addConnection(serverId: string, values: Record<string, string>): Promise<ServerOut> {
  const pool = getPool();
  const { rows } = await pool.query<{ address: string; auth_spec: AuthSpec | null }>(
    "SELECT address, auth_spec FROM mcp_servers WHERE id = $1 AND owner_id = $2",
    [serverId, DEFAULT_OWNER_ID]
  );
  if (!rows[0]) throw new ServiceError(404, "Server not found.");
  const { address, auth_spec: authSpec } = rows[0];
  if (!authSpec) {
    throw new ServiceError(400, "This server has no authentication defined — nothing to connect.");
  }

  // Verify connectivity with the submitted credential before storing
  // anything — same discovery call registration used, now authenticated.
  try {
    await listTools(address, attachAuth(authSpec, values));
  } catch (err) {
    if (err instanceof McpDiscoveryError) throw new ServiceError(400, `Token rejected — ${err.message}`);
    throw err;
  }

  await storeConnection(serverId, authSpec, values);
  return getServerOrThrow(serverId);
}

/** Splits values per the server's auth_spec, encrypts the secret ones, stores the rest as plain config. */
async function storeConnection(serverId: string, authSpec: AuthSpec, values: Record<string, string>): Promise<void> {
  const pool = getPool();
  const { secretValues, configValues } = splitAuthValues(authSpec, values);
  const { ciphertext, wrappedDek } = encryptToken(JSON.stringify(secretValues));
  const config = JSON.stringify(configValues);

  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM connections WHERE owner_id = $1 AND server_id = $2",
    [DEFAULT_OWNER_ID, serverId]
  );
  if (existing.rows[0]) {
    // Reconnecting with a fresh credential clears any prior 'expired' mark
    // immediately, rather than waiting for the next health tick to notice.
    await pool.query(
      "UPDATE connections SET ciphertext = $1, wrapped_dek = $2, config = $3, status = 'active' WHERE id = $4",
      [ciphertext, wrappedDek, config, existing.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO connections (id, owner_id, tenant_id, server_id, ciphertext, wrapped_dek, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), DEFAULT_OWNER_ID, DEFAULT_TENANT_ID, serverId, ciphertext, wrappedDek, config]
    );
  }
}

/**
 * Fetch → decrypt → return, for a caller that needs to make ONE authenticated
 * call right now and then drop it — currently the health checker (health.ts),
 * pinging a server that gates tools/list behind auth. Same envelope-decrypt
 * path a real tool call will use once the Run lane exists (DESIGN-NOTES
 * §2.13); this is that pattern's first real caller, not a new one.
 */
export async function getConnectionAuth(
  serverId: string
): Promise<{ authSpec: AuthSpec; values: Record<string, string> } | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    auth_spec: AuthSpec | null;
    ciphertext: Buffer;
    wrapped_dek: Buffer;
    config: Record<string, string> | null;
  }>(
    `SELECT s.auth_spec, c.ciphertext, c.wrapped_dek, c.config
     FROM connections c JOIN mcp_servers s ON s.id = c.server_id
     WHERE c.server_id = $1 AND c.owner_id = $2`,
    [serverId, DEFAULT_OWNER_ID]
  );
  const row = rows[0];
  if (!row || !row.auth_spec) return null;

  const secretValues = JSON.parse(decryptToken(row.ciphertext, row.wrapped_dek)) as Record<string, string>;
  return { authSpec: row.auth_spec, values: { ...secretValues, ...row.config } };
}

/**
 * Records that a stored credential was just attached to an outgoing call —
 * the health checker's periodic ping today, the same call site a real tool
 * invocation will use once the Run lane exists. `result` distinguishes a
 * server-side auth rejection (401/403 — the connection's `status` flips to
 * 'expired') from a normal use (`status` stays/returns to 'active').
 * No-ops if the connection was removed since the call that triggered it.
 */
export async function touchConnectionUsage(serverId: string, result: "ok" | "auth_rejected"): Promise<void> {
  const pool = getPool();
  const status = result === "auth_rejected" ? "expired" : "active";
  await pool.query("UPDATE connections SET last_used_at = now(), status = $1 WHERE server_id = $2 AND owner_id = $3", [
    status,
    serverId,
    DEFAULT_OWNER_ID,
  ]);
}

async function getServerOrThrow(serverId: string): Promise<ServerOut> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    name: string;
    transport: string;
    address: string;
    visibility: string;
    auth_spec: AuthSpec | null;
    status: string;
    last_checked_at: Date | null;
    created_at: Date;
  }>(
    "SELECT id, name, transport, address, visibility, auth_spec, status, last_checked_at, created_at FROM mcp_servers WHERE id = $1 AND owner_id = $2",
    [serverId, DEFAULT_OWNER_ID]
  );
  const server = rows[0];
  if (!server) throw new ServiceError(404, "Server not found.");

  const { rows: tools } = await pool.query<{
    name: string;
    description: string | null;
    sensitivity: string;
    sensitivity_source: string;
  }>(
    "SELECT name, description, sensitivity, sensitivity_source FROM mcp_tools WHERE server_id = $1 ORDER BY name",
    [serverId]
  );

  const { rows: connRows } = await pool.query<{
    created_at: Date;
    last_used_at: Date | null;
    status: string;
  }>("SELECT created_at, last_used_at, status FROM connections WHERE owner_id = $1 AND server_id = $2", [
    DEFAULT_OWNER_ID,
    serverId,
  ]);
  const connection = connRows[0];

  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    address: server.address,
    visibility: server.visibility,
    authSpec: server.auth_spec,
    connected: !!connection,
    status: server.status,
    lastCheckedAt: server.last_checked_at ? server.last_checked_at.toISOString() : null,
    createdAt: server.created_at.toISOString(),
    connectedAt: connection ? connection.created_at.toISOString() : null,
    lastUsedAt: connection?.last_used_at ? connection.last_used_at.toISOString() : null,
    connectionStatus: connection ? (connection.status as "active" | "expired") : null,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      sensitivity: t.sensitivity,
      sensitivitySource: t.sensitivity_source,
    })),
  };
}
