// Real MCP discovery — POST { jsonrpc, method: "tools/list" } over
// Streamable HTTP, stateless. Registration calls this with no auth
// (discovery-only — DESIGN-NOTES §3 Q&A: a credential value is only ever
// entered at the Connect screen or the build-time gate). Connect calls it
// again WITH the just-submitted credential attached, purely as a
// connectivity check — same call, no separate "test" endpoint needed.
// Handles both plain-JSON and SSE-framed ("event: message\ndata: {...}")
// responses, since which one a given server returns depends on its own
// implementation.
import type { ToolAnnotations } from "./classify.js";

export interface McpTool {
  name: string;
  description?: string;
  annotations?: ToolAnnotations;
  inputSchema?: unknown;
}

export interface AuthAttachment {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

export class McpDiscoveryError extends Error {
  /** The upstream HTTP status, when the failure came from a non-OK response — lets a caller tell "credential rejected" (401/403) apart from "unreachable". */
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

function parseMcpResponse<T>(raw: string): {
  result?: T;
  error?: { message?: string };
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/^data:\s*(.+)$/m);
  if (match) return JSON.parse(match[1]);
  throw new McpDiscoveryError("Unrecognized response — is that address an MCP server?");
}

function withQueryParams(address: string, params: Record<string, string> | undefined): string {
  if (!params || Object.keys(params).length === 0) return address;
  const url = new URL(address);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function listTools(address: string, auth?: AuthAttachment): Promise<McpTool[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...auth?.headers,
  };
  const url = withQueryParams(address, auth?.queryParams);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new McpDiscoveryError(`Couldn't reach ${address} — is it running, and does it allow this request?`);
  }

  const raw = await res.text();
  if (!res.ok) throw new McpDiscoveryError(`Server responded ${res.status}.`, res.status);

  const json = parseMcpResponse<{ tools?: McpTool[] }>(raw);
  if (json.error) throw new McpDiscoveryError(json.error.message ?? "The server reported an MCP error.");

  const tools = json.result?.tools ?? [];
  if (tools.length === 0) throw new McpDiscoveryError("Connected, but the server reported no tools.");
  return tools;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** The Agent Runtime's tool-execution call — same JSON-RPC shape as listTools, `tools/call` instead of `tools/list`. A longer timeout than discovery: a real tool (send an email, query an API) can run longer than a liveness ping. */
export async function callTool(
  address: string,
  toolName: string,
  args: Record<string, unknown>,
  auth?: AuthAttachment
): Promise<McpToolCallResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...auth?.headers,
  };
  const url = withQueryParams(address, auth?.queryParams);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new McpDiscoveryError(`Couldn't reach ${address} to call '${toolName}'.`);
  }

  const raw = await res.text();
  if (!res.ok) throw new McpDiscoveryError(`Server responded ${res.status} calling '${toolName}'.`, res.status);

  const json = parseMcpResponse<McpToolCallResult>(raw);
  if (json.error) throw new McpDiscoveryError(json.error.message ?? "The server reported an MCP error.");
  if (!json.result) throw new McpDiscoveryError(`'${toolName}' returned no result.`);
  return json.result;
}
