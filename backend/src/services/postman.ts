// Rule 7 — "every agent gets an endpoint." The endpoint itself already
// exists (POST /api/agents/:versionId/run, used by the Playground all
// session); what was missing was anything making that endpoint discoverable
// to an external caller who isn't reading this codebase. This module turns
// one agent's config into a real, importable Postman Collection v2.1 doc —
// no placeholder screenshots, an actual file Postman can open and run.
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID } from "../tenancy.js";
import { ServiceError } from "./registry.js";
import type { AgentConfigDoc } from "./builder.js";

function slugFilename(name: string): string {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent"}.postman_collection.json`;
}

function jsonBody(value: unknown) {
  return { mode: "raw", raw: JSON.stringify(value, null, 2), options: { raw: { language: "json" } } };
}

export interface PostmanCollectionResult {
  filename: string;
  collection: Record<string, unknown>;
}

export async function buildPostmanCollection(agentVersionId: string, baseUrl: string): Promise<PostmanCollectionResult> {
  const pool = getPool();
  const { rows } = await pool.query<{ config: AgentConfigDoc }>(
    "SELECT config FROM agent_versions WHERE id = $1 AND owner_id = $2",
    [agentVersionId, DEFAULT_OWNER_ID]
  );
  const config = rows[0]?.config;
  if (!config) throw new ServiceError(404, "Agent version not found.");

  const runItem = {
    name: "Run agent",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: "{{baseUrl}}/api/agents/{{agentVersionId}}/run",
      body: jsonBody({ message: "Ask the agent to do something." }),
      description:
        "Starts a fresh run. Returns { status: 'completed', output } right away, or " +
        "{ status: 'interrupted', threadId, hitlRequest } if a write/destructive tool " +
        "needs your approval first (Rule 4) — copy that threadId into the {{threadId}} " +
        "variable and use the Resume request below.",
    },
  };

  const resumeItem = {
    name: "Resume a paused run (approve / reject)",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: "{{baseUrl}}/api/agents/runs/{{threadId}}/resume",
      body: jsonBody({ decisions: [{ type: "approve" }] }),
      description: "Only valid while {{threadId}} is a run currently paused on an approval gate. Set decisions[].type to 'reject' to decline instead.",
    },
  };

  const webhookItem =
    config.trigger.type === "webhook"
      ? {
          name: "Trigger via webhook (external event)",
          request: {
            method: "POST",
            header: [
              { key: "Content-Type", value: "application/json" },
              {
                key: "X-Hub-Signature-256",
                value: "sha256=<hex HMAC-SHA256 of the raw request body, using this agent's own webhook secret>",
                description:
                  "This agent's secret was generated at build time (agent_versions.config.trigger.secret) and never shown again after — " +
                  "compute the signature server-side when wiring this up to a real sender (e.g. GitHub's own webhook delivery already does this for you).",
              },
            ],
            url: "{{baseUrl}}/api/webhooks/{{agentVersionId}}",
            body: jsonBody({
              ref: "refs/heads/main",
              commits: [{ id: "abc1234", message: "example commit", author: { name: "Your Name" } }],
              repository: { full_name: "you/example-repo", html_url: "https://github.com/you/example-repo" },
            }),
            description: `Configured trigger: ${config.trigger.detail || "webhook"}. Responds 202 immediately; the run happens in the background — poll GET {{baseUrl}}/api/agents/runs/pending or check the agent's run history in My Agents.`,
          },
        }
      : null;

  const collection = {
    info: {
      name: `${config.name} — Data Sense API`,
      description: config.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: baseUrl },
      { key: "agentVersionId", value: agentVersionId },
      { key: "threadId", value: "", description: "Filled in from a Run response once it pauses for approval." },
    ],
    item: [runItem, resumeItem, ...(webhookItem ? [webhookItem] : [])],
  };

  return { filename: slugFilename(config.name), collection };
}
