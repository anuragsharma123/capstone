import { useState } from "react";
import { useAgentBuilder } from "../hooks/useAgentBuilder";
import ChatBuildFlow from "../components/build/ChatBuildFlow";
import FormBuildFlow from "../components/build/FormBuildFlow";
import AgentPlayground from "../components/AgentPlayground";

type Mode = "chat" | "form";

export default function BuildPage() {
  const [mode, setMode] = useState<Mode>("chat");
  // One builder instance, shared by both flows — switching modes mid-build
  // keeps the exact same paused thread and phase; neither flow owns its own copy.
  const builder = useAgentBuilder();

  return (
    <>
      <div className="page-head">
        <div className="page-head-row">
          <div>
            <h2>Build</h2>
            <p>Describe the agent you want. It searches your registry, you pick the tools, it connects anything missing.</p>
          </div>
          <div className="mode-toggle">
            <button type="button" className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>
              Chat
            </button>
            <button type="button" className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>
              Form
            </button>
          </div>
        </div>
      </div>

      {mode === "chat" ? (
        <section className="panel">
          <div className="panel-body">
            <ChatBuildFlow builder={builder} />
          </div>
        </section>
      ) : (
        <FormBuildFlow builder={builder} />
      )}

      {builder.phase.kind === "done" && (
        <section className="panel" id="playground-panel">
          <div className="panel-head">
            <h3>Playground</h3>
          </div>
          <div className="panel-body">
            <AgentPlayground agentVersionId={builder.phase.agentVersionId} />
          </div>
        </section>
      )}
    </>
  );
}
