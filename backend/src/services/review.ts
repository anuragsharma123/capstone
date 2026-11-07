// Admin Review + Marketplace listing. review_submissions/marketplace are
// deliberately RLS-exempt (DESIGN-NOTES §2.5, cross-tenant by design) —
// these queries never scope by owner_id/tenant_id, on purpose. The real
// `is_admin` gate (users.is_admin, requireAdmin middleware) lives at the
// route layer (routes/publish.ts), not here — these functions don't need
// to know who's calling, only whether the caller was allowed to.
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { ServiceError } from "./registry.js";
import type { SanitizedManifest } from "./sanitizer.js";

export interface ReviewSubmissionRow {
  id: string;
  /**
   * The submitting agent — a reviewer needs this to actually audit the
   * real thing (not just the sanitized manifest) and click through to it.
   * Never exposed on the Marketplace side: that listing is meant to stay
   * anonymized to a cross-tenant browser, so it deliberately carries no
   * agentId at all (see MarketplaceListing below).
   */
  agentId: string;
  sanitizedManifest: SanitizedManifest;
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
    agent_id: string;
    sanitized_manifest: SanitizedManifest;
    effectiveness_score: string;
    safety_score: string;
    status: string;
    priority: number;
    submitted_at: Date;
  }>(
    `SELECT rs.id, av.agent_id, rs.sanitized_manifest, rs.effectiveness_score, rs.safety_score, rs.status, rs.priority, rs.submitted_at
     FROM review_submissions rs
     JOIN graph_runs gr ON gr.id = rs.graph_run_id
     JOIN agent_versions av ON av.id = gr.agent_version_id
     ${status ? "WHERE rs.status = $1" : ""}
     ORDER BY rs.priority, rs.submitted_at`,
    status ? [status] : []
  );
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
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
  sanitizedManifest: SanitizedManifest;
  effectivenessScore: number;
  safetyScore: number;
  publishedAt: string;
}

export async function listMarketplace(): Promise<MarketplaceListing[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    sanitized_manifest: SanitizedManifest;
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

/**
 * One listing's own page. Deliberately the exact same `sanitized_manifest`
 * as the list view — never a richer, "more detail" version that would leak
 * anything the list already correctly withholds: who built it beyond an
 * org name, any credential/token, internal URLs or system names, or the
 * owner's own runs/threads/data. There is no second, less-sanitized query
 * this function could accidentally reach for — `marketplace` only ever
 * stores the sanitized manifest, nothing else is available to select.
 */
export async function getMarketplaceListing(id: string): Promise<MarketplaceListing> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    sanitized_manifest: SanitizedManifest;
    effectiveness_score: string;
    safety_score: string;
    published_at: Date;
  }>("SELECT * FROM marketplace WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw new ServiceError(404, "Marketplace listing not found.");
  return {
    id: row.id,
    sanitizedManifest: row.sanitized_manifest,
    effectivenessScore: Number(row.effectiveness_score),
    safetyScore: Number(row.safety_score),
    publishedAt: row.published_at.toISOString(),
  };
}
