// Tool sensitivity classification — read / write / destructive.
//
// Same fail-safe order as the platform's classify() design (DESIGN-NOTES
// §2.8, connection-data-flow.html, and AnuragFrontend's classifySensitivity):
// an MCP annotation is trusted only when it makes a tool MORE restrictive
// (the MCP spec says annotations are hints, not to be relied on for
// security), then a name/description heuristic, then a fail-safe default
// of "write" — never a silent "read".

export type Sensitivity = "read" | "write" | "destructive";
export type SensitivitySource = "annotation" | "heuristic" | "default";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export function classifyTool(
  name: string,
  description: string | undefined,
  annotations: ToolAnnotations | undefined
): { sensitivity: Sensitivity; source: SensitivitySource } {
  const a = annotations ?? {};
  if (a.destructiveHint === true) return { sensitivity: "destructive", source: "annotation" };
  if (a.readOnlyHint === true) return { sensitivity: "read", source: "annotation" };
  if (a.readOnlyHint === false) return { sensitivity: "write", source: "annotation" };

  const text = `${name} ${description ?? ""}`.toLowerCase();
  if (/delete|remove|drop|purge|revoke|wipe|destroy/.test(text)) {
    return { sensitivity: "destructive", source: "heuristic" };
  }
  if (/create|update|insert|post|send|add|set|write|patch|upload/.test(text)) {
    return { sensitivity: "write", source: "heuristic" };
  }
  if (/list|get|search|read|fetch|query|describe|show|find/.test(text)) {
    return { sensitivity: "read", source: "heuristic" };
  }

  return { sensitivity: "write", source: "default" };
}
