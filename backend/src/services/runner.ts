// Drives the Agent Runtime (run/runtime.ts) and records every run as a
// graph_runs row (kind='playground'), same table the Build Orchestrator
// uses (data-model.html: "each keyed to a LangGraph thread_id").
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from "../tenancy.js";
import { startRun, resumeRun, type RunPaused, type RunFinished } from "../run/runtime.js";
import type { AgentConfigDoc } from "./builder.js";
import { ServiceError } from "./registry.js";
import type { Decision } from "langchain";

export type RunStartResult = (RunPaused | RunFinished) & { threadId: string };
export type RunResumeResult = RunPaused | RunFinished;

async function loadConfig(agentVersionId: string): Promise<AgentConfigDoc> {
  const pool = getPool();
  const { rows } = await pool.query<{ config: AgentConfigDoc }>(
    "SELECT config FROM agent_versions WHERE id = $1 AND owner_id = $2",
    [agentVersionId, DEFAULT_OWNER_ID]
  );
  if (!rows[0]) throw new ServiceError(404, "Agent version not found.");
  return rows[0].config;
}

export async function startAgentRun(agentVersionId: string, message: string): Promise<RunStartResult> {
  const config = await loadConfig(agentVersionId);
  const threadId = randomUUID();
  const result = await startRun(threadId, config, message);

  const pool = getPool();
  await pool.query(
    `INSERT INTO graph_runs (id, owner_id, tenant_id, agent_version_id, kind, thread_id, status, interrupt_kind, interrupt_payload, result)
     VALUES ($1, $2, $3, $4, 'playground', $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      DEFAULT_OWNER_ID,
      DEFAULT_TENANT_ID,
      agentVersionId,
      threadId,
      result.status === "interrupted" ? "interrupted" : "completed",
      result.status === "interrupted" ? "await_approval" : null,
      result.status === "interrupted" ? JSON.stringify(result) : null,
      result.status === "completed" ? JSON.stringify({ output: result.output }) : null,
    ]
  );

  return { ...result, threadId };
}

export async function resumeAgentRun(threadId: string, decisions: Decision[]): Promise<RunResumeResult> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; agent_version_id: string }>(
    "SELECT id, agent_version_id FROM graph_runs WHERE thread_id = $1 AND owner_id = $2 AND status = 'interrupted' AND kind = 'playground'",
    [threadId, DEFAULT_OWNER_ID]
  );
  const run = rows[0];
  if (!run) throw new ServiceError(404, "No paused run found for that thread.");

  const config = await loadConfig(run.agent_version_id);
  const result = await resumeRun(threadId, config, decisions);

  await pool.query(
    `UPDATE graph_runs SET status = $1, interrupt_kind = $2, interrupt_payload = $3, result = $4, updated_at = now() WHERE id = $5`,
    [
      result.status === "interrupted" ? "interrupted" : "completed",
      result.status === "interrupted" ? "await_approval" : null,
      result.status === "interrupted" ? JSON.stringify(result) : null,
      result.status === "completed" ? JSON.stringify({ output: result.output }) : null,
      run.id,
    ]
  );

  return result;
}

export interface RunDetail {
  threadId: string;
  agentVersionId: string;
  status: string;
  hitlRequest: unknown | null;
  output: string | null;
  updatedAt: string;
}

/** One run's full state, regardless of whether it's still pending or long finished — how a webhook-triggered run gets reviewed after the fact, since nothing was watching it synchronously. */
export async function getRunDetail(threadId: string): Promise<RunDetail> {
  const pool = getPool();
  const { rows } = await pool.query<{
    agent_version_id: string;
    status: string;
    interrupt_payload: { hitlRequest?: unknown } | null;
    result: { output?: string } | null;
    updated_at: Date;
  }>(
    "SELECT agent_version_id, status, interrupt_payload, result, updated_at FROM graph_runs WHERE thread_id = $1 AND owner_id = $2 AND kind = 'playground'",
    [threadId, DEFAULT_OWNER_ID]
  );
  const row = rows[0];
  if (!row) throw new ServiceError(404, "No run found for that thread.");
  return {
    threadId,
    agentVersionId: row.agent_version_id,
    status: row.status,
    hitlRequest: row.interrupt_payload?.hitlRequest ?? null,
    output: row.result?.output ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface PendingApproval {
  threadId: string;
  agentId: string;
  agentName: string;
  agentVersionId: string;
  hitlRequest: unknown;
  updatedAt: string;
}

/**
 * Every run still waiting on a human decision — regardless of how it
 * started. A webhook- or (eventually) schedule-triggered run has nobody
 * watching it complete, so without this list its approval gate would just
 * sit in graph_runs, undiscoverable. Manual Playground runs show up here
 * too; there's one interrupted-run queue, not two.
 */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    thread_id: string;
    agent_version_id: string;
    agent_id: string;
    agent_name: string;
    interrupt_payload: unknown;
    updated_at: Date;
  }>(
    `SELECT gr.thread_id, gr.agent_version_id, a.id AS agent_id, a.name AS agent_name, gr.interrupt_payload, gr.updated_at
     FROM graph_runs gr
     JOIN agent_versions av ON av.id = gr.agent_version_id
     JOIN agents a ON a.id = av.agent_id
     WHERE gr.owner_id = $1 AND gr.kind = 'playground' AND gr.status = 'interrupted'
     ORDER BY gr.updated_at`,
    [DEFAULT_OWNER_ID]
  );
  return rows.map((r) => ({
    threadId: r.thread_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    agentVersionId: r.agent_version_id,
    hitlRequest: (r.interrupt_payload as { hitlRequest?: unknown } | null)?.hitlRequest ?? r.interrupt_payload,
    updatedAt: r.updated_at.toISOString(),
  }));
}
