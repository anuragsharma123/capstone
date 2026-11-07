// "My Agents" list + agent detail + run history. Read-only over tables the
// Build/Run/Publish lanes already write — this module adds no new writes of
// its own. Every build so far produces exactly one agent_versions row per
// agent (no edit path yet), but the query still takes the highest `version`
// per agent rather than assuming that, so it keeps working once editing
// exists.
import { withTenant, type TenantAuth } from "../db.js";
import { ServiceError } from "./registry.js";
import type { AgentConfigDoc } from "./builder.js";

export interface AgentSummary {
  agentId: string;
  agentVersionId: string;
  name: string;
  description: string;
  status: string;
  graphType: "sequential" | "coordinator_specialist";
  specialistCount: number;
  toolCount: number;
  /** Distinct MCP server names this agent touches (coordinator + every specialist), for the card view's tag chips. */
  serverNames: string[];
  triggerType: string;
  /** Only meaningful when triggerType === 'schedule' — the LLM-authored cadence text (e.g. "Weekdays 08:00"). Not actually wired to a cron executor yet (see DESIGN-NOTES §7). */
  triggerDetail: string | null;
  effectivenessScore: number | null;
  safetyScore: number | null;
  createdAt: string;
  runCount: number;
  lastRunAt: string | null;
}

function allToolsOf(config: AgentConfigDoc): AgentConfigDoc["tools"] {
  if (config.graph?.type !== "coordinator_specialist") return config.tools;
  return [...config.tools, ...config.graph.specialists.flatMap((s) => s.tools)];
}

function toolCountFor(config: AgentConfigDoc): number {
  return allToolsOf(config).length;
}

function serverNamesOf(config: AgentConfigDoc): string[] {
  return Array.from(new Set(allToolsOf(config).map((t) => t.server_name))).sort();
}

