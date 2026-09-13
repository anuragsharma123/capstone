import { useState, type FormEvent } from "react";
import { PlusIcon } from "./icons";
import AuthSpecEditor from "./AuthSpecEditor";
import { IMPLEMENTED_TRANSPORTS, type AuthSpec, type Transport, type Visibility } from "../lib/api";

export interface AddServerValues {
  name: string;
  transport: Transport;
  address: string;
  visibility: Visibility;
  authSpec: AuthSpec | null;
  /** Used only to authenticate discovery itself — never stored. See lib/api.ts. */
  discoveryValues: Record<string, string>;
}

const TRANSPORT_LABELS: Record<Transport, string> = {
  streamable_http: "Streamable HTTP",
  sse: "SSE (not yet supported)",
  stdio: "stdio (not yet supported)",
};

export interface FormStatus {
  kind: "loading" | "success" | "error";
  message: string;
}

interface Props {
  onSubmit: (values: AddServerValues) => void;
  pending: boolean;
  status: FormStatus | null;
}

const ADDRESS_PLACEHOLDER = "https://your-mcp-server.example.com/endpoint";

export default function AAddServerForm({ onSubmit, pending, status }: Props) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("streamable_http");
  const [address, setAddress] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("open");
  const [authSpec, setAuthSpec] = useState<AuthSpec | null>(null);
  const [discoveryValues, setDiscoveryValues] = useState<Record<string, string>>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ name: name.trim(), transport, address: address.trim(), visibility, authSpec, discoveryValues });
  }

  return (
    <>
      <form className="add-server-form" onSubmit={handleSubmit}>
        <div className="field name-field">
          <label htmlFor="fName">Name</label>
          <input
            id="fName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GitHub + Gmail"
            required
          />
        </div>
        <div className="field transport-field">
          <label htmlFor="fTransport">Transport</label>
          <select id="fTransport" value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
            {(Object.keys(TRANSPORT_LABELS) as Transport[]).map((t) => (
              <option key={t} value={t} disabled={!IMPLEMENTED_TRANSPORTS.includes(t)}>
                {TRANSPORT_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field address-field">
          <label htmlFor="fAddress">MCP address</label>
          <input
            id="fAddress"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={ADDRESS_PLACEHOLDER}
            required
          />
        </div>
        <div className="field vis-field">
          <label htmlFor="fVisibility">Visibility</label>
          <select id="fVisibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="open">Open to all</option>
            <option value="private">Only me</option>
          </select>
        </div>
        <AuthSpecEditor onChange={setAuthSpec} />
        {authSpec && (
          <div className="discovery-auth">
            <p className="discovery-auth-label">
              Only if this server needs auth just to list its tools — used once for discovery, <b>not saved</b>.
              You'll enter it again after registering to actually connect.
            </p>
            {authSpec.fields.map((f) => (
              <input
                key={f.key}
                type={f.secret ? "password" : "text"}
                value={discoveryValues[f.key] ?? ""}
                onChange={(e) => setDiscoveryValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={`${f.label} (optional)`}
                autoComplete="off"
              />
            ))}
          </div>
        )}
        <button type="submit" className="primary" disabled={pending}>
          <PlusIcon />
          {pending ? "Connecting…" : "Add server"}
        </button>
      </form>

      <p className="form-help">
        Paste the server's Streamable HTTP address — the platform connects, calls <code>tools/list</code>, and
        reads each tool's sensitivity straight off its MCP annotations. Registration never asks for a credential
        value: if the server needs auth, describe its shape above (what field, attached how) — you'll enter the
        actual token afterwards on the server's card.
      </p>

      {status && (
        <p className={`form-status ${status.kind}`}>
          {status.kind === "loading" && <span className="spin" aria-hidden="true" />}
          <span>{status.message}</span>
        </p>
      )}
    </>
  );
}
