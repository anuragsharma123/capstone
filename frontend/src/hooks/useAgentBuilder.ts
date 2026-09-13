import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  startBuild,
  resumeBuildTools,
  resumeBuildCredentials,
  type BuildOutcome,
  type MatchedTool,
  type MissingServer,
  type ConfirmedToolRef,
  type CredentialSubmission,
  type AgentConfigDoc,
} from "../lib/api";

export type BuildPhase =
  | { kind: "form" }
  | { kind: "tools"; threadId: string; matchedTools: MatchedTool[] }
  | { kind: "credentials"; threadId: string; missingServers: MissingServer[] }
  | { kind: "done"; agentId: string; agentVersionId: string; config: AgentConfigDoc };

const STORAGE_KEY = "agent-builder-phase";

function loadPersisted(): BuildPhase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BuildPhase) : { kind: "form" };
  } catch {
    return { kind: "form" };
  }
}

function persist(phase: BuildPhase): void {
  try {
    if (phase.kind === "form") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(phase));
  } catch {
    // best-effort — a paused build just won't survive a reload in a private window
  }
}

function nextPhase(outcome: BuildOutcome, threadId: string): BuildPhase {
  if (outcome.status === "completed") {
    return { kind: "done", agentId: outcome.agentId, agentVersionId: outcome.agentVersionId, config: outcome.config };
  }
  if (outcome.interruptKind === "select_servers") return { kind: "tools", threadId, matchedTools: outcome.matchedTools };
  return { kind: "credentials", threadId, missingServers: outcome.missingServers };
}

/**
 * The one Agent Builder state machine — both the chat UI and the form UI
 * drive this same hook, so there is exactly one client-side builder
 * (mirroring the backend's single build/graph.ts). Persists the in-progress
 * phase to localStorage: the backend pause already survives a restart via
 * its own checkpointer, but the UI needs to remember *which* thread to come
 * back to across a reload — otherwise "close the tab, come back tomorrow"
 * has no way back in from this screen.
 */
export function useAgentBuilder() {
  const [phase, setPhase] = useState<BuildPhase>(loadPersisted);

  useEffect(() => persist(phase), [phase]);

  const startMutation = useMutation({
    mutationFn: (prompt: string) => startBuild(prompt),
    onSuccess: (result) => setPhase(nextPhase(result, result.threadId)),
  });

  const toolsMutation = useMutation({
    mutationFn: ({ threadId, confirmed }: { threadId: string; confirmed: ConfirmedToolRef[] }) => resumeBuildTools(threadId, confirmed),
    onSuccess: (result, { threadId }) => setPhase(nextPhase(result, threadId)),
  });

  const credentialsMutation = useMutation({
    mutationFn: ({ threadId, credentials }: { threadId: string; credentials: CredentialSubmission[] }) =>
      resumeBuildCredentials(threadId, credentials),
    onSuccess: (result, { threadId }) => setPhase(nextPhase(result, threadId)),
  });

  function reset() {
    setPhase({ kind: "form" });
  }

  return { phase, startMutation, toolsMutation, credentialsMutation, reset };
}

export type UseAgentBuilder = ReturnType<typeof useAgentBuilder>;
