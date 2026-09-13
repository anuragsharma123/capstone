// Talks to AnuragBackend's REST API. Discovery, tool classification, and
// credential storage all happen server-side now — this file no longer
// speaks MCP directly. Pure functions only; no React here (per the
// project's coding rules — components don't own fetch/transform logic).

export type Sensitivity = "read" | "write" | "destructive";
export type Visibility = "open" | "private";
export type AuthType = "bearer" | "header" | "basic" | "query";
export type ServerStatus = "ok" | "dead" | "unknown";
export type Transport = "streamable_http" | "sse" | "stdio";
/** Only streamable_http is actually wired up server-side — the others are named honestly and rejected on submit. */
export const IMPLEMENTED_TRANSPORTS: readonly Transport[] = ["streamable_http"];

export interface ApiTool {
  name: string;
  description: string | null;
  sensitivity: Sensitivity;
  sensitivitySource: string;
}

export interface AuthField {
  key: string;
  label: string;
  help?: string;
  secret: boolean;
}

/** The SHAPE of the credential a server needs — never a value. Defined once at registration. */
export interface AuthSpec {
  type: AuthType;
  fields: AuthField[];
  headerName?: string;
  queryParam?: string;
}

export interface ApiServer {
  id: string;
  name: string;
  transport: Transport;
  address: string;
  visibility: Visibility;
  authSpec: AuthSpec | null;
  /** Whether a credential is on file for this server (added via Connect). */
  connected: boolean;
  /** Set by the periodic health check — 'unknown' until the first check runs after registration. */
  status: ServerStatus;
  lastCheckedAt: string | null;
  createdAt: string;
  /** When the credential currently on file was stored — null when not connected. */
  connectedAt: string | null;
  /** Last time the stored credential was actually attached to an outgoing call — null if never. */
  lastUsedAt: string | null;
  /** 'expired' means the server rejected the credential (401/403) on last use — null when not connected. */
  connectionStatus: "active" | "expired" | null;
  tools: ApiTool[];
}

export interface RegisterServerInput {
  name: string;
  transport: Transport;
  address: string;
  visibility: Visibility;
  /** Shape only — never stored from here. Registration is still discovery-only. */
  authSpec?: AuthSpec;
  /**
   * Used ONLY to authenticate the one discovery call — for a server that
   * demands auth just to answer tools/list. Never persisted; the server
   * still comes back `connected: false` and needs an actual Connect step
   * to be usable later.
   */
  discoveryValues?: Record<string, string>;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8001").replace(/\/+$/, "");

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(`Couldn't reach the registry backend at ${API_BASE} — is it running?`);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Request failed (${res.status}).`;
    throw new ApiError(message);
  }
  return body as T;
}

export function listServers(): Promise<ApiServer[]> {
  return request<ApiServer[]>("/api/servers");
}

export function registerServer(input: RegisterServerInput): Promise<ApiServer> {
  return request<ApiServer>("/api/servers", { method: "POST", body: JSON.stringify(input) });
}

export function deleteServer(id: string): Promise<void> {
  return request<void>(`/api/servers/${id}`, { method: "DELETE" });
}

/** The reactive path — attach or replace a credential on an already-registered server, keyed by its auth_spec field keys. */
export function addConnection(id: string, values: Record<string, string>): Promise<ApiServer> {
  return request<ApiServer>(`/api/servers/${id}/connection`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

/** Removes the stored credential — the server goes back to "not connected" without being deleted. */
export function removeConnection(id: string): Promise<ApiServer> {
  return request<ApiServer>(`/api/servers/${id}/connection`, { method: "DELETE" });
}

export function normalizeAddress(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// ---------- Agent Builder ----------

/** `role` is `"coordinator"` or a specialist's name — which agent this tool is for (Rule 8). A plain single-agent build's tools all carry `"coordinator"`. */
export interface MatchedTool {
  mcpServerId: string;
  serverName: string;
  toolName: string;
  sensitivity: Sensitivity;
  role: string;
}

/** Identifies a matched tool to keep — never carries a sensitivity or new tool of its own (server decides that, not the client). */
export interface ConfirmedToolRef {
  mcpServerId: string;
  toolName: string;
  role: string;
}

export interface MissingServer {
  mcpServerId: string;
  serverName: string;
  authSpec: AuthSpec;
}

export interface CredentialSubmission {
  mcpServerId: string;
  values: Record<string, string>;
}

export interface AgentConfigTool {
  mcp_server_id: string;
  server_name: string;
  tool_name: string;
  sensitivity: Sensitivity;
  require_approval: boolean;
}

export interface AgentTrigger {
  type: "webhook" | "schedule" | "manual";
  detail: string;
}

/** One delegated role in a coordinator_specialist graph (Rule 8). */
export interface SpecialistConfig {
  name: string;
  description: string;
  system_prompt: string;
  tools: AgentConfigTool[];
}

export type AgentGraph = { type: "sequential" } | { type: "coordinator_specialist"; specialists: SpecialistConfig[] };

export interface AgentConfigDoc {
  schema_version: 1;
  name: string;
  description: string;
  model: string;
  system_prompt: string;
  graph: AgentGraph;
  /** The coordinator's own tools when graph.type is coordinator_specialist — distinct from each specialist's own tools nested in graph.specialists. */
  tools: AgentConfigTool[];
  interrupt_before: string[];
  trigger: AgentTrigger;
}

export type BuildOutcome =
  | { status: "interrupted"; interruptKind: "select_servers"; matchedTools: MatchedTool[] }
  | { status: "interrupted"; interruptKind: "add_connection"; missingServers: MissingServer[] }
  | { status: "completed"; agentId: string; agentVersionId: string; config: AgentConfigDoc };

export type BuildStartResult = BuildOutcome & { threadId: string };

export function startBuild(prompt: string): Promise<BuildStartResult> {
  return request<BuildStartResult>("/api/agents/build", { method: "POST", body: JSON.stringify({ prompt }) });
}

export function resumeBuildTools(threadId: string, confirmedTools: ConfirmedToolRef[]): Promise<BuildOutcome> {
  return request<BuildOutcome>(`/api/agents/build/${threadId}/resume`, {
    method: "POST",
    body: JSON.stringify({ confirmedTools }),
  });
}

export function resumeBuildCredentials(threadId: string, credentials: CredentialSubmission[]): Promise<BuildOutcome> {
  return request<BuildOutcome>(`/api/agents/build/${threadId}/resume`, {
    method: "POST",
    body: JSON.stringify({ credentials }),
  });
}

// ---------- Agent Runtime / Playground ----------

export interface HitlActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface HitlReviewConfig {
  actionName: string;
  allowedDecisions: Array<"approve" | "edit" | "reject">;
}

export interface HitlRequest {
  actionRequests: HitlActionRequest[];
  reviewConfigs: HitlReviewConfig[];
}

export type Decision = { type: "approve" } | { type: "reject"; message?: string };

export type RunOutcome = { status: "interrupted"; hitlRequest: HitlRequest } | { status: "completed"; output: string };

export type RunStartResult = RunOutcome & { threadId: string };

export function runAgent(agentVersionId: string, message: string): Promise<RunStartResult> {
  return request<RunStartResult>(`/api/agents/${agentVersionId}/run`, { method: "POST", body: JSON.stringify({ message }) });
}

export function resumeRun(threadId: string, decisions: Decision[]): Promise<RunOutcome> {
  return request<RunOutcome>(`/api/agents/runs/${threadId}/resume`, { method: "POST", body: JSON.stringify({ decisions }) });
}
