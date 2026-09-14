import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listAgents, ApiError } from "../lib/api";
import { formatRelativeTime, scoreGrade } from "../lib/format";
import { AgentsIcon } from "../components/icons";

function statusLabel(status: string): string {
  if (status === "published") return "live";
  return status.replace("_", " ");
}

/** Every agent this owner has ever built, newest first — one card per agent (its latest version), with a run-count/last-run summary pulled from graph_runs. Click through for the full config + run history. */
export default function AgentsPage() {
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const agents = agentsQuery.data ?? [];

  return (
    <>
      <div className="page-head">
        <h2>My Agents</h2>
        <p>Every agent you've built through the platform — its shape, score, and run history.</p>
      </div>

      {agentsQuery.isLoading ? (
        <div className="empty-state">Loading…</div>
      ) : agentsQuery.isError ? (
        <div className="empty-state">{agentsQuery.error instanceof ApiError ? agentsQuery.error.message : "Couldn't load agents."}</div>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          <AgentsIcon />
          No agents yet — build one from the Build page.
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((a) => {
            const metaParts = [
              a.triggerDetail,
              `${a.runCount} run${a.runCount === 1 ? "" : "s"}`,
              a.lastRunAt ? formatRelativeTime(a.lastRunAt) : "Never run",
            ].filter(Boolean);
            return (
              <Link to={`/agents/${a.agentId}`} className="agent-list-card" key={a.agentId}>
                <div className="agent-list-card-head">
                  <span className="agent-list-card-name">{a.name}</span>
                  <span className={`status-chip ${a.status}`}>{statusLabel(a.status)}</span>
                </div>
                <p className="agent-list-card-desc">{a.description}</p>
                <div className="agent-list-card-tags">
                  {a.serverNames.map((s) => (
                    <span className="tag-chip" key={s}>
                      {s.toLowerCase()}
                    </span>
                  ))}
                  {a.graphType === "coordinator_specialist" && <span className="tag-chip accent">multi-agent</span>}
                </div>
                <div className="agent-list-card-score">
                  <span className="score-label">Score</span>
                  <span className="score-number">{a.effectivenessScore ?? "—"}</span>
                  <span className="score-grade">{a.effectivenessScore !== null ? scoreGrade(a.effectivenessScore) : "C"}</span>
                </div>
                <div className="agent-list-card-meta">{metaParts.join(" · ")}</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
