import { useState } from "react";
import type { AuthField, AuthSpec, AuthType } from "../lib/api";
import { PlusIcon, CloseIcon } from "./icons";

interface Props {
  onChange: (spec: AuthSpec | null) => void;
}

type SelectType = AuthType | "none";

let nextKeyId = 1;
function makeField(): AuthField {
  return { key: `field${nextKeyId++}`, label: "", secret: true };
}

/**
 * Defines the SHAPE of the credential a server needs (type + labeled
 * fields) — never a value. Registration is discovery-only; real MCP
 * servers don't advertise this themselves, so the registrant fills it in
 * once (DESIGN-NOTES §2.7). A value is entered later, at Connect.
 */
export default function AuthSpecEditor({ onChange }: Props) {
  const [type, setType] = useState<SelectType>("none");
  const [fields, setFields] = useState<AuthField[]>([makeField()]);
  const [headerName, setHeaderName] = useState("");
  const [queryParam, setQueryParam] = useState("");

  function emit(next: { type: SelectType; fields: AuthField[]; headerName: string; queryParam: string }) {
    if (next.type === "none" || next.fields.every((f) => !f.label.trim())) return onChange(null);
    onChange({
      type: next.type,
      fields: next.fields.filter((f) => f.label.trim()),
      headerName: next.type === "header" ? next.headerName : undefined,
      queryParam: next.type === "query" ? next.queryParam : undefined,
    });
  }

  function updateField(index: number, patch: Partial<AuthField>) {
    const next = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    setFields(next);
    emit({ type, fields: next, headerName, queryParam });
  }

  return (
    <div className="auth-spec-editor">
      <div className="field">
        <label>Auth type</label>
        <select
          value={type}
          onChange={(e) => {
            const t = e.target.value as SelectType;
            setType(t);
            emit({ type: t, fields, headerName, queryParam });
          }}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="header">Custom header</option>
          <option value="basic">Basic (username + password)</option>
          <option value="query">Query parameter</option>
        </select>
      </div>

      {type !== "none" && (
        <div className="auth-spec-body">
          {type === "header" && (
            <div className="field">
              <label>Header name</label>
              <input
                value={headerName}
                onChange={(e) => {
                  setHeaderName(e.target.value);
                  emit({ type, fields, headerName: e.target.value, queryParam });
                }}
                placeholder="X-Api-Key"
              />
            </div>
          )}
          {type === "query" && (
            <div className="field">
              <label>Query parameter name</label>
              <input
                value={queryParam}
                onChange={(e) => {
                  setQueryParam(e.target.value);
                  emit({ type, fields, headerName, queryParam: e.target.value });
                }}
                placeholder="api_key"
              />
            </div>
          )}

          {fields.map((f, i) => (
            <div className="auth-field-row" key={f.key}>
              <input
                value={f.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
                placeholder={type === "basic" && i === 0 ? "Username" : type === "basic" ? "Password" : "Access token"}
              />
              <label className="secret-toggle">
                <input type="checkbox" checked={f.secret} onChange={(e) => updateField(i, { secret: e.target.checked })} />
                secret
              </label>
              {fields.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    const next = fields.filter((_, idx) => idx !== i);
                    setFields(next);
                    emit({ type, fields: next, headerName, queryParam });
                  }}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          ))}

          {type !== "basic" && fields.length < 4 && (
            <button
              type="button"
              className="add-field-btn"
              onClick={() => {
                const next = [...fields, makeField()];
                setFields(next);
                emit({ type, fields: next, headerName, queryParam });
              }}
            >
              <PlusIcon /> Add field
            </button>
          )}
        </div>
      )}
    </div>
  );
}
