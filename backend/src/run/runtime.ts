// Agent Runtime — Rule 4's Approval Gate made real, and Rule 8's
// coordinator_specialist shape actually executed. Loads a persisted agent
// config (services/builder.ts), gives it real MCP tools, and gates every
// tool in `interrupt_before` behind langchain's humanInTheLoopMiddleware —
// a purpose-built HITL middleware, not a hand-rolled interrupt() (that
// pattern is reserved for build/graph.ts's own pauses, which aren't
// per-tool-call approval). Uses createAgent (a real ReAct tool-calling
// loop) rather than a custom StateGraph: this is exactly the scenario the
// library's agent abstraction exists for.
//
// coordinator_specialist: each specialist is its own createAgent, wrapped
// as a plain callable tool for the coordinator's createAgent. Specialists
// carry no checkpointer and no HITL middleware — builder.ts guarantees a
// specialist never holds a gated (non-read) tool (any write/destructive
// pick gets reassigned to the coordinator at config-assembly time), so a
// specialist call can never need to pause. Only the coordinator's own
// createAgent ever interrupts, which means every pause still happens on
// the one checkpointed thread this module already knows how to run/resume
// — no untested nested-interrupt behavior.
import { createAgent, tool, humanInTheLoopMiddleware, type HITLRequest, type Decision } from "langchain";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, isInterrupted, INTERRUPT } from "@langchain/langgraph";
import { getPool } from "../db.js";
import { DEFAULT_OWNER_ID } from "../tenancy.js";
import { getConnectionAuth, ServiceError } from "../services/registry.js";
import { attachAuth } from "../authSpec.js";
import { callTool } from "../mcpClient.js";
import { getCheckpointer } from "../checkpointer.js";
import type { AgentConfigDoc, AgentConfigTool, SpecialistConfig } from "../services/builder.js";

interface RuntimeTool {
  mcpServerId: string;
  toolName: string;
  address: string;
  description: string | null;
  inputSchema: unknown;
}

async function loadRuntimeTools(tools: AgentConfigTool[]): Promise<RuntimeTool[]> {
  const pool = getPool();
  const runtimeTools: RuntimeTool[] = [];
  for (const t of tools) {
    const { rows } = await pool.query<{ address: string; description: string | null; input_schema: unknown }>(
      `SELECT s.address, t.description, t.input_schema
       FROM mcp_tools t JOIN mcp_servers s ON s.id = t.server_id
       WHERE t.server_id = $1 AND t.name = $2 AND t.owner_id = $3`,
      [t.mcp_server_id, t.tool_name, DEFAULT_OWNER_ID]
    );
    const row = rows[0];
    if (!row) throw new ServiceError(500, `Tool '${t.tool_name}' in this agent's config no longer exists in the registry.`);
    runtimeTools.push({ mcpServerId: t.mcp_server_id, toolName: t.tool_name, address: row.address, description: row.description, inputSchema: row.input_schema });
  }
  return runtimeTools;
}

function buildLangchainTools(runtimeTools: RuntimeTool[]) {
  return runtimeTools.map((rt) =>
    tool(
      async (input: Record<string, unknown>) => {
        // Fetch -> use -> drop (Rule 3): decrypted here, attached to this
        // one call, never stored or logged. Same path health.ts's liveness
        // ping uses — this is that pattern's real, agentic caller.
        //
        // This line only runs if the tool call actually executes — a
        // rejected gated call never reaches here (humanInTheLoopMiddleware
        // substitutes a rejection result instead of invoking this
        // function). It's the audit trail proving that: the model's own
        // final text can claim anything, this line is ground truth for
        // whether a real external call happened.
        console.error(`tool executed: ${rt.toolName} (server ${rt.mcpServerId})`);
        const auth = await getConnectionAuth(rt.mcpServerId);
        const attachment = auth ? attachAuth(auth.authSpec, auth.values) : undefined;
        const result = await callTool(rt.address, rt.toolName, input, attachment);
        const text = result.content.map((c) => c.text ?? "").join("\n");
        if (result.isError) throw new Error(text || `${rt.toolName} failed.`);
        return text;
      },
      {
        name: rt.toolName,
        description: rt.description ?? rt.toolName,
        // Raw JSON Schema straight from mcp_tools.input_schema — the `tool()`
        // helper accepts it directly, no Zod conversion needed.
        schema: (rt.inputSchema as object) ?? { type: "object", properties: {} },
      }
    )
  );
}

