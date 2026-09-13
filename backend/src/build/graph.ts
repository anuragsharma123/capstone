// Build Orchestrator — third slice (DESIGN-NOTES §4, "Run lane · Agent
// Config Store"). Five nodes, two pauses:
//   parse_intent -> search_registry -> present_tools (⏸ always)
//     -> check_connections -> request_credentials (⏸ only if a connection
//        is missing) -> end
// generate_config/score_agent/deploy are still later work — for now the
// assembled config is persisted directly once both pauses (the second one
// only when needed) have cleared.
import { StateGraph, Annotation, START, END, interrupt, isInterrupted, INTERRUPT, Command } from "@langchain/langgraph";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The zod helper needs the zod/v4 API surface specifically — separate from
// the plain `zod` (v3 API) used for request validation elsewhere (routes/).
import { z as z4 } from "zod/v4";
import { config } from "../config.js";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID } from "../tenancy.js";
import { ServiceError, addConnection } from "../services/registry.js";
import type { AuthSpec } from "../authSpec.js";
import { getCheckpointer } from "../checkpointer.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// LLM decides prose only — name/description/system_prompt/trigger. It never
// picks tools, sensitivity, or approval requirements; those are code-decided
// from the registry (Rule 4, DESIGN-NOTES §2.11). Tool selection is a
// separate LLM call (searchRegistry, below) — this one doesn't see the
// registry at all.
const ParsedIntentSchema = z4.object({
  name: z4.string().describe("A short, human-friendly name for the agent, 2-5 words."),
  description: z4.string().describe("One or two sentences describing what the agent does."),
  system_prompt: z4.string().describe("The system prompt the agent should run with."),
  trigger: z4
    .object({
      type: z4
        .enum(["webhook", "schedule", "manual"])
        .describe(
          "'webhook' if the request reacts to an event (a commit, a new issue, a message received); " +
            "'schedule' if it describes a recurring time-based cadence (daily, every morning, weekly); " +
            "'manual' if neither is implied — it only runs when a person asks it to."
        ),
      detail: z4
        .string()
        .describe("Short specifics — e.g. 'GitHub push event' for webhook, 'Weekdays 08:00' for schedule, empty string for manual."),
    })
    .describe("What starts a run — never assume 'schedule' by default; most single-action requests are event-driven or on-demand."),
});
type ParsedIntent = z4.infer<typeof ParsedIntentSchema>;

const ToolSelectionSchema = z4.object({
  selected: z4
    .array(z4.object({ mcpServerId: z4.string(), toolName: z4.string() }))
    .describe("The minimal set of catalog entries actually needed for the request — not everything a relevant server offers."),
});

export interface MatchedTool {
  mcpServerId: string;
  serverName: string;
  toolName: string;
  sensitivity: string;
}

/** What the client sends back on resume — identifies which matched tools to keep. Never trusted for anything beyond that lookup (see presentTools below). */
export interface ConfirmedToolRef {
  mcpServerId: string;
  toolName: string;
}

export interface MissingServer {
  mcpServerId: string;
  serverName: string;
  authSpec: AuthSpec;
}

/** One submitted credential — same shape addConnection() already takes; this node is the build-time gate's entry point into the same connections table (DESIGN-NOTES §3 Q&A). */
export interface CredentialSubmission {
  mcpServerId: string;
  values: Record<string, string>;
}

const BuildState = Annotation.Root({
  prompt: Annotation<string>,
  parsed: Annotation<ParsedIntent | null>,
  matchedTools: Annotation<MatchedTool[]>,
  confirmedTools: Annotation<MatchedTool[]>,
  missingServers: Annotation<MissingServer[]>,
});

