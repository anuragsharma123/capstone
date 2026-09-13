import { useState, type FormEvent } from "react";
import type { ApiServer } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { CloseIcon } from "./icons";

interface Props {
  server: ApiServer;
  onRemove: (id: string) => void;
  onConnect: (id: string, values: Record<string, string>) => void;
  onDisconnect: (id: string) => void;
  connecting: boolean;
  connectError: string | null;
}

const COLLAPSED_LIMIT = 4;

export default function ServerCard({ server, onRemove, onConnect, onDisconnect, connecting, connectError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const tools = server.tools;
  const shown = expanded ? tools : tools.slice(0, COLLAPSED_LIMIT);
  const remaining = tools.length - COLLAPSED_LIMIT;
  const authFields = server.authSpec?.fields ?? [];

  function handleConnectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authFields.some((f) => !values[f.key]?.trim())) return;
    onConnect(server.id, values);
  }

  return (
    <div className="server-card">
      <div className="row1">
        <div>
          <div className="name">{server.name}</div>
          <div className="address" title={server.address}>
            {server.address}
          </div>
        </div>
        <button
          className="remove-btn"
          onClick={() => onRemove(server.id)}
          title="Remove server"
          aria-label={`Remove ${server.name}`}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="meta">
        <span className={`status-dot${server.connected ? "" : " unconnected"}`} title={server.connected ? "Connected" : "No credential on file"} />
        {server.connected ? (
          <>
            <span className="meta-text connected-text">Connected</span>
            <button type="button" className="connect-link" onClick={() => onDisconnect(server.id)}>
              Disconnect
            </button>
          </>
        ) : (
          <span className="meta-text">
            {tools.length} tool{tools.length === 1 ? "" : "s"}
          </span>
        )}
        {server.status !== "unknown" && (
          <span
            className={`vis-badge ${server.status === "dead" ? "dead" : "ok"}`}
            title={server.lastCheckedAt ? `Last checked ${formatRelativeTime(server.lastCheckedAt)}` : undefined}
          >
            {server.status === "dead" ? "Down" : "Up"}
          </span>
        )}
        <span className={`vis-badge${server.visibility === "open" ? " open" : ""}`}>
          {server.visibility === "open" ? "Open to all" : "Only me"}
        </span>
        {!server.connected && authFields.length > 0 && (
          <button type="button" className="connect-link" onClick={() => setConnectOpen((v) => !v)}>
            {connectOpen ? "Cancel" : "Connect"}
          </button>
        )}
        {!server.connected && authFields.length === 0 && (
          <span className="meta-text muted">No authentication defined</span>
        )}
      </div>

      {connectOpen && !server.connected && (
        <form className="connect-form" onSubmit={handleConnectSubmit}>
          {authFields.map((f) => (
            <input
              key={f.key}
              type={f.secret ? "password" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.help || f.label}
              autoComplete="off"
              autoFocus={f === authFields[0]}
            />
          ))}
          <button
            type="submit"
            className="primary"
            disabled={connecting || authFields.some((f) => !values[f.key]?.trim())}
          >
            {connecting ? "Checking…" : "Save"}
          </button>
          {connectError && <p className="connect-error">{connectError}</p>}
        </form>
      )}

      {tools.length > 0 && (
        <div className="tools-list">
          {shown.map((t) => (
            <div className="tool-row" key={t.name} title={t.description ?? undefined}>
              <span className="tool-row-name">{t.name}</span>
              <span className={`sev-chip ${t.sensitivity}`}>{t.sensitivity}</span>
            </div>
          ))}
          {remaining > 0 && (
            <button type="button" className="tool-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : `+ ${remaining} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
