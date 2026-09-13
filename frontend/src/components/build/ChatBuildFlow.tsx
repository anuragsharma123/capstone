import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UseAgentBuilder } from "../../hooks/useAgentBuilder";
import type { AgentConfigDoc, ConfirmedToolRef, CredentialSubmission, MatchedTool, MissingServer } from "../../lib/api";
import ToolPickerWidget from "./ToolPickerWidget";
import ConnectionsWidget from "./ConnectionsWidget";
import AgentCard from "./AgentCard";

type Turn =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | { kind: "tool-picker"; threadId: string; matchedTools: MatchedTool[]; resolved: boolean; confirmedCount?: number }
  | { kind: "connections"; threadId: string; missingServers: MissingServer[]; resolved: boolean }
  | { kind: "agent-card"; agentId: string; agentVersionId: string; config: AgentConfigDoc };

function introFor(phase: UseAgentBuilder["phase"]): Turn | null {
  if (phase.kind === "tools") return { kind: "text", role: "assistant", text: "Here's what I found in your registry — pick what it should use:" };
  if (phase.kind === "credentials") return { kind: "text", role: "assistant", text: "One thing's missing before I can finish:" };
  if (phase.kind === "done") return { kind: "text", role: "assistant", text: "Built it — try it in the Playground below." };
  return null;
}

function turnFor(phase: UseAgentBuilder["phase"]): Turn | null {
  switch (phase.kind) {
    case "tools":
      return { kind: "tool-picker", threadId: phase.threadId, matchedTools: phase.matchedTools, resolved: false };
    case "credentials":
      return { kind: "connections", threadId: phase.threadId, missingServers: phase.missingServers, resolved: false };
    case "done":
      return { kind: "agent-card", agentId: phase.agentId, agentVersionId: phase.agentVersionId, config: phase.config };
    default:
      return null;
  }
}

const TURNS_STORAGE_KEY = "agent-builder-chat-turns";

