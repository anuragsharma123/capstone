import { useMemo, useState } from "react";
import type { ConfirmedToolRef, MatchedTool } from "../../lib/api";

function toolKey(mcpServerId: string, toolName: string): string {
  return `${mcpServerId}:${toolName}`;
}

interface Props {
  matchedTools: MatchedTool[];
  pending: boolean;
  onConfirm: (selected: ConfirmedToolRef[]) => void;
}

/** The one tool-confirmation widget — used by both the chat and the form build flows, so "which tools" is never a UI decision duplicated in two places. */
export default function ToolPickerWidget({ matchedTools, pending, onConfirm }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(matchedTools.map((t) => toolKey(t.mcpServerId, t.toolName))));

  const grouped = useMemo(() => {
    const bySever = new Map<string, MatchedTool[]>();
    for (const t of matchedTools) {
      const list = bySever.get(t.serverName) ?? [];
      list.push(t);
      bySever.set(t.serverName, list);
    }
    return Array.from(bySever.entries());
  }, [matchedTools]);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    onConfirm(
      matchedTools.filter((t) => checked.has(toolKey(t.mcpServerId, t.toolName))).map((t) => ({ mcpServerId: t.mcpServerId, toolName: t.toolName }))
    );
  }

  return (
    <div className="build-widget">
      {grouped.map(([serverName, tools]) => (
        <div key={serverName} className="tool-select-group">
          <div className="tool-select-server">{serverName}</div>
          {tools.map((t) => {
            const key = toolKey(t.mcpServerId, t.toolName);
            return (
              <label key={key} className="tool-select-row">
                <input type="checkbox" checked={checked.has(key)} onChange={() => toggle(key)} />
                <span className="tool-select-name">{t.toolName}</span>
                <span className={`sev-chip ${t.sensitivity}`}>{t.sensitivity}</span>
              </label>
            );
          })}
        </div>
      ))}
      <button type="button" className="primary" onClick={submit} disabled={pending || checked.size === 0}>
        {pending ? "Checking connections…" : "Confirm tools"}
      </button>
    </div>
  );
}
