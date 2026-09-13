import { useState } from "react";
import type { CredentialSubmission, MissingServer } from "../../lib/api";

interface Props {
  missingServers: MissingServer[];
  pending: boolean;
  onConnect: (credentials: CredentialSubmission[]) => void;
}

/** The one missing-connection widget — shared by both build flows, and structurally the same form the Connections/Registry screens already use for the same auth_spec shape. */
export default function ConnectionsWidget({ missingServers, pending, onConnect }: Props) {
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  function submit() {
    onConnect(missingServers.map((s) => ({ mcpServerId: s.mcpServerId, values: values[s.mcpServerId] ?? {} })));
  }

  return (
    <div className="build-widget">
      {missingServers.map((s) => (
        <div key={s.mcpServerId} className="tool-select-group">
          <div className="tool-select-server">{s.serverName}</div>
          <div className="connect-form">
            {s.authSpec.fields.map((f) => (
              <input
                key={f.key}
                type={f.secret ? "password" : "text"}
                value={values[s.mcpServerId]?.[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [s.mcpServerId]: { ...v[s.mcpServerId], [f.key]: e.target.value } }))}
                placeholder={f.help || f.label}
                autoComplete="off"
              />
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="primary" onClick={submit} disabled={pending}>
        {pending ? "Connecting…" : "Connect and finish"}
      </button>
    </div>
  );
}
