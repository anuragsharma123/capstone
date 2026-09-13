// Publish flow: score -> gate -> sanitize -> park in review_submissions.
// Deliberately NOT modeled as a pause inside build/graph.ts (no
// resume_outbox/worker either) — by the time an owner asks to publish, the
// build graph has already finished and the config is fully persisted as its
// own agent_versions row. Publishing is a separate, later, explicit action
// on an existing version, not a continuation of that graph's thread. See
// DESIGN-NOTES §7 for why this is a deliberate simplification, not a gap.
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from "../tenancy.js";
import { ServiceError } from "./registry.js";
import { score } from "./scoring.js";
import { sanitize } from "./sanitizer.js";
import type { AgentConfigDoc } from "./builder.js";

const EFFECTIVENESS_THRESHOLD = 60;
const SAFETY_THRESHOLD = 70;

export interface PublishResult {
  reviewSubmissionId: string;
  status: "pending";
  effectiveness: number;
  safety: number;
}

export async function publishAgentVersion(agentVersionId: string): Promise<PublishResult> {
  const pool = getPool();
  const { rows } = await pool.query<{ config: AgentConfigDoc }>(
    "SELECT config FROM agent_versions WHERE id = $1 AND owner_id = $2",
    [agentVersionId, DEFAULT_OWNER_ID]
  );
  const config = rows[0]?.config;
  if (!config) throw new ServiceError(404, "Agent version not found.");

  const { effectiveness, safety, breakdown } = score(config);
  if (effectiveness < EFFECTIVENESS_THRESHOLD || safety < SAFETY_THRESHOLD) {
    throw new ServiceError(
      400,
      `Publish blocked — effectiveness ${effectiveness}/100 (need ≥${EFFECTIVENESS_THRESHOLD}), safety ${safety}/100 (need ≥${SAFETY_THRESHOLD}).`
    );
  }

  await pool.query("UPDATE agent_versions SET effectiveness_score = $1, safety_score = $2, score_breakdown = $3, status = 'in_review' WHERE id = $4", [
    effectiveness,
    safety,
    JSON.stringify(breakdown),
    agentVersionId,
  ]);

  // graph_runs row of kind='review' — an audit trail / FK anchor for
  // review_submissions to point back at a tenant, not a live LangGraph
  // thread (nothing is actually paused here).
  const graphRunId = randomUUID();
  await pool.query(
    `INSERT INTO graph_runs (id, owner_id, tenant_id, agent_version_id, kind, thread_id, status)
     VALUES ($1, $2, $3, $4, 'review', $5, 'completed')`,
    [graphRunId, DEFAULT_OWNER_ID, DEFAULT_TENANT_ID, agentVersionId, randomUUID()]
  );

  const manifest = sanitize(config);
  const submissionId = randomUUID();
  const priority = manifest.capabilities.some((c) => c.sensitivity === "destructive") ? 10 : 100;
  await pool.query(
    `INSERT INTO review_submissions (id, graph_run_id, sanitized_manifest, effectiveness_score, safety_score, score_breakdown, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [submissionId, graphRunId, JSON.stringify(manifest), effectiveness, safety, JSON.stringify(breakdown), priority]
  );

  return { reviewSubmissionId: submissionId, status: "pending", effectiveness, safety };
}