function loadPersistedTurns(): Turn[] | null {
  try {
    const raw = localStorage.getItem(TURNS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : null;
  } catch {
    return null;
  }
}

function persistTurns(turns: Turn[]): void {
  try {
    if (turns.length === 0) localStorage.removeItem(TURNS_STORAGE_KEY);
    else localStorage.setItem(TURNS_STORAGE_KEY, JSON.stringify(turns));
  } catch {
    // best-effort, same as useAgentBuilder's phase persistence
  }
}

interface Props {
  builder: UseAgentBuilder;
}

/** Chat presentation over useAgentBuilder — the interactive steps (tool pick, connect) render as widgets embedded in the transcript rather than separate panels, but every mutation call is the exact same one the form flow uses. */
export default function ChatBuildFlow({ builder }: Props) {
  const { phase, startMutation, toolsMutation, credentialsMutation } = builder;
  const [turns, setTurns] = useState<Turn[]>(() => {
    // A "form" phase means no active build (fresh load, or reset from the
    // other mode) — any leftover transcript from a prior session is stale,
    // so start clean rather than restoring it.
    if (phase.kind === "form") return [];
    const persisted = loadPersistedTurns();
    if (persisted && persisted.length > 0) return persisted;
    const t = turnFor(phase);
    return t ? [t] : [];
  });
  const [input, setInput] = useState("");
  const prevKind = useRef(phase.kind);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => persistTurns(turns), [turns]);

  useEffect(() => {
    if (phase.kind === prevKind.current) return;
    prevKind.current = phase.kind;
    setTurns((prev) => {
      const resolved = prev.map((t) => (t.kind === "tool-picker" || t.kind === "connections" ? { ...t, resolved: true } : t));
      const intro = introFor(phase);
      const next = turnFor(phase);
      return [...resolved, ...(intro ? [intro] : []), ...(next ? [next] : [])];
    });
  }, [phase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || phase.kind === "credentials") return;
    const text = input.trim();

    if (phase.kind === "tools") {
      // Skip straight to confirming everything matched — the checkboxes
      // above are for narrowing it down, not required before you can move on.
      setInput("");
      confirmTools(
        phase.threadId,
        phase.matchedTools.map((t) => ({ mcpServerId: t.mcpServerId, toolName: t.toolName, role: t.role }))
      );
      return;
    }

    if (!text) return;
    if (phase.kind === "done") {
      // Starting a new agent from here — fresh transcript, same input box,
      // no separate reset click needed.
      builder.reset();
      setTurns([{ kind: "text", role: "user", text }]);
    } else {
      setTurns((prev) => [...prev, { kind: "text", role: "user", text }]);
    }
    setInput("");
    startMutation.mutate(text);
  }

  function confirmTools(threadId: string, confirmed: ConfirmedToolRef[]) {
    setTurns((prev) =>
      prev.map((t) => (t.kind === "tool-picker" && t.threadId === threadId ? { ...t, confirmedCount: confirmed.length } : t))
    );
    toolsMutation.mutate({ threadId, confirmed });
  }

  function connect(threadId: string, credentials: CredentialSubmission[]) {
    credentialsMutation.mutate({ threadId, credentials });
  }

  function buildAnother() {
    builder.reset();
    setTurns([]);
    prevKind.current = "form";
  }

  const busy = startMutation.isPending;
  const waitingOnUser = phase.kind === "form" && turns.length === 0;

  const inputDisabled = busy || toolsMutation.isPending || credentialsMutation.isPending || phase.kind === "credentials";
  const sendDisabled = inputDisabled || (phase.kind !== "tools" && !input.trim());
  const sendLabel = phase.kind === "tools" ? "Use all tools" : "Send";
  const placeholder =
    phase.kind === "tools"
      ? "Press Enter to use all matched tools, or check the boxes above to narrow it down…"
      : phase.kind === "credentials"
        ? "Connect the server above to continue…"
        : phase.kind === "done"
          ? "Ask for another agent…"
          : "e.g. Build an agent that reads recent Gmail messages and can send email replies.";

  return (
    <div className="playground">
      <div className="playground-transcript">
        {waitingOnUser && <p className="playground-empty">Tell it what you want the agent to do — it'll take it from there.</p>}
        {turns.map((turn, i) => {
          if (turn.kind === "text") return <div key={i} className={`chat-bubble ${turn.role}`}>{turn.text}</div>;
          if (turn.kind === "tool-picker") {
            return (
              <div key={i} className="chat-bubble assistant widget-bubble">
                {turn.resolved ? (
                  <p className="widget-resolved">Confirmed {turn.confirmedCount ?? 0} tool{turn.confirmedCount === 1 ? "" : "s"}.</p>
                ) : (
                  <ToolPickerWidget
                    matchedTools={turn.matchedTools}
                    pending={toolsMutation.isPending}
                    onConfirm={(selected) => confirmTools(turn.threadId, selected)}
                  />
                )}
              </div>
            );
          }
          if (turn.kind === "connections") {
            return (
              <div key={i} className="chat-bubble assistant widget-bubble">
                {turn.resolved ? (
                  <p className="widget-resolved">Connected.</p>
                ) : (
                  <ConnectionsWidget
                    missingServers={turn.missingServers}
                    pending={credentialsMutation.isPending}
                    onConnect={(credentials) => connect(turn.threadId, credentials)}
                  />
                )}
              </div>
            );
          }
          return (
            <div key={i} className="chat-bubble assistant widget-bubble">
              <AgentCard config={turn.config} />
            </div>
          );
        })}
        {busy && <div className="chat-bubble assistant loading">Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      {phase.kind === "done" && (
        <button type="button" className="connect-link" onClick={buildAnother}>
          Start over
        </button>
      )}

      <form className="playground-input" onSubmit={handleSend}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} disabled={inputDisabled} />
        <button type="submit" className="primary" disabled={sendDisabled}>
          {sendLabel}
        </button>
      </form>
    </div>
  );
}
