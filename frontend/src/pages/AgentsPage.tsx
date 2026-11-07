import { useQuery } from "@tanstack/react-query";
import { listAgents, ApiError } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { AgentsIcon } from "../components/icons";
import AgentGridCard, { type AgentGridTag } from "../components/AgentGridCard";

function statusLabel(status: string): string {
  if (status === "published") return "live";
  return status.replace("_", " ");
}

/**
 * Every agent this owner has ever built, newest first — one card per agent
 * (its latest version), with a run-count/last-run summary pulled from
 * graph_runs. Click through for the full config + run history.
 *
 * Isolation note (Rule 2): `GET /api/agents` already filters
 * `WHERE owner_id = $1` server-side (services/agents.ts) — there is no
 * unfiltered "all agents" query this page could accidentally widen. Right
 * now that filter runs against one hardcoded owner (tenancy.ts), so it
 * can't yet be verified against a *second* real user — but the shape is
 * already there: swapping in the authenticated user's id needs zero query
 * changes once real auth exists. Until then this is honestly "structurally
 * ready," not "isolated and proven," per DESIGN-NOTES §7.
 */
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
            const tags: AgentGridTag[] = a.serverNames.map((s) => ({ key: s, label: s.toLowerCase() }));
            if (a.graphType === "coordinator_specialist") tags.push({ key: "multi-agent", label: "multi-agent", variant: "accent" });
            return (
              <AgentGridCard
                key={a.agentId}
                href={`/agents/${a.agentId}`}
                name={a.name}
                status={a.status}
                statusLabel={statusLabel(a.status)}
                description={a.description}
                tags={tags}
                effectivenessScore={a.effectivenessScore}
                safetyScore={a.safetyScore}
                meta={metaParts.join(" · ")}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
