// Build Orchestrator — fourth slice (DESIGN-NOTES §4, "Run lane · Agent
// Config Store"). Five nodes, two pauses:
//   parse_intent -> search_registry -> present_tools (⏸ always)
//     -> check_connections -> request_credentials (⏸ only if a connection
//        is missing) -> end
// generate_config/score_agent/deploy are still later work — for now the
// assembled config is persisted directly once both pauses (the second one
// only when needed) have cleared.
//
// Rule 8 (coordinator_specialist): parse_intent decides the shape and — for
// a multi-agent request — proposes specialist roles (name/description/
// system_prompt only, never tools). search_registry then runs one
// tool-selection pass per role (the coordinator, plus each specialist),
// tagging every matched tool with which role it's for. Everything downstream
// (present_tools, check_connections) treats a tagged tool exactly like a
// plain one; only services/builder.ts, at final config assembly, partitions
// them back into the coordinator's own tools vs. each specialist's.
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

const SpecialistPlanSchema = z4.object({
  name: z4.string().describe("A short snake_case identifier, e.g. 'issue_reader' — used as the specialist's tool name for the coordinator."),
  description: z4.string().describe("One sentence: what this specialist does. Shown to the coordinator as that tool's description."),
  system_prompt: z4.string().describe("The system prompt this specialist runs with — its own scoped job, not the whole request."),
});

// LLM decides prose + shape only — name/description/system_prompt/trigger/
// graph. It never picks tools, sensitivity, or approval requirements; those
// are code-decided from the registry (Rule 4, DESIGN-NOTES §2.11). Tool
// selection is a separate LLM call (searchRegistry, below) — this one
// doesn't see the registry at all.
const ParsedIntentSchema = z4.object({
  name: z4.string().describe("A short, human-friendly name for the agent, 2-5 words."),
  description: z4.string().describe("One or two sentences describing what the agent does."),
  system_prompt: z4
    .string()
    .describe("The system prompt the agent runs with. For a coordinator_specialist graph, this is the COORDINATOR's prompt — how it uses its specialists and what it does with their findings."),
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
  graph: z4
    .object({
      type: z4
        .enum(["sequential", "coordinator_specialist"])
        .describe(
          "'coordinator_specialist' only when the request naturally splits into two or more distinct delegated sub-tasks " +
            "(e.g. one specialist gathers information, another assesses it) before a final action. 'sequential' otherwise — " +
            "most requests are sequential; don't invent specialists that aren't genuinely separate roles."
        ),
      specialists: z4
        .array(SpecialistPlanSchema)
        .describe("Two or more entries when type='coordinator_specialist'; an empty array when type='sequential'."),
    })
    .describe("The agent's shape. Specialists never get their own tools here — search_registry assigns those separately."),
});
type ParsedIntent = z4.infer<typeof ParsedIntentSchema>;

const ToolSelectionSchema = z4.object({
  selected: z4
    .array(z4.object({ mcpServerId: z4.string(), toolName: z4.string() }))
    .describe("The minimal set of catalog entries actually needed for this role — not everything a relevant server offers."),
});

/** `role` is `"coordinator"` or a specialist's `name` — which agent this tool belongs to. A plain sequential agent's tools all carry `"coordinator"`. */
export interface MatchedTool {
  mcpServerId: string;
  serverName: string;
  toolName: string;
  sensitivity: string;
  role: string;
}

/** What the client sends back on resume — identifies which matched tools to keep, per role. Never trusted for anything beyond that lookup (see presentTools below). */
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
      // A short prose block plus an optional handful of specialist roles —
      // still not a reason to reach for a 16k ceiling.
      max_tokens: 3000,
      system:
        "Extract a structured build intent from the user's request for an AI agent. " +
        "Extract prose (name, description, system_prompt), classify its trigger, and decide its shape (graph) — " +
        "never decide which tools it gets; that's handled separately. " +
        "For the trigger: 'reacts when X happens' (a commit, a new issue, an incoming message) is a webhook, not a schedule. " +
        "Only classify 'schedule' when the request itself names a recurring cadence (daily, every morning, weekly). " +
        "If neither is stated, use 'manual'. " +
        "For the shape: only use coordinator_specialist when the request genuinely implies two or more distinct delegated " +
        "roles working together (e.g. one gathers information, another evaluates or prioritizes it) before the coordinator " +
        "takes a final action itself. Otherwise use sequential — that's the common case.",
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

interface CatalogRow {
  mcp_server_id: string;
  server_name: string;
  tool_name: string;
  description: string | null;
  sensitivity: string;
}

