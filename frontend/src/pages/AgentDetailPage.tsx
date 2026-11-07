import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAgentDetail, downloadPostmanCollection, publishAgentVersion, API_BASE, ApiError, type LatestReview } from "../lib/api";
import { formatShortDate, formatRelativeTime } from "../lib/format";
import AgentCard from "../components/build/AgentCard";
import AgentPlayground from "../components/AgentPlayground";

// agent_versions.status only ever holds 'draft' | 'in_review' | 'published' —
// a review decision that isn't 'approved' reverts the version straight back
// to 'draft', it doesn't have its own status here (services/review.ts).
// `latestReview` (services/agents.ts, a join through review_submissions)
// is what makes "sends it back to the author with notes" actually true
// from the author's side — without it the notes exist only in the DB.
function publishStatusNote(status: string): string | null {
  if (status === "in_review") return "Submitted — waiting on Admin Review.";
  if (status === "published") return "Published — live in the Marketplace.";
  return null;
}

function reviewDecisionLabel(status: string): string {
  if (status === "changes_requested") return "Changes requested";
  if (status === "rejected") return "Rejected";
  return status.replace("_", " ");
}

function runStatusLabel(status: string): string {
  if (status === "interrupted") return "Awaiting approval";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return status;
}

/** One agent's full config (as the same AgentCard the Build flow shows) plus every run it's had — the "click through" destination from AgentsPage, and what makes a webhook-triggered run (nobody watching it live) reviewable after the fact. */
export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgentDetail(agentId!),
    enabled: Boolean(agentId),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishAgentVersion(detailQuery.data!.agentVersionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent", agentId] }),
  });

  if (detailQuery.isLoading) return <div className="empty-state">Loading…</div>;
  if (detailQuery.isError) {
    return <div className="empty-state">{detailQuery.error instanceof ApiError ? detailQuery.error.message : "Couldn't load this agent."}</div>;
  }
  const detail = detailQuery.data;
  if (!detail) return null;

  const statusNote = publishStatusNote(detail.status);
  const showDecisionNotice: LatestReview | null =
    detail.status === "draft" && detail.latestReview && ["changes_requested", "rejected"].includes(detail.latestReview.status)
      ? detail.latestReview
      : null;

  return (
    <>
      <div className="page-head">
        <Link to="/agents" className="connect-link">
          ← My Agents
        </Link>
      </div>

      <AgentCard config={detail.config} status={detail.status} effectivenessScore={detail.effectivenessScore} safetyScore={detail.safetyScore} showActions={false} />

      <section className="panel" style={{ marginTop: 20 }} id="playground-panel">
        <div className="panel-head">
          <h3>Playground</h3>
        </div>
        <div className="panel-body">
          <AgentPlayground
            agentVersionId={detail.agentVersionId}
            onRunCompleted={() => queryClient.invalidateQueries({ queryKey: ["agent", agentId] })}
          />
        </div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Publish</h3>
        </div>
        <div className="panel-body">
          {showDecisionNotice && (
            <div className="review-decision-notice">
              <strong>{reviewDecisionLabel(showDecisionNotice.status)}</strong>
              {showDecisionNotice.decidedAt && <span className="muted-cell"> · {formatRelativeTime(showDecisionNotice.decidedAt)}</span>}
              {showDecisionNotice.notes && <p>{showDecisionNotice.notes}</p>}
            </div>
          )}
          {detail.status === "draft" ? (
            <>
              <p className="agent-description">
                Scores, sanitizes (strips server ids, credentials, and your own system prompt), and sends this version to Admin Review.
              </p>
              <button type="button" className="primary" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
                {publishMutation.isPending ? "Publishing…" : "Publish"}
              </button>
              {publishMutation.isError && (
                <p className="connect-error" style={{ marginTop: 8 }}>
                  {publishMutation.error instanceof ApiError ? publishMutation.error.message : "Couldn't publish this agent."}
                </p>
              )}
            </>
          ) : (
            <p className="agent-description">{statusNote}</p>
          )}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>API</h3>
          <button type="button" className="connect-link" onClick={() => downloadPostmanCollection(detail.agentVersionId)}>
            Download Postman Collection
          </button>
        </div>
        <div className="panel-body">
          <p className="agent-description">Call this agent directly — no browser needed. The collection also includes the resume-a-paused-run request, and a webhook example if this agent is webhook-triggered.</p>
          <pre className="api-snippet">{`curl -X POST ${API_BASE}/api/agents/${detail.agentVersionId}/run \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "..."}'`}</pre>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Run history</h3>
          <span className="count">{detail.runs.length}</span>
        </div>
        <div className="panel-body">
          {detail.runs.length === 0 ? (
            <div className="empty-state">No runs yet — test it in the Playground above, or trigger it via its webhook.</div>
          ) : (
            <table className="connections-table">
              <thead>
                <tr>
                  <th>Asked</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {detail.runs.map((r) => (
                  <tr key={r.threadId}>
                    <td>{r.triggerMessage ? r.triggerMessage.slice(0, 120) : <span className="muted-cell">—</span>}</td>
                    <td>
                      <span className={`status-chip ${r.status === "interrupted" ? "expired" : "active"}`}>{runStatusLabel(r.status)}</span>
                    </td>
                    <td>{r.outputPreview ?? <span className="muted-cell">—</span>}</td>
                    <td className="muted-cell" title={formatShortDate(r.createdAt)}>
                      {formatRelativeTime(r.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
