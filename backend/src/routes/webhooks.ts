// The execution half of trigger.type === 'webhook' (services/builder.ts
// classifies it; this actually runs it). Verifies GitHub's own signature
// scheme (HMAC-SHA256 over the raw request body, X-Hub-Signature-256) so
// the endpoint isn't open to anyone who finds the URL — the per-agent
// `secret` was generated in code at build time, never chosen by the model.
import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID } from "../tenancy.js";
import { startAgentRun } from "../services/runner.js";
import type { AgentConfigDoc } from "../services/builder.js";

export const router = Router();

function verifySignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  // timingSafeEqual throws on a length mismatch rather than returning false —
  // check that first so a malformed header can't crash the request.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

interface GithubCommit {
  id?: string;
  message?: string;
  author?: { name?: string };
}

/**
 * Turns a GitHub push payload into the message the agent actually sees.
 * Includes `repository.full_name` — a real push payload always has it, and
 * without it the agent has no way to know which repo this is about except
 * by asking or guessing (which is exactly what happened testing this
 * manually in the Playground, where nobody supplies that field by hand).
 * Falls back to the raw JSON for anything that isn't shaped like a push
 * event, so an unrecognized webhook still reaches the agent instead of
 * silently no-op'ing.
 */
function describePayload(payload: unknown): string {
  if (payload && typeof payload === "object" && "commits" in payload && Array.isArray((payload as { commits: unknown }).commits)) {
    const p = payload as { ref?: string; commits: GithubCommit[]; repository?: { full_name?: string; html_url?: string } };
    const branch = typeof p.ref === "string" ? p.ref.replace(/^refs\/heads\//, "") : "an unknown branch";
    const repo = p.repository?.full_name ? ` in ${p.repository.full_name}` : "";
    const repoUrl = p.repository?.html_url ? ` (${p.repository.html_url})` : "";
    if (p.commits.length === 0) return `A push event was received for branch "${branch}"${repo}${repoUrl} with no commit details attached.`;
    const lines = p.commits.map((c) => `- ${(c.id ?? "").slice(0, 7) || "?"} by ${c.author?.name ?? "unknown"}: ${c.message ?? "(no message)"}`);
    return `A webhook reported ${p.commits.length} new commit(s) pushed to branch "${branch}"${repo}${repoUrl}:\n${lines.join("\n")}\n\nHandle this per your instructions.`;
  }
  return `A webhook fired with this payload:\n${JSON.stringify(payload).slice(0, 2000)}\n\nHandle this per your instructions.`;
}

router.post("/api/webhooks/:agentVersionId", async (req: Request, res: Response) => {
  const pool = getPool();
  const { rows } = await pool.query<{ config: AgentConfigDoc }>(
    "SELECT config FROM agent_versions WHERE id = $1 AND owner_id = $2",
    [req.params.agentVersionId, DEFAULT_OWNER_ID]
  );
  const config = rows[0]?.config;
  if (!config) {
    res.status(404).json({ error: "Agent version not found." });
    return;
  }
  if (config.trigger.type !== "webhook" || !config.trigger.secret) {
    res.status(400).json({ error: "This agent isn't configured for webhook triggering." });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-hub-signature-256");
  if (!rawBody || !verifySignature(config.trigger.secret, rawBody, signature)) {
    res.status(401).json({ error: "Invalid or missing signature." });
    return;
  }

  const message = describePayload(req.body);

  // Respond before running — a webhook sender times out around 10s, an
  // LLM + tool-call run can easily take longer, and (per Rule 4) it may
  // need to pause for human approval anyway. The run itself is checked
  // later via GET /api/agents/runs/pending, not this response.
  res.status(202).json({ status: "accepted" });

  startAgentRun(req.params.agentVersionId, message).catch((err) => {
    console.error(`webhook-triggered run failed for agent version ${req.params.agentVersionId}:`, err);
  });
});