/**
 * The tool-selection sub-agent: a second, distinct LLM call whose only job
 * is picking the minimal set of tools a given role actually needs — not a
 * keyword search. A prior ILIKE-based version matched any tool whose
 * name/description contained a loose keyword (e.g. "commit", "repository"),
 * which pulled in a server's entire unrelated tool set (delete_file,
 * create_repository, ...) alongside the one or two tools actually needed.
 * This call sees the full catalog with descriptions and reasons about fit.
 *
 * Called once per role (the coordinator, and once per specialist) so a
 * multi-agent build's tool assignment is genuinely scoped per role, not one
 * flat list guessed at once. The model's picks are never trusted directly:
 * every returned {mcpServerId, toolName} is looked up against the real
 * catalog rows; anything that doesn't match a real row (a typo'd name, a
 * hallucinated tool) is silently dropped. sensitivity always comes from that
 * catalog row, never from the model (Rule 4).
 */
async function selectToolsForRole(roleLabel: string, roleBrief: string, rows: CatalogRow[]): Promise<MatchedTool[]> {
  if (rows.length === 0) return [];
  const catalog = rows
    .map((r) => `server="${r.server_name}" mcpServerId="${r.mcp_server_id}" tool="${r.tool_name}" (${r.sensitivity}): ${r.description ?? "no description"}`)
    .join("\n");

  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system:
        "You select the MINIMAL set of tools this specific role needs, from a fixed catalog of already-registered tools. " +
        "Only pick a tool if the role genuinely requires it — do not pick every tool a relevant server offers just because " +
        "one of its tools is needed. Never invent a tool or mcpServerId that isn't in the catalog.",
      messages: [{ role: "user", content: `Role: ${roleBrief}\n\nCatalog:\n${catalog}` }],
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
    throw new ServiceError(502, `Agent Builder: the tool selection for "${roleLabel}" didn't match the expected shape.`);
  }

  const bySignature = new Map(rows.map((r) => [`${r.mcp_server_id}:${r.tool_name}`, r]));
  const matched: MatchedTool[] = [];
  for (const pick of response.parsed_output.selected) {
    const row = bySignature.get(`${pick.mcpServerId}:${pick.toolName}`);
    if (row) matched.push({ mcpServerId: row.mcp_server_id, serverName: row.server_name, toolName: row.tool_name, sensitivity: row.sensitivity, role: roleLabel });
  }
  return matched;
}

async function searchRegistry(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const pool = getPool();
  const { rows } = await pool.query<CatalogRow>(
    `SELECT s.id AS mcp_server_id, s.name AS server_name, t.name AS tool_name, t.description, t.sensitivity
     FROM mcp_tools t
     JOIN mcp_servers s ON s.id = t.server_id
     WHERE t.owner_id = $1
     ORDER BY s.name, t.name`,
    [DEFAULT_OWNER_ID]
  );
  if (rows.length === 0 || !state.parsed) return { matchedTools: [] };

  if (state.parsed.graph.type === "sequential") {
    const matchedTools = await selectToolsForRole("coordinator", state.prompt, rows);
    return { matchedTools };
  }

  // coordinator_specialist: one selection pass per role, run independently
  // so each role's tool set only reflects its own job — the coordinator's
  // brief explicitly excludes the sub-tasks its specialists already cover.
  const specialistBriefs = state.parsed.graph.specialists.map((s) => `${s.name}: ${s.description}`).join("; ");
  const coordinatorBrief =
    `${state.prompt}\n\nYou are the COORDINATOR, delegating to these specialists: ${specialistBriefs}. ` +
    `Only pick tools YOU directly need to perform your own final action(s) — not tools your specialists need for their own sub-tasks.`;

  const [coordinatorTools, ...specialistToolLists] = await Promise.all([
    selectToolsForRole("coordinator", coordinatorBrief, rows),
    ...state.parsed.graph.specialists.map((s) => selectToolsForRole(s.name, `${s.description}\n\n${s.system_prompt}`, rows)),
  ]);

  return { matchedTools: [...coordinatorTools, ...specialistToolLists.flat()] };
}

/**
 * Always pauses (matches the documented graph shape — `present_tools` is
 * unconditional, unlike `request_credentials`). The resume value is never
 * trusted directly: it only selects *which* of the already-classified
 * `matchedTools` to keep (matched on role + server + tool together, so the
 * same tool picked for two different roles is tracked independently), never
 * introduces a new tool, role, or overrides a sensitivity — that would let a
 * client bypass Rule 4 from the resume path.
 */
async function presentTools(state: typeof BuildState.State): Promise<Partial<typeof BuildState.State>> {
  const confirmed = interrupt<{ matchedTools: MatchedTool[] }, ConfirmedToolRef[]>({
    matchedTools: state.matchedTools,
  });
  const keep = new Set(confirmed.map((c) => `${c.role}:${c.mcpServerId}:${c.toolName}`));
  return { confirmedTools: state.matchedTools.filter((t) => keep.has(`${t.role}:${t.mcpServerId}:${t.toolName}`)) };
}

/** Pure check — which of the confirmed tools' servers need a credential that isn't on file yet. A server with no auth_spec at all needs nothing (open access), so it's never "missing". Role-agnostic: a server used by both a specialist and the coordinator only needs connecting once. */
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
