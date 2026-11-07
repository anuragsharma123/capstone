// Marketplace → Install. "Add to my workspace" copies the agent's real,
// runnable config into a brand-new agents/agent_versions row — never the
// sanitized manifest (services/sanitizer.ts), which is missing exactly the
// things a copy needs to actually run (mcp_server_id wiring, system_prompt).
// This is safe because the config never held a credential to begin with
// (Rule 3): tools are referenced by mcp_server_id, resolved to whichever
// connection the *running* owner has on file, at call time. Cloning the
// config therefore can never copy a credential, by construction — there
// isn't one in there to copy.
//
// With real multi-tenancy, the clone's tools still reference the
// *original* owner's mcp_server_id rows until the installer reconnects
// them to their own registry — "supply your own credentials" isn't fully
// exercised by this alone; what IS real: the clone is a structurally
// independent agents/agent_versions row (own id, own run history,
// editable/deletable without touching the source), owned by the
// installer, not the publisher.
import { randomUUID, randomBytes } from "node:crypto";
import { getPool, withTenant, type TenantAuth } from "../db.js";
import { ServiceError } from "./registry.js";
import type { AgentConfigDoc } from "./builder.js";

export interface InstallResult {
  agentId: string;
  agentVersionId: string;
}

export async function installFromMarketplace(installer: TenantAuth, marketplaceId: string): Promise<InstallResult> {
  // Deliberately the plain pool, not withTenant(installer, ...): this read
  // crosses into the *original publisher's* agent_versions row by design —
  // the whole point of Install. Scoping it to the installer's own session
  // vars would (once RLS is on) make it see nothing, since the row isn't
  // theirs. Same category as the webhook lookup and the health checker: a
  // deliberate, narrow bypass of per-request tenant scoping, not a gap in
  // it — everything this function *writes* below is correctly scoped to
  // the installer via withTenant.
  const pool = getPool();
  const { rows } = await pool.query<{ config: AgentConfigDoc }>(
    `SELECT av.config
     FROM marketplace m
     JOIN review_submissions rs ON rs.id = m.review_submission_id
     JOIN graph_runs gr ON gr.id = rs.graph_run_id
     JOIN agent_versions av ON av.id = gr.agent_version_id
     WHERE m.id = $1`,
    [marketplaceId]
  );
  const original = rows[0]?.config;
  if (!original) throw new ServiceError(404, "Marketplace listing not found.");

  const config: AgentConfigDoc = {
    ...original,
    name: `${original.name} (installed)`,
    // A webhook secret is per-deployment, not part of the design being
    // shared — the installed copy gets its own, never the publisher's.
    trigger: original.trigger.type === "webhook" ? { ...original.trigger, secret: randomBytes(24).toString("hex") } : original.trigger,
  };

  const agentId = randomUUID();
  const agentVersionId = randomUUID();
  await withTenant(installer, async (client) => {
    await client.query("INSERT INTO agents (id, owner_id, tenant_id, name) VALUES ($1, $2, $3, $4)", [
      agentId,
      installer.userId,
      installer.tenantId,
      config.name,
    ]);
    await client.query(
      `INSERT INTO agent_versions (id, agent_id, owner_id, tenant_id, version, config, status)
       VALUES ($1, $2, $3, $4, 1, $5, 'draft')`,
      [agentVersionId, agentId, installer.userId, installer.tenantId, JSON.stringify(config)]
    );
  });

  return { agentId, agentVersionId };
}
