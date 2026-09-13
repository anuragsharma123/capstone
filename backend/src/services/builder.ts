// Agent Config Store — writes the config document the Build Orchestrator
// produced (DESIGN-NOTES §2.11), plus graph_runs (data-model.html), which
// tracks every place the build graph pauses. One `agents` row (the stable
// identity) and one `agent_versions` row (the actual document, version 1)
// are only written once both pauses have cleared — nothing is persisted at
// either pause itself.
import { randomUUID, randomBytes } from "node:crypto";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from "../tenancy.js";
import {
  startBuild,
  resumeBuild,
  type MatchedTool,
  type ConfirmedToolRef,
  type CredentialSubmission,
  type BuildPause,
} from "../build/graph.js";
import { ServiceError } from "./registry.js";

export interface AgentConfigTool {
  mcp_server_id: string;
  /** Display-only — never used for tool wiring or auth, only so a UI can group by server without a second lookup. */
  server_name: string;
  tool_name: string;
  sensitivity: string;
  require_approval: boolean;
}

export interface AgentTrigger {
  type: "webhook" | "schedule" | "manual";
  detail: string;
  /**
   * Only for type='webhook' — generated in code (randomBytes), never chosen
   * by the LLM, same "code decides security-relevant values" discipline as
   * require_approval (Rule 4). Verifies POST /api/webhooks/:versionId via
   * HMAC-SHA256 (routes/webhooks.ts), the same scheme GitHub itself uses
   * (X-Hub-Signature-256) — so a real GitHub repo can point at this
   * endpoint directly. Returned once in the build-completion response so
   * the caller can configure it at the sender; not a stored third-party
   * credential, so Rule 3's "never returned" doesn't apply to it.
   */
  secret?: string;
}

/** One delegated role in a coordinator_specialist graph (Rule 8). Never carries a gated (non-read) tool — run/runtime.ts only puts humanInTheLoopMiddleware on the coordinator, so a specialist holding a write/destructive tool would bypass Rule 4. Enforced in code below, not left to the model's tool picks. */
export interface SpecialistConfig {
  name: string;
  description: string;
  system_prompt: string;
  tools: AgentConfigTool[];
}

export type AgentGraph = { type: "sequential" } | { type: "coordinator_specialist"; specialists: SpecialistConfig[] };

export interface AgentConfigDoc {
  schema_version: 1;
  name: string;
  description: string;
  model: string;
  system_prompt: string;
  graph: AgentGraph;
  /** The coordinator's own tools when graph.type is coordinator_specialist — what IT calls directly, distinct from each specialist's own tools nested in graph.specialists. */
  tools: AgentConfigTool[];
  interrupt_before: string[];
  /**
   * What starts a run — classified from the request, not defaulted to a
   * schedule. `webhook` is real: POST /api/webhooks/:versionId (routes/webhooks.ts)
   * verifies `secret` and runs the agent. `schedule` is still description-only
   * — no cron executor exists yet, so a schedule-classified agent still only
   * runs when invoked directly (Playground or the webhook endpoint).
   */
  trigger: AgentTrigger;
}

export type BuildStartResult = BuildPause & { threadId: string };

export interface BuildResumeCompleted {
  status: "completed";
  agentId: string;
  agentVersionId: string;
  config: AgentConfigDoc;
}

export type BuildResumeResult = BuildPause | BuildResumeCompleted;

/** Kicks off a build thread from a free-text prompt; always pauses at present_tools for confirmation. */
export async function startAgentBuild(prompt: string): Promise<BuildStartResult> {
  const threadId = randomUUID();
  const pause = await startBuild(threadId, prompt);

  const pool = getPool();
  await pool.query(
    `INSERT INTO graph_runs (id, owner_id, tenant_id, kind, thread_id, status, interrupt_kind, interrupt_payload)
     VALUES ($1, $2, $3, 'build', $4, 'interrupted', $5, $6)`,
    [randomUUID(), DEFAULT_OWNER_ID, DEFAULT_TENANT_ID, threadId, pause.interruptKind, JSON.stringify(pause)]
  );

  return { ...pause, threadId };
}