/** Only tools named in `interruptBefore` pause; everything else auto-approves (per humanInTheLoopMiddleware's own default — no entry means auto-approved). Code-decided at build time (Rule 4); the Runtime just enforces what's already in the config. */
function buildInterruptOn(interruptBefore: string[]): Record<string, { allowedDecisions: Array<"approve" | "reject"> }> {
  const entries: Record<string, { allowedDecisions: Array<"approve" | "reject"> }> = {};
  for (const name of interruptBefore) {
    entries[name] = { allowedDecisions: ["approve", "reject"] };
  }
  return entries;
}

function lastMessageText(messages: BaseMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (!Array.isArray(last.content)) return "";
  return last.content
    .filter((block): block is { type: string; text: string } => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Wraps one specialist as a callable tool for the coordinator (Rule 8). No
 * checkpointer, no HITL middleware — builder.ts's config assembly already
 * guarantees a specialist never carries a gated tool, so it can never need
 * to pause. If that invariant were ever violated anyway, isInterrupted()
 * throws loudly here rather than silently letting a risky call through
 * ungated.
 */
async function buildSpecialistTool(specialist: SpecialistConfig) {
  const runtimeTools = await loadRuntimeTools(specialist.tools);
  const specialistAgent = createAgent({
    model: "anthropic:claude-sonnet-5",
    tools: buildLangchainTools(runtimeTools),
    systemPrompt: specialist.system_prompt,
  });

  return tool(
    async ({ task }: { task: string }) => {
      const result = await specialistAgent.invoke({ messages: [new HumanMessage(task)] });
      if (isInterrupted(result)) {
        throw new Error(`Specialist '${specialist.name}' unexpectedly required approval — specialists must only use read-only tools.`);
      }
      const messages = (result as { messages?: BaseMessage[] }).messages ?? [];
      return lastMessageText(messages);
    },
    {
      name: specialist.name,
      description: specialist.description,
      schema: {
        type: "object",
        properties: { task: { type: "string", description: "What to ask this specialist to do." } },
        required: ["task"],
      },
    }
  );
}

async function buildAgent(config: AgentConfigDoc) {
  const coordinatorRuntimeTools = await loadRuntimeTools(config.tools);
  const coordinatorTools = buildLangchainTools(coordinatorRuntimeTools);

  const specialistTools =
    config.graph.type === "coordinator_specialist" ? await Promise.all(config.graph.specialists.map(buildSpecialistTool)) : [];

  return createAgent({
    model: "anthropic:claude-sonnet-5",
    tools: [...specialistTools, ...coordinatorTools],
    systemPrompt: config.system_prompt,
    middleware: [humanInTheLoopMiddleware({ interruptOn: buildInterruptOn(config.interrupt_before) })],
    checkpointer: getCheckpointer(),
  });
}

export interface RunPaused {
  status: "interrupted";
  hitlRequest: HITLRequest;
}

export interface RunFinished {
  status: "completed";
  output: string;
}

function readResult(result: unknown): RunPaused | RunFinished {
  if (isInterrupted<HITLRequest>(result)) {
    const payload = result[INTERRUPT][0]?.value;
    if (!payload) throw new ServiceError(502, "Agent run interrupted with no payload.");
    return { status: "interrupted", hitlRequest: payload };
  }
  const messages = (result as { messages?: BaseMessage[] }).messages ?? [];
  return { status: "completed", output: lastMessageText(messages) };
}

/** Starts a new run thread with a human message. Pauses at the first gated tool call, if any — always the coordinator's own, never a specialist's. */
export async function startRun(threadId: string, config: AgentConfigDoc, message: string): Promise<RunPaused | RunFinished> {
  const agent = await buildAgent(config);
  const result = await agent.invoke({ messages: [new HumanMessage(message)] }, { configurable: { thread_id: threadId } });
  return readResult(result);
}

/** Resumes a run paused on a tool-approval request. */
export async function resumeRun(threadId: string, config: AgentConfigDoc, decisions: Decision[]): Promise<RunPaused | RunFinished> {
  const agent = await buildAgent(config);
  const result = await agent.invoke(new Command({ resume: { decisions } }), { configurable: { thread_id: threadId } });
  return readResult(result);
}
