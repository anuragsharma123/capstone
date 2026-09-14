import { useState, type FormEvent } from "react";
import type { UseAgentBuilder } from "../../hooks/useAgentBuilder";
import ToolPickerWidget from "./ToolPickerWidget";
import ConnectionsWidget from "./ConnectionsWidget";
import AgentCard from "./AgentCard";
import { BuildIcon } from "../icons";

interface Props {
  builder: UseAgentBuilder;
}

/** Same steps as the chat flow, same useAgentBuilder mutations — laid out as plain panels instead of a transcript. Not a second builder, a second skin on the first one's widgets. */
export default function FormBuildFlow({ builder }: Props) {
  const { phase, startMutation, toolsMutation, credentialsMutation, reset } = builder;
  const [prompt, setPrompt] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    startMutation.mutate(prompt.trim());
  }

  return (
    <>
      {phase.kind === "form" && (
        <section className="panel">
          <div className="panel-body">
            <form className="build-form" onSubmit={handleSubmit}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Build an agent that reads recent Gmail messages and can send email replies."
                rows={4}
                disabled={startMutation.isPending}
              />
              <button type="submit" className="primary" disabled={startMutation.isPending || !prompt.trim()}>
                <BuildIcon />
                {startMutation.isPending ? "Thinking…" : "Build"}
              </button>
            </form>
          </div>
        </section>
      )}

      {phase.kind === "tools" && (
        <section className="panel">
          <div className="panel-head">
            <h3>Confirm which tools it gets</h3>
          </div>
          <div className="panel-body">
            <ToolPickerWidget
              matchedTools={phase.matchedTools}
              pending={toolsMutation.isPending}
              onConfirm={(selected) => toolsMutation.mutate({ threadId: phase.threadId, confirmed: selected })}
            />
          </div>
        </section>
      )}

      {phase.kind === "credentials" && (
        <section className="panel">
          <div className="panel-head">
            <h3>Connect what's missing</h3>
          </div>
          <div className="panel-body">
            <ConnectionsWidget
              missingServers={phase.missingServers}
              pending={credentialsMutation.isPending}
              onConnect={(credentials) => credentialsMutation.mutate({ threadId: phase.threadId, credentials })}
            />
          </div>
        </section>
      )}

      {phase.kind === "done" && (
        <section className="panel">
          <div className="panel-head">
            <h3>Built</h3>
            <button type="button" className="connect-link" onClick={reset}>
              Build another
            </button>
          </div>
          <div className="panel-body">
            <AgentCard config={phase.config} agentId={phase.agentId} />
          </div>
        </section>
      )}
    </>
  );
}
