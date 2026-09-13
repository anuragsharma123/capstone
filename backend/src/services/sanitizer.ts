// Sanitizer (Rule 5) — what leaves the tenant boundary on publish. Strips
// owner/credential-adjacent references (mcp_server_id, the raw system_prompt
// — where planted confidential material would live) down to design-only
// facts: name, description, model, graph shape, and each tool's name +
// sensitivity. Never the tool's server, never a credential, never prose the
// owner wrote for themselves.
import type { AgentConfigDoc } from "./builder.js";

export interface SanitizedCapability {
  toolName: string;
  sensitivity: string;
}

export interface SanitizedManifest {
  name: string;
  description: string;
  model: string;
  graphType: string;
  capabilities: SanitizedCapability[];
}

export function sanitize(config: AgentConfigDoc): SanitizedManifest {
  return {
    name: config.name,
    description: config.description,
    model: config.model,
    graphType: config.graph.type,
    capabilities: config.tools.map((t) => ({ toolName: t.tool_name, sensitivity: t.sensitivity })),
  };
}
