// Scoring Engine (Rule 6, DESIGN-NOTES §2.12) — a pure function over the
// config, no LLM. Called by the Publish flow (publish.ts) at submit time;
// deliberately not a build graph node yet (score_agent isn't built —
// tracked as a gap in DESIGN-NOTES §7), so this is the whole Engine for now.
import type { AgentConfigDoc } from "./builder.js";

export interface ScoreBreakdown {
  effectiveness: { toolCoverage: number; promptQuality: number; modelTier: number; graphComplexity: number; schedule: number };
  safety: { writeGated: number; destructiveGated: number; noCredsInConfig: number; readOnlyRatio: number };
}

export interface ScoreResult {
  effectiveness: number;
  safety: number;
  breakdown: ScoreBreakdown;
}

// A credential-shaped string landing in the config would itself violate
// Rule 3 — tools are referenced by id, never a value — so this is a
// last-resort check, not the primary defense.
const CREDENTIAL_PATTERN = /sk-[a-z0-9]|api[_-]?key|bearer\s|password|secret/i;

export function score(config: AgentConfigDoc): ScoreResult {
  const tools = config.tools;
  const serverCount = new Set(tools.map((t) => t.mcp_server_id)).size;

  const toolCoverage = Math.min(serverCount * 10, 30);
  // Crude, deterministic proxy for "a real system prompt vs. a placeholder" — length alone, capped.
  const promptQuality = Math.min(Math.round(config.system_prompt.trim().length / 20), 25);
  // Per agent-builder-data-flow.html's worked example: sonnet and opus both
  // score 20 (top tier), haiku 10, anything else 5.
  const modelTier = /opus|sonnet/i.test(config.model) ? 20 : /haiku/i.test(config.model) ? 10 : 5;
  // `graph.type` is always "sequential" today — coordinator_specialist
  // (Rule 8) isn't built yet, so there's no higher-complexity case to score
  // against. No schedule/trigger concept exists either (§2.11 lists it
  // open) — both honest fixed values, not fabricated variation.
  const graphComplexity = 10;
  const schedule = 0;
  const effectiveness = Math.round(toolCoverage + promptQuality + modelTier + graphComplexity + schedule);

  const writeTools = tools.filter((t) => t.sensitivity === "write");
  const destructiveTools = tools.filter((t) => t.sensitivity === "destructive");
  const readTools = tools.filter((t) => t.sensitivity === "read");

  const writeGated = writeTools.length === 0 ? 40 : (writeTools.filter((t) => t.require_approval).length / writeTools.length) * 40;
  const destructiveGated =
    destructiveTools.length === 0 ? 10 : (destructiveTools.filter((t) => t.require_approval).length / destructiveTools.length) * 30;
  const noCredsInConfig = CREDENTIAL_PATTERN.test(JSON.stringify(config)) ? 0 : 20;
  const readOnlyRatio = tools.length === 0 ? 0 : (readTools.length / tools.length) * 10;
  const safety = Math.round(writeGated + destructiveGated + noCredsInConfig + readOnlyRatio);

  return {
    effectiveness,
    safety,
    breakdown: {
      effectiveness: { toolCoverage, promptQuality, modelTier, graphComplexity, schedule },
      safety: { writeGated, destructiveGated, noCredsInConfig, readOnlyRatio },
    },
  };
}
