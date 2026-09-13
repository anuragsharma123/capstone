import { useMemo, useState } from "react";
import type { ConfirmedToolRef, MatchedTool } from "../../lib/api";

function toolKey(role: string, mcpServerId: string, toolName: string): string {
  return `${role}:${mcpServerId}:${toolName}`;
}

function roleLabel(role: string): string {
  return role === "coordinator" ? "Coordinator" : role;
}

interface Props {
  matchedTools: MatchedTool[];
  pending: boolean;
  onConfirm: (selected: ConfirmedToolRef[]) => void;
}

/** The one tool-confirmation widget — used by both the chat and the form build flows, so "which tools" is never a UI decision duplicated in two places. Groups by role (Rule 8's coordinator/specialists) when more than one role is present, then by server within each. */
export default function ToolPickerWidget({ matchedTools, pending, onConfirm }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(matchedTools.map((t) => toolKey(t.role, t.mcpServerId, t.toolName))));

  const isMultiAgent = useMemo(() => new Set(matchedTools.map((t) => t.role)).size > 1, [matchedTools]);

  const groupedByRole = useMemo(() => {
    const byRole = new Map<string, MatchedTool[]>();
    for (const t of matchedTools) {
      const list = byRole.get(t.role) ?? [];
      list.push(t);
      byRole.set(t.role, list);
    }
    return Array.from(byRole.entries()).map(([role, tools]) => {
      const byServer = new Map<string, MatchedTool[]>();
      for (const t of tools) {
        const list = byServer.get(t.serverName) ?? [];
        list.push(t);
        byServer.set(t.serverName, list);
      }
      return [role, Array.from(byServer.entries())] as const;
    });
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
      matchedTools
        .filter((t) => checked.has(toolKey(t.role, t.mcpServerId, t.toolName)))
        .map((t) => ({ mcpServerId: t.mcpServerId, toolName: t.toolName, role: t.role }))
    );
  }

  return (
    <div className="build-widget">
      {groupedByRole.map(([role, servers]) => (
        <div key={role} className="tool-select-role">
          {isMultiAgent && <div className="tool-select-role-label">{roleLabel(role)}</div>}
          {servers.map(([serverName, tools]) => (
            <div key={serverName} className="tool-select-group">
              <div className="tool-select-server">{serverName}</div>
              {tools.map((t) => {
                const key = toolKey(t.role, t.mcpServerId, t.toolName);
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
        </div>
      ))}
      <button type="button" className="primary" onClick={submit} disabled={pending || checked.size === 0}>
        {pending ? "Checking connections…" : "Confirm tools"}
      </button>
    </div>
  );
}
