import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listReviewSubmissions, decideReviewSubmission, ApiError, type ReviewDecision, type ReviewSubmission } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { ReviewIcon } from "../components/icons";
import AgentGridCard, { type AgentGridTag } from "../components/AgentGridCard";

const SUBMISSIONS_KEY = ["review-submissions"] as const;

function isDecidable(status: string): boolean {
  return status === "pending" || status === "in_review";
}

/**
 * The Admin Review queue — no real `is_admin` check yet (one hardcoded
 * owner stands in for both submitter and reviewer, matching the rest of
 * this prototype, see DESIGN-NOTES §2.14/§7). Once real multi-tenancy
 * lands, this page gets gated to an admin role; until then anyone who can
 * reach the app can review, which is the only thing "review" can mean with
 * a single owner. Cards link to `/agents/:agentId` (unlike Marketplace) —
 * a reviewer needs to see the real agent, not just its sanitized manifest.
 */
export default function AdminReviewPage() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const submissionsQuery = useQuery({ queryKey: SUBMISSIONS_KEY, queryFn: () => listReviewSubmissions() });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: ReviewDecision }) => decideReviewSubmission(id, decision, notes[id]),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUBMISSIONS_KEY }),
  });

  const submissions = submissionsQuery.data ?? [];

  return (
    <>
      <div className="page-head">
        <h2>Admin Review</h2>
        <p>Every agent submitted for publish — sanitized (no server ids, no credentials, no system prompt), scored, and waiting on a decision.</p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Submissions</h3>
          <span className="count">{submissions.length}</span>
        </div>
        <div className="panel-body">
          {submissionsQuery.isLoading ? (
            <div className="empty-state">Loading…</div>
          ) : submissionsQuery.isError ? (
            <div className="empty-state">
              {submissionsQuery.error instanceof ApiError ? submissionsQuery.error.message : "Couldn't load the review queue."}
            </div>
          ) : submissions.length === 0 ? (
            <div className="empty-state">
              <ReviewIcon />
              Nothing submitted yet — publish an agent from its detail page to see it here.
            </div>
          ) : (
            <div className="agent-grid">
              {submissions.map((s) => (
                <ReviewCard
                  key={s.id}
                  submission={s}
                  notes={notes[s.id] ?? ""}
                  onNotesChange={(v) => setNotes((n) => ({ ...n, [s.id]: v }))}
                  onDecide={(decision) => decideMutation.mutate({ id: s.id, decision })}
                  pending={decideMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ReviewCard({
  submission,
  notes,
  onNotesChange,
  onDecide,
  pending,
}: {
  submission: ReviewSubmission;
  notes: string;
  onNotesChange: (value: string) => void;
  onDecide: (decision: ReviewDecision) => void;
  pending: boolean;
}) {
  const m = submission.sanitizedManifest;
  const decidable = isDecidable(submission.status);
  const tags: AgentGridTag[] = m.capabilities.map((c) => ({ key: c.toolName, label: c.toolName, variant: c.sensitivity as AgentGridTag["variant"] }));

  return (
    <AgentGridCard
      href={`/agents/${submission.agentId}`}
      name={m.name}
      status={submission.status}
      statusLabel={submission.status.replace("_", " ")}
      description={m.description}
      tags={tags}
      effectivenessScore={submission.effectivenessScore}
      safetyScore={submission.safetyScore}
      meta={`priority ${submission.priority} · submitted ${formatRelativeTime(submission.submittedAt)}`}
      actions={
        decidable ? (
          <div className="review-card-actions">
            <textarea
              className="review-notes"
              placeholder="Notes for the submitter (optional)…"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
            <div className="review-card-buttons">
              <button type="button" className="primary" onClick={() => onDecide("approved")} disabled={pending}>
                Approve
              </button>
              <button type="button" onClick={() => onDecide("changes_requested")} disabled={pending}>
                Request changes
              </button>
              <button type="button" className="danger" onClick={() => onDecide("rejected")} disabled={pending}>
                Reject
              </button>
            </div>
          </div>
        ) : (
          <p className="muted-cell">Decided — {submission.status.replace("_", " ")}.</p>
        )
      }
    />
  );
}
