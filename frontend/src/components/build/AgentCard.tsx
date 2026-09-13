import { Link } from "react-router-dom";
import type { AgentConfigDoc, AgentConfigTool } from "../../lib/api";

interface Props {
  config: AgentConfigDoc;
}

function serverSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function approvalsSummary(interruptBefore: string[]): string {
  if (interruptBefore.length === 0) return "Runs fully autonomously — no approval gates.";
  return `Asks before ${interruptBefore.join(", ")}.`;
}

function triggerSummary(trigger: AgentConfigDoc["trigger"]): string {
  if (trigger.type === "webhook") return `Webhook — ${trigger.detail || "reacts to an external event"}`;
  if (trigger.type === "schedule") return `Schedule — ${trigger.detail || "recurring"}`;
  return "Not scheduled — runs on demand";
}

function shapeSummary(graph: AgentConfigDoc["graph"]): string {
  if (graph.type === "sequential") return "Sequential";
  return `Coordinator with ${graph.specialists.length} specialist${graph.specialists.length === 1 ? "" : "s"}`;
}

function toolChip(t: AgentConfigTool) {
  return (
    <code key={`${t.mcp_server_id}:${t.tool_name}`}>
      {serverSlug(t.server_name)}.{t.tool_name}
    </code>
  );
}

/**
 * The one "built agent" card — same component regardless of which build
 * flow produced it. Shape reflects the real graph (Rule 8's
 * coordinator_specialist is built — run/runtime.ts actually executes it).
 * Score stays "not tested yet": it only exists after publish
 * (services/scoring.ts), never fabricated as a placeholder number here.
 */
export default function AgentCard({ config }: Props) {
  return (
    <div className="agent-card">
      <div className="agent-card-head">
        <div className="agent-card-name">{config.name}</div>
        <span className="status-chip draft">draft</span>
      </div>
      <p className="agent-description">{config.description}</p>

      <dl className="agent-card-facts">
        <div className="agent-fact">
          <dt>Shape</dt>
          <dd>
            {shapeSummary(config.graph)}{" "}
            <span className="vis-badge">{config.graph.type === "sequential" ? "single-agent" : "multi-agent"}</span>
          </dd>
        </div>
        <div className="agent-fact">
          <dt>Tools</dt>
          <dd className="agent-fact-tools">
            {config.graph.type === "sequential" ? (
              config.tools.map(toolChip)
            ) : (
              <>
                {config.tools.length > 0 && (
                  <div className="agent-fact-role">
                    <span className="agent-fact-role-label">coordinator</span>
                    {config.tools.map(toolChip)}
                  </div>
                )}
                {config.graph.specialists.map((s) => (
                  <div className="agent-fact-role" key={s.name}>
                    <span className="agent-fact-role-label">{s.name}</span>
                    {s.tools.length > 0 ? s.tools.map(toolChip) : <span className="agent-fact-role-empty">reasoning only</span>}
                  </div>
                ))}
              </>
            )}
          </dd>
        </div>
        <div className="agent-fact">
          <dt>Approvals</dt>
          <dd>{approvalsSummary(config.interrupt_before)}</dd>
        </div>
        <div className="agent-fact">
          <dt>Trigger</dt>
          <dd>
            {triggerSummary(config.trigger)}
            {config.trigger.type !== "manual" && <span className="vis-badge">not wired up yet</span>}
          </dd>
        </div>
        <div className="agent-fact">
          <dt>Score</dt>
          <dd>not tested yet</dd>
        </div>
      </dl>

      <div className="agent-card-actions">
        <a href="#playground-panel" className="connect-link">
          Open the playground
        </a>
        <Link to="/agents" className="connect-link">
          Go to My Agents
        </Link>
      </div>
    </div>
  );
}