export async function listAgents(auth: TenantAuth): Promise<AgentSummary[]> {
  return withTenant(auth, async (client) => {
    const { rows } = await client.query<{
      agent_id: string;
      agent_version_id: string;
      config: AgentConfigDoc;
      status: string;
      effectiveness_score: string | null;
      safety_score: string | null;
      created_at: Date;
    }>(
      `SELECT DISTINCT ON (a.id)
         a.id AS agent_id, a.created_at,
         av.id AS agent_version_id, av.config, av.status, av.effectiveness_score, av.safety_score
       FROM agents a
       JOIN agent_versions av ON av.agent_id = a.id
       WHERE a.owner_id = $1
       ORDER BY a.id, av.version DESC`,
      [auth.userId]
    );

    const versionIds = rows.map((r) => r.agent_version_id);
    const runStats = new Map<string, { count: number; lastRunAt: string | null }>();
    if (versionIds.length > 0) {
      const { rows: statRows } = await client.query<{ agent_version_id: string; run_count: string; last_run_at: Date | null }>(
        `SELECT agent_version_id, COUNT(*) AS run_count, MAX(updated_at) AS last_run_at
         FROM graph_runs
         WHERE owner_id = $1 AND kind = 'playground' AND agent_version_id = ANY($2)
         GROUP BY agent_version_id`,
        [auth.userId, versionIds]
      );
      for (const s of statRows) {
        runStats.set(s.agent_version_id, { count: Number(s.run_count), lastRunAt: s.last_run_at?.toISOString() ?? null });
      }
    }

    return rows
      .map((r) => {
        const stats = runStats.get(r.agent_version_id) ?? { count: 0, lastRunAt: null };
        return {
          agentId: r.agent_id,
          agentVersionId: r.agent_version_id,
          name: r.config.name,
          description: r.config.description,
          status: r.status,
          graphType: r.config.graph?.type ?? "sequential",
          specialistCount: r.config.graph?.type === "coordinator_specialist" ? r.config.graph.specialists.length : 0,
          toolCount: toolCountFor(r.config),
          serverNames: serverNamesOf(r.config),
          triggerType: r.config.trigger?.type ?? "manual",
          triggerDetail: r.config.trigger?.type === "schedule" ? r.config.trigger.detail || null : null,
          effectivenessScore: r.effectiveness_score !== null ? Number(r.effectiveness_score) : null,
          safetyScore: r.safety_score !== null ? Number(r.safety_score) : null,
          createdAt: r.created_at.toISOString(),
          runCount: stats.count,
          lastRunAt: stats.lastRunAt,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export interface RunSummary {
  threadId: string;
  status: string;
  triggerMessage: string | null;
  outputPreview: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The most recent Admin Review decision on this agent, if it's ever been
 * submitted — specifically so "Request changes sends it back to the author
 * with notes" is actually true from the author's side, not just true in
 * the review_submissions row nobody reads. Only ever the latest one: an
 * agent can be resubmitted after changes, and the older decision stops
 * being the relevant one to show.
 */
export interface LatestReview {
  status: string;
  notes: string | null;
  decidedAt: string | null;
}

export interface AgentDetail {
  agentId: string;
  agentVersionId: string;
  config: AgentConfigDoc;
  status: string;
  effectivenessScore: number | null;
  safetyScore: number | null;
  scoreBreakdown: unknown | null;
  createdAt: string;
  runs: RunSummary[];
  latestReview: LatestReview | null;
}

export async function getAgentDetail(auth: TenantAuth, agentId: string): Promise<AgentDetail> {
  return withTenant(auth, async (client) => {
    const { rows } = await client.query<{
      agent_version_id: string;
      config: AgentConfigDoc;
      status: string;
      effectiveness_score: string | null;
      safety_score: string | null;
      score_breakdown: unknown | null;
      created_at: Date;
    }>(
      `SELECT av.id AS agent_version_id, av.config, av.status, av.effectiveness_score, av.safety_score, av.score_breakdown, a.created_at
       FROM agents a
       JOIN agent_versions av ON av.agent_id = a.id
       WHERE a.id = $1 AND a.owner_id = $2
       ORDER BY av.version DESC
       LIMIT 1`,
      [agentId, auth.userId]
    );
    const row = rows[0];
    if (!row) throw new ServiceError(404, "Agent not found.");

    const { rows: reviewRows } = await client.query<{ status: string; decision_notes: string | null; decided_at: Date | null }>(
      `SELECT rs.status, rs.decision_notes, rs.decided_at
       FROM review_submissions rs
       JOIN graph_runs gr ON gr.id = rs.graph_run_id
       WHERE gr.agent_version_id = $1
       ORDER BY rs.submitted_at DESC
       LIMIT 1`,
      [row.agent_version_id]
    );
    const latestReview: LatestReview | null = reviewRows[0]
      ? { status: reviewRows[0].status, notes: reviewRows[0].decision_notes, decidedAt: reviewRows[0].decided_at?.toISOString() ?? null }
      : null;

    const { rows: runRows } = await client.query<{
      thread_id: string;
      status: string;
      trigger_message: string | null;
      result: { output?: string } | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT thread_id, status, trigger_message, result, created_at, updated_at
       FROM graph_runs
       WHERE agent_version_id = $1 AND owner_id = $2 AND kind = 'playground'
       ORDER BY created_at DESC`,
      [row.agent_version_id, auth.userId]
    );

    return {
      agentId,
      agentVersionId: row.agent_version_id,
      config: row.config,
      status: row.status,
      effectivenessScore: row.effectiveness_score !== null ? Number(row.effectiveness_score) : null,
      safetyScore: row.safety_score !== null ? Number(row.safety_score) : null,
      scoreBreakdown: row.score_breakdown,
      createdAt: row.created_at.toISOString(),
      runs: runRows.map((r) => ({
        threadId: r.thread_id,
        status: r.status,
        triggerMessage: r.trigger_message,
        outputPreview: r.result?.output ? r.result.output.slice(0, 280) : null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      latestReview,
    };
  });
}