/** Resumes a paused build thread. Body shape must match the thread's current interrupt_kind — checked below, not left to the caller. */
export async function resumeAgentBuild(
  threadId: string,
  body: { confirmedTools?: ConfirmedToolRef[]; credentials?: CredentialSubmission[] }
): Promise<BuildResumeResult> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; interrupt_kind: string }>(
    "SELECT id, interrupt_kind FROM graph_runs WHERE thread_id = $1 AND owner_id = $2 AND status = 'interrupted'",
    [threadId, DEFAULT_OWNER_ID]
  );
  const run = rows[0];
  if (!run) throw new ServiceError(404, "No paused build found for that thread.");

  let resumeValue: ConfirmedToolRef[] | CredentialSubmission[];
  if (run.interrupt_kind === "select_servers") {
    if (!body.confirmedTools) throw new ServiceError(400, "This build is paused at tool selection — send confirmedTools.");
    resumeValue = body.confirmedTools;
  } else if (run.interrupt_kind === "add_connection") {
    if (!body.credentials) throw new ServiceError(400, "This build is paused on a missing connection — send credentials.");
    resumeValue = body.credentials;
  } else {
    throw new ServiceError(500, `Unrecognized interrupt_kind on graph_runs: ${run.interrupt_kind}`);
  }

  const result = await resumeBuild(threadId, resumeValue);

  if (result.status === "interrupted") {
    await pool.query(
      "UPDATE graph_runs SET interrupt_kind = $1, interrupt_payload = $2, updated_at = now() WHERE id = $3",
      [result.interruptKind, JSON.stringify(result), run.id]
    );
    return result;
  }

  // Code decides tool wiring, sensitivity, and the approval gate — copied
  // straight from the registry, never the model's opinion (Rule 4). The
  // human's confirmation only prunes this set; it can't add to it.
  const toAgentConfigTool = (t: MatchedTool): AgentConfigTool => ({
    mcp_server_id: t.mcpServerId,
    server_name: t.serverName,
    tool_name: t.toolName,
    sensitivity: t.sensitivity,
    require_approval: t.sensitivity !== "read",
  });

  let graph: AgentGraph;
  let coordinatorTools: AgentConfigTool[];

  if (result.parsed.graph.type === "sequential") {
    coordinatorTools = result.confirmedTools.map(toAgentConfigTool);
    graph = { type: "sequential" };
  } else {
    // Partition confirmed tools by role. A gated (non-read) tool tagged for
    // a specialist is reassigned to the coordinator instead of honored as
    // that specialist's own — run/runtime.ts only ever puts
    // humanInTheLoopMiddleware on the coordinator, so a specialist holding
    // a write/destructive tool would silently bypass Rule 4. This is the
    // structural fix, not a fallback: risky actions are always the
    // coordinator's job by design (DESIGN-NOTES §2.14's sibling decision
    // for Rule 8).
    const coordinatorConfirmed: MatchedTool[] = [];
    const bySpecialist = new Map<string, MatchedTool[]>();
    for (const t of result.confirmedTools) {
      if (t.role === "coordinator" || t.sensitivity !== "read") {
        coordinatorConfirmed.push(t);
      } else {
        const list = bySpecialist.get(t.role) ?? [];
        list.push(t);
        bySpecialist.set(t.role, list);
      }
    }

    coordinatorTools = coordinatorConfirmed.map(toAgentConfigTool);
    const specialists: SpecialistConfig[] = result.parsed.graph.specialists.map((s) => ({
      name: s.name,
      description: s.description,
      system_prompt: s.system_prompt,
      tools: (bySpecialist.get(s.name) ?? []).map(toAgentConfigTool),
    }));
    graph = { type: "coordinator_specialist", specialists };
  }

  const config: AgentConfigDoc = {
    schema_version: 1,
    name: result.parsed.name,
    description: result.parsed.description,
    model: "claude-sonnet-5",
    system_prompt: result.parsed.system_prompt,
    graph,
    tools: coordinatorTools,
    interrupt_before: coordinatorTools.filter((t) => t.require_approval).map((t) => t.tool_name),
    trigger:
      result.parsed.trigger.type === "webhook"
        ? { ...result.parsed.trigger, secret: randomBytes(24).toString("hex") }
        : result.parsed.trigger,
  };

  const agentId = randomUUID();
  const agentVersionId = randomUUID();

  await pool.query("INSERT INTO agents (id, owner_id, tenant_id, name) VALUES ($1, $2, $3, $4)", [
    agentId,
    DEFAULT_OWNER_ID,
    DEFAULT_TENANT_ID,
    result.parsed.name,
  ]);
  await pool.query(
    `INSERT INTO agent_versions (id, agent_id, owner_id, tenant_id, version, config, status)
     VALUES ($1, $2, $3, $4, 1, $5, 'draft')`,
    [agentVersionId, agentId, DEFAULT_OWNER_ID, DEFAULT_TENANT_ID, JSON.stringify(config)]
  );
  await pool.query(
    `UPDATE graph_runs
     SET status = 'completed', agent_version_id = $1, interrupt_kind = NULL, interrupt_payload = NULL, updated_at = now()
     WHERE id = $2`,
    [agentVersionId, run.id]
  );

  return { status: "completed", agentId, agentVersionId, config };
}
