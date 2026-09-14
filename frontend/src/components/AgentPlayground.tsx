import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { runAgent, resumeRun, ApiError, type Decision, type HitlRequest, type RunOutcome } from "../lib/api";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

interface PendingApproval {
  threadId: string;
  hitlRequest: HitlRequest;
}

interface Props {
  agentVersionId: string;
  /** Fires once a run reaches 'completed' — e.g. so a host page can refetch run history/score, both of which change server-side the moment a run finishes (services/runner.ts). */
  onRunCompleted?: () => void;
}

/**
 * Each send starts a fresh run thread (no multi-turn memory across separate
 * messages — the backend doesn't carry state between runAgent() calls, only
 * within one paused-then-resumed thread). Shown as a running transcript for
 * readability, but each exchange is independent.
 */
export default function AgentPlayground({ agentVersionId, onRunCompleted }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [decisions, setDecisions] = useState<Record<number, "approve" | "reject">>({});

  function applyOutcome(outcome: RunOutcome, threadId: string) {
    if (outcome.status === "completed") {
      setMessages((m) => [...m, { role: "assistant", text: outcome.output }]);
      setPending(null);
      setDecisions({});
      onRunCompleted?.();
    } else {
      setPending({ threadId, hitlRequest: outcome.hitlRequest });
      setDecisions(Object.fromEntries(outcome.hitlRequest.actionRequests.map((_, i) => [i, "approve"])));
    }
  }

  const sendMutation = useMutation({
    mutationFn: (message: string) => runAgent(agentVersionId, message),
    onSuccess: (result) => applyOutcome(result, result.threadId),
    onError: (err) => {
      setMessages((m) => [...m, { role: "error", text: err instanceof ApiError ? err.message : "Something went wrong." }]);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (decisionList: Decision[]) => resumeRun(pending!.threadId, decisionList),
    onSuccess: (result) => applyOutcome(result, pending!.threadId),
    onError: (err) => {
      setMessages((m) => [...m, { role: "error", text: err instanceof ApiError ? err.message : "Something went wrong." }]);
      setPending(null);
    },
  });

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    sendMutation.mutate(text);
  }

  function submitDecisions() {
    if (!pending) return;
    const list: Decision[] = pending.hitlRequest.actionRequests.map((_, i) => ({ type: decisions[i] ?? "approve" }));
    resumeMutation.mutate(list);
  }

  const busy = sendMutation.isPending || resumeMutation.isPending;

  return (
    <div className="playground">
      <div className="playground-transcript">
        {messages.length === 0 && !pending && <p className="playground-empty">Try it — send a message to see how it responds.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && !pending && <div className="chat-bubble assistant loading">Thinking…</div>}
      </div>

      {pending && (
        <div className="approval-card">
          <div className="approval-card-head">Approval needed before this continues</div>
          {pending.hitlRequest.actionRequests.map((action, i) => (
            <div className="approval-item" key={i}>
              <div className="approval-item-name">{action.name}</div>
              <div className="approval-item-args">
                {Object.entries(action.args).map(([key, value]) => (
                  <div key={key} className="approval-arg">
                    <span className="approval-arg-key">{key}</span>
                    <div className="approval-arg-value">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</div>
                  </div>
                ))}
              </div>
              <div className="approval-item-choice">
                <label>
                  <input
                    type="radio"
                    checked={decisions[i] !== "reject"}
                    onChange={() => setDecisions((d) => ({ ...d, [i]: "approve" }))}
                  />
                  Approve
                </label>
                <label>
                  <input
                    type="radio"
                    checked={decisions[i] === "reject"}
                    onChange={() => setDecisions((d) => ({ ...d, [i]: "reject" }))}
                  />
                  Reject
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="primary" onClick={submitDecisions} disabled={resumeMutation.isPending}>
            {resumeMutation.isPending ? "Submitting…" : "Submit decision"}
          </button>
        </div>
      )}

      <form className="playground-input" onSubmit={handleSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pending ? "Resolve the approval above first…" : "Ask the agent to do something…"}
          disabled={busy || !!pending}
        />
        <button type="submit" className="primary" disabled={busy || !!pending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
