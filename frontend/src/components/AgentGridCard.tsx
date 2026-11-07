import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { scoreGrade } from "../lib/format";

export interface AgentGridTag {
  key: string;
  label: string;
  variant?: "read" | "write" | "destructive" | "accent" | "plain";
}

interface Props {
  name: string;
  status: string;
  statusLabel: string;
  description: string;
  tags: AgentGridTag[];
  effectivenessScore: number | null;
  safetyScore: number | null;
  /** One trailing line of screen-specific context — "Weekdays 08:00 · 41 runs · 2h ago" for My Agents, "submitted 3h ago" for Admin Review, "published 2d ago" for Marketplace. */
  meta: string;
  /** Present only when this card should open that agent's own page — My Agents and Admin Review (a reviewer needs the real thing). Marketplace cards never get one: linking a sanitized public listing to its owner's private page would defeat the whole point of sanitizing it (Rule 2/5). */
  href?: string;
  /** Card-specific controls below the meta line — Approve/Reject on Admin Review, "Add to my workspace" on Marketplace. Absent on My Agents, which only ever navigates. */
  actions?: ReactNode;
}

function tagClass(variant: AgentGridTag["variant"]): string {
  if (variant === "read" || variant === "write" || variant === "destructive") return `sev-chip ${variant}`;
  if (variant === "accent") return "tag-chip accent";
  return "tag-chip";
}

/**
 * The one agent card — same shape on My Agents, Marketplace, and Admin
 * Review, so "what does this agent look like" is never a UI decision made
 * three separate times. Screens differ only in which fields they have
 * available (Marketplace/Review only ever see the sanitized manifest — no
 * server names, no owner) and what actions/click-through make sense given
 * who's looking (see `href`'s doc comment for why Marketplace never links out).
 */
export default function AgentGridCard({ name, status, statusLabel, description, tags, effectivenessScore, safetyScore, meta, href, actions }: Props) {
  const info = (
    <>
      <div className="agent-list-card-head">
        <span className="agent-list-card-name">{name}</span>
        <span className={`status-chip ${status}`}>{statusLabel}</span>
      </div>
      <p className="agent-list-card-desc">{description}</p>
      <div className="agent-list-card-tags">
        {tags.length === 0 ? <span className="tag-chip">reasoning only</span> : tags.map((t) => <span className={tagClass(t.variant)} key={t.key}>{t.label}</span>)}
      </div>
      <div className="grid-card-scores">
        <span className="grid-card-score">
          <span className="score-label">Effectiveness</span>
          <span className="score-number">{effectivenessScore ?? "—"}</span>
          {effectivenessScore !== null && <span className="score-grade">{scoreGrade(effectivenessScore)}</span>}
        </span>
        <span className="grid-card-score">
          <span className="score-label">Safety</span>
          <span className="score-number">{safetyScore ?? "—"}</span>
        </span>
      </div>
      <div className="agent-list-card-meta">{meta}</div>
    </>
  );

  // `actions` can hold real interactive controls (a textarea, buttons) —
  // those must never end up nested inside the <Link> below. An <a> wrapping
  // a <button>/<textarea> is invalid HTML and browsers handle its click
  // targets and focus order inconsistently. So the Link only ever wraps the
  // read-only `info` block; `actions` always renders as a sibling, outside it.
  return (
    <div className="agent-list-card" style={{ cursor: href ? undefined : "default" }}>
      {href ? (
        <Link to={href} className="agent-grid-card-link">
          {info}
        </Link>
      ) : (
        info
      )}
      {actions}
    </div>
  );
}