async function parseIntent(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      // Deliberately short structured output (a name, a couple sentences, a
      // handful of keywords) — not a classification task, but not a reason
      // to reach for a 16k ceiling either.
      max_tokens: 2048,
      system:
        "Extract a structured build intent from the user's request for an AI agent. " +
        "Extract prose (name, description, system_prompt) and classify its trigger — " +
        "never decide which tools it gets; that's handled separately. " +
        "For the trigger: 'reacts when X happens' (a commit, a new issue, an incoming message) is a webhook, not a schedule. " +
        "Only classify 'schedule' when the request itself names a recurring cadence (daily, every morning, weekly). " +
        "If neither is stated, use 'manual'.",
      messages: [{ role: "user", content: state.prompt }],
      output_config: { format: zodOutputFormat(ParsedIntentSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ServiceError(502, "Agent Builder is misconfigured (invalid ANTHROPIC_API_KEY).");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ServiceError(429, "Agent Builder is rate-limited upstream — try again shortly.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new ServiceError(502, `Agent Builder's upstream model call failed: ${err.message}`);
    }
    throw err;
  }

  if (!response.parsed_output) {
    throw new ServiceError(502, "Agent Builder: the model's response didn't match the expected shape.");
  }
  return { parsed: response.parsed_output };
}

/**
 * The tool-selection sub-agent: a second, distinct LLM call whose only job
 * is picking the minimal set of tools the described intent actually needs —
 * not a keyword search. A prior ILIKE-based version matched any tool whose
 * name/description contained a loose keyword (e.g. "commit", "repository"),
 * which pulled in a server's entire unrelated tool set (delete_file,
 * create_repository, ...) alongside the one or two tools actually needed.
 * This call sees the full catalog with descriptions and reasons about fit.
 *
 * The model's picks are never trusted directly — every returned
 * {mcpServerId, toolName} is looked up against the real catalog rows fetched
 * a few lines above; anything that doesn't match a real row (a typo'd name,
 * a hallucinated tool) is silently dropped. sensitivity always comes from
 * that catalog row, never from the model (Rule 4).
 */
async function searchRegistry(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const pool = getPool();
  const { rows } = await pool.query<{
    mcp_server_id: string;
    server_name: string;
    tool_name: string;
    description: string | null;
    sensitivity: string;
  }>(
    `SELECT s.id AS mcp_server_id, s.name AS server_name, t.name AS tool_name, t.description, t.sensitivity
     FROM mcp_tools t
     JOIN mcp_servers s ON s.id = t.server_id
     WHERE t.owner_id = $1
     ORDER BY s.name, t.name`,
    [DEFAULT_OWNER_ID]
  );
  if (rows.length === 0) return { matchedTools: [] };

  const catalog = rows
    .map((r) => `server="${r.server_name}" mcpServerId="${r.mcp_server_id}" tool="${r.tool_name}" (${r.sensitivity}): ${r.description ?? "no description"}`)
    .join("\n");

  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system:
        "You select the MINIMAL set of tools an agent needs to accomplish the user's request, from a fixed catalog of " +
        "already-registered tools. Only pick a tool if the request genuinely requires it — do not pick every tool a " +
        "relevant server offers just because one of its tools is needed. For example, an agent that only needs to post " +
        "a Slack message when a commit happens needs one commit-reading tool and one message-sending tool — not that " +
        "server's file, branch, or repository management tools. Never invent a tool or mcpServerId that isn't in the catalog.",
      messages: [{ role: "user", content: `Request: ${state.prompt}\n\nCatalog:\n${catalog}` }],
      output_config: { format: zodOutputFormat(ToolSelectionSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ServiceError(502, "Agent Builder is misconfigured (invalid ANTHROPIC_API_KEY).");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ServiceError(429, "Agent Builder is rate-limited upstream — try again shortly.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new ServiceError(502, `Agent Builder's upstream model call failed: ${err.message}`);
    }
    throw err;
  }

  if (!response.parsed_output) {
    throw new ServiceError(502, "Agent Builder: the model's tool selection didn't match the expected shape.");
  }

  const bySignature = new Map(rows.map((r) => [`${r.mcp_server_id}:${r.tool_name}`, r]));
  const matchedTools: MatchedTool[] = [];
  for (const pick of response.parsed_output.selected) {
    const row = bySignature.get(`${pick.mcpServerId}:${pick.toolName}`);
    if (row) matchedTools.push({ mcpServerId: row.mcp_server_id, serverName: row.server_name, toolName: row.tool_name, sensitivity: row.sensitivity });
  }
  return { matchedTools };
}

/**
 * Always pauses (matches the documented graph shape — `present_tools` is
 * unconditional, unlike `request_credentials`). The resume value is never
 * trusted directly: it only selects *which* of the already-classified
 * `matchedTools` to keep, never introduces a new tool or overrides a
 * sensitivity — that would let a client bypass Rule 4 from the resume path.
 */
async function presentTools(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const confirmed = interrupt<{ matchedTools: MatchedTool[] }, ConfirmedToolRef[]>({
    matchedTools: state.matchedTools,
  });
  const keep = new Set(confirmed.map((c) => `${c.mcpServerId}:${c.toolName}`));
  return { confirmedTools: state.matchedTools.filter((t) => keep.has(`${t.mcpServerId}:${t.toolName}`)) };
}

/** Pure check — which of the confirmed tools' servers need a credential that isn't on file yet. A server with no auth_spec at all needs nothing (open access), so it's never "missing". */
async function checkConnections(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const serverIds = [...new Set(state.confirmedTools.map((t) => t.mcpServerId))];
  if (serverIds.length === 0) return { missingServers: [] };

  const pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string; auth_spec: AuthSpec }>(
    `SELECT s.id, s.name, s.auth_spec
     FROM mcp_servers s
     WHERE s.id = ANY($1) AND s.owner_id = $2 AND s.auth_spec IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.server_id = s.id AND c.owner_id = $2)`,
    [serverIds, DEFAULT_OWNER_ID]
  );
  return { missingServers: rows.map((r) => ({ mcpServerId: r.id, serverName: r.name, authSpec: r.auth_spec })) };
}

/**
 * Only reached when check_connections found something missing (conditional
 * edge below — unlike present_tools, this pause is not unconditional). Each
 * submitted credential goes through the same addConnection() the Connections
 * screen uses — verified against the real server before it's stored, same as
 * that entry point (DESIGN-NOTES §3 Q&A: "two entry points, same row").
 */
async function requestCredentials(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const submissions = interrupt<{ missingServers: MissingServer[] }, CredentialSubmission[]>({
    missingServers: state.missingServers,
  });
  for (const sub of submissions) {
    await addConnection(sub.mcpServerId, sub.values);
  }
  return {};
}

// Compiled lazily — compiling attaches the checkpointer, which touches the
// DB pool, and this module is imported (via routes/agents.ts) before
// connectDatabase() runs in index.ts's startup sequence.
let compiledGraph: ReturnType<typeof compileGraph> | undefined;

function compileGraph() {
  return new StateGraph(BuildState)
    .addNode("parse_intent", parseIntent)
    .addNode("search_registry", searchRegistry)
    .addNode("present_tools", presentTools)
    .addNode("check_connections", checkConnections)
    .addNode("request_credentials", requestCredentials)
    .addEdge(START, "parse_intent")
    .addEdge("parse_intent", "search_registry")
    .addEdge("search_registry", "present_tools")
    .addEdge("present_tools", "check_connections")
    .addConditionalEdges("check_connections", (state) => (state.missingServers.length > 0 ? "request_credentials" : END), [
      "request_credentials",
      END,
    ])
    .addEdge("request_credentials", END)
    .compile({ checkpointer: getCheckpointer() });
}

function getGraph() {
  if (!compiledGraph) compiledGraph = compileGraph();
  return compiledGraph;
}

export type BuildPause =
  | { status: "interrupted"; interruptKind: "select_servers"; matchedTools: MatchedTool[] }
  | { status: "interrupted"; interruptKind: "add_connection"; missingServers: MissingServer[] };

export interface BuildFinished {
  status: "completed";
  parsed: ParsedIntent;
  confirmedTools: MatchedTool[];
}

function readPause(result: unknown): BuildPause {
  if (!isInterrupted<{ matchedTools: MatchedTool[] } | { missingServers: MissingServer[] }>(result)) {
    throw new ServiceError(502, "Build graph finished without pausing where one was expected.");
  }
  const payload = result[INTERRUPT][0]?.value;
  if (!payload) throw new ServiceError(502, "Build graph interrupted with no payload.");
  if ("matchedTools" in payload) return { status: "interrupted", interruptKind: "select_servers", matchedTools: payload.matchedTools };
  return { status: "interrupted", interruptKind: "add_connection", missingServers: payload.missingServers };
}

/** Starts a new build thread and runs it up to the present_tools pause — always reached, per the documented graph shape. */
export async function startBuild(threadId: string, prompt: string): Promise<BuildPause> {
  const result = await getGraph().invoke(
    { prompt, parsed: null, matchedTools: [], confirmedTools: [], missingServers: [] },
    { configurable: { thread_id: threadId } }
  );
  return readPause(result);
}

/**
 * Resumes a paused build thread. `resumeValue` is whatever the currently
 * pending interrupt expects — `ConfirmedToolRef[]` at select_servers,
 * `CredentialSubmission[]` at add_connection — the caller (services/builder.ts)
 * knows which from the graph_runs row's interrupt_kind. May pause again
 * (select_servers -> add_connection, when a credential turns out to be
 * missing) or finish.
 */
export async function resumeBuild(threadId: string, resumeValue: ConfirmedToolRef[] | CredentialSubmission[]): Promise<BuildPause | BuildFinished> {
  const result = await getGraph().invoke(new Command({ resume: resumeValue }), { configurable: { thread_id: threadId } });

  if (isInterrupted(result)) return readPause(result);
  if (!result.parsed) throw new ServiceError(502, "Build graph finished without a parsed intent.");
  return { status: "completed", parsed: result.parsed, confirmedTools: result.confirmedTools };
}
