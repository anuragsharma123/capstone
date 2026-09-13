// The Postgres-backed LangGraph checkpointer — what makes a pause durable
// across a restart (DESIGN-NOTES §4: "state is in Postgres not memory").
// Shared by the build graph (build/graph.ts) and the Agent Runtime
// (run/runtime.ts) — one checkpoint store, both graphs' threads.
// Lazy singleton: must not call getPool() at module load time, since this
// file is imported (via routes/) before connectDatabase() runs in
// index.ts's startup sequence.
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getPool } from "./db.js";

let saver: PostgresSaver | undefined;

export function getCheckpointer(): PostgresSaver {
  if (!saver) saver = new PostgresSaver(getPool());
  return saver;
}

/** Creates the checkpointer's own tables if they don't exist yet. Call once at startup, after connectDatabase(). */
export async function setupCheckpointer(): Promise<void> {
  await getCheckpointer().setup();
}
