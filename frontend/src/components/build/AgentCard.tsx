import { Link } from "react-router-dom";
import type { AgentConfigDoc } from "../../lib/api";

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

/**
 * The one "built agent" card — same component regardless of which build flow
 * produced it. Shape/Schedule/Score reflect what's actually built today, not
 * the eventual target: graph.type is always "sequential" (Rule 8's
 * coordinator_specialist isn't built), there's no schedule/trigger concept
 * yet (DESIGN-NOTES §2.11), and a score only exists after publish
 * (services/scoring.ts) — never fabricated as a placeholder number here.
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
            Sequential <span className="vis-badge">single-agent</span>
          </dd>
        </div>
        <div className="agent-fact">
          <dt>Tools</dt>
          <dd className="agent-fact-tools">
            {config.tools.map((t) => (
              <code key={t.tool_name}>
                {serverSlug(t.server_name)}.{t.tool_name}
              </code>
            ))}
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
