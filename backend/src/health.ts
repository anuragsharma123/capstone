// Scheduled liveness check — periodically re-pings every registered
// server and marks the dead ones. In-process interval timer, matching
// this prototype's "no external services" posture (same reasoning as the
// embedded Postgres and the in-memory KMS).
//
// A connected server is pinged WITH its stored credential attached (fetch
// → decrypt → use for this one call → drop, via getConnectionAuth()) —
// otherwise a server that gates tools/list behind auth (e.g. the real
// github-mcp-server) would read as permanently dead despite being fine.
// An unconnected server still gets an unauthenticated ping; if it genuinely
// needs auth just to list tools, it will legitimately read 'dead' until
// someone connects it — nothing to authenticate with yet.
import { getPool } from "./db.js";
import { listTools, McpDiscoveryError } from "./mcpClient.js";
import { attachAuth } from "./authSpec.js";
import { getConnectionAuth, touchConnectionUsage } from "./services/registry.js";
import { DEFAULT_OWNER_ID } from "./tenancy.js";

const CHECK_INTERVAL_MS = 60_000;

async function checkOne(server: { id: string; address: string }): Promise<void> {
  const pool = getPool();
  const auth = await getConnectionAuth(server.id).catch(() => null);
  const attachment = auth ? attachAuth(auth.authSpec, auth.values) : undefined;

  // A connected server that comes back 401/403 is reachable — it's the
  // credential that's bad, not the server. Report that as the connection
  // going 'expired' rather than marking the whole server 'dead'.
  let status: "ok" | "dead" = "dead";
  try {
    await listTools(server.address, attachment);
    status = "ok";
    if (auth) await touchConnectionUsage(server.id, "ok");
  } catch (err) {
    const authRejected = auth && err instanceof McpDiscoveryError && (err.status === 401 || err.status === 403);
    if (authRejected) {
      status = "ok";
      await touchConnectionUsage(server.id, "auth_rejected");
    } else {
      // Never silent — 'dead' with no reason logged is undebuggable. Message
      // only (McpDiscoveryError.message never contains the credential value).
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`health check: ${server.address} -> dead (${reason})`);
    }
  }
  await pool.query("UPDATE mcp_servers SET status = $1, last_checked_at = now() WHERE id = $2", [status, server.id]);
}

async function checkAll(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; address: string }>(
    "SELECT id, address FROM mcp_servers WHERE owner_id = $1",
    [DEFAULT_OWNER_ID]
  );
  // Sequential, not Promise.all — this is a low-frequency background job,
  // not a latency-sensitive path; no need to burst-fetch every server at once.
  for (const server of rows) {
    await checkOne(server).catch((err) => console.error(`health check failed for ${server.id}:`, err));
  }
}

/** Starts the periodic health check. Fire-and-forget — errors are logged, never thrown to the caller. */
export function startHealthChecker(): void {
  setInterval(() => void checkAll(), CHECK_INTERVAL_MS).unref();
}
