// Admin Review + Marketplace listing. No real admin-role check yet — there
// is exactly one hardcoded owner in this whole prototype (tenancy.ts), so
// that same owner stands in for both submitter and reviewer, matching the
// rest of the codebase's auth-deferred posture. Swapping in a real
// `users.is_admin` check later doesn't change these queries' shape.
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { ServiceError } from "./registry.js";

export interface ReviewSubmissionRow {
  id: string;
  sanitizedManifest: unknown;
  effectivenessScore: number;
  safetyScore: number;
  status: string;
  priority: number;
  submittedAt: string;
}

export async function listReviewSubmissions(status?: string): Promise<ReviewSubmissionRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    sanitized_manifest: unknown;
    effectiveness_score: string;
    safety_score: string;
    status: string;
    priority: number;
    submitted_at: Date;
  }>(
    status
      ? "SELECT * FROM review_submissions WHERE status = $1 ORDER BY priority, submitted_at"
      : "SELECT * FROM review_submissions ORDER BY priority, submitted_at",
    status ? [status] : []
  );
  return rows.map((r) => ({
    id: r.id,
    sanitizedManifest: r.sanitized_manifest,
    effectivenessScore: Number(r.effectiveness_score),
    safetyScore: Number(r.safety_score),
    status: r.status,
    priority: r.priority,
    submittedAt: r.submitted_at.toISOString(),
  }));
}

export type ReviewDecision = "approved" | "changes_requested" | "rejected";

export interface DecideResult {
  status: ReviewDecision;
  marketplaceId: string | null;
}

export async function decideReviewSubmission(submissionId: string, decision: ReviewDecision, notes?: string): Promise<DecideResult> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    graph_run_id: string;
    sanitized_manifest: unknown;
    effectiveness_score: string;
    safety_score: string;
  }>(
    `UPDATE review_submissions SET status = $1, decision_notes = $2, decided_at = now()
     WHERE id = $3 AND status IN ('pending', 'in_review')
     RETURNING id, graph_run_id, sanitized_manifest, effectiveness_score, safety_score`,
    [decision, notes ?? null, submissionId]
  );
  const submission = rows[0];
  if (!submission) throw new ServiceError(404, "No pending review submission with that id.");

  // Rule 5's "no direct-live": only an 'approved' decision ever reaches
  // marketplace. Anything else sends the owner's agent_versions row back to
  // 'draft' so it can be revised and resubmitted.
  const nextAgentVersionStatus = decision === "approved" ? "published" : "draft";
  await pool.query(
    `UPDATE agent_versions SET status = $1
     WHERE id = (SELECT agent_version_id FROM graph_runs WHERE id = $2)`,
    [nextAgentVersionStatus, submission.graph_run_id]
  );

  let marketplaceId: string | null = null;
  if (decision === "approved") {
    marketplaceId = randomUUID();
    await pool.query(
      `INSERT INTO marketplace (id, review_submission_id, sanitized_manifest, effectiveness_score, safety_score)
       VALUES ($1, $2, $3, $4, $5)`,
      [marketplaceId, submission.id, submission.sanitized_manifest, submission.effectiveness_score, submission.safety_score]
    );
  }

  return { status: decision, marketplaceId };
}

export interface MarketplaceListing {
  id: string;
  sanitizedManifest: unknown;
  effectivenessScore: number;
  safetyScore: number;
  publishedAt: string;
}

export async function listMarketplace(): Promise<MarketplaceListing[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    sanitized_manifest: unknown;
    effectiveness_score: string;
    safety_score: string;
    published_at: Date;
  }>("SELECT * FROM marketplace ORDER BY published_at DESC");
  return rows.map((r) => ({
    id: r.id,
    sanitizedManifest: r.sanitized_manifest,
    effectivenessScore: Number(r.effectiveness_score),
    safetyScore: Number(r.safety_score),
    publishedAt: r.published_at.toISOString(),
  }));
}
