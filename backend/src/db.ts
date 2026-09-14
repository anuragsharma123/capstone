// Persistence: a real Postgres — via `embedded-postgres`, a genuine
// prebuilt Postgres binary downloaded through npm (no Docker, no system
// install). Chosen over SQLite specifically because the documented design
// (data-model.html, DESIGN-NOTES §2.3) depends on row-level security,
// which only Postgres has — SQLite can't express it at all.
//
// Column shape matches data-model.html / DESIGN-NOTES §6: owner_id +
// tenant_id on every user-owned table, credentials only ever as
// ciphertext + wrapped_dek in `connections` — never a token column
// anywhere else.
//
// What's simplified here vs. the documented design: RLS policies aren't
// enabled yet (owner_id/tenant_id are hard-coded — see tenancy.ts, there's
// no auth system yet, so there's only one owner to isolate). The schema is
// already RLS-ready; enabling it is a natural next step once real auth
// exists. See README "What's deliberately simplified".
import { resolve, join } from "node:path";
import { access } from "node:fs/promises";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { config } from "./config.js";

const embedded = new EmbeddedPostgres({
  databaseDir: resolve(config.PG_DATA_DIR),
  user: "anurag",
  password: config.PG_PASSWORD,
  port: config.PG_PORT,
  persistent: true,
});

let pool: pg.Pool | undefined;
let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await pool?.end().catch(() => undefined);
  await embedded.stop().catch(() => undefined);
}
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

/** True once `initdb` has populated the data directory — the marker file Postgres itself writes on init. */
async function isAlreadyInitialised(): Promise<boolean> {
  try {
    await access(join(resolve(config.PG_DATA_DIR), "PG_VERSION"));
    return true;
  } catch {
    return false;
  }
}

/** Starts (or resumes) the embedded cluster, connects, and ensures the schema exists. Call once at boot. */
export async function connectDatabase(): Promise<void> {
  if (pool) return;

  // embedded-postgres's initialise() always runs `initdb` unconditionally —
  // it does NOT skip on an already-initialised directory itself (despite
  // what an older comment here claimed). `initdb` then fails outright with
  // "directory ... exists but is not empty" on every restart against a
  // real data dir. Guard it ourselves using the same marker file `initdb`
  // itself checks for.
  if (!(await isAlreadyInitialised())) {
    await embedded.initialise();
  }
  await embedded.start();

  pool = new pg.Pool({
    host: "127.0.0.1",
    port: config.PG_PORT,
    user: "anurag",
    password: config.PG_PASSWORD,
    database: "postgres",
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'streamable_http',
      visibility TEXT NOT NULL DEFAULT 'open',
      auth_spec JSONB,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (owner_id, address)
    );

    ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'streamable_http';
    ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS auth_spec JSONB;
    ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS mcp_tools (
      id UUID PRIMARY KEY,
      server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sensitivity TEXT NOT NULL,
      sensitivity_source TEXT NOT NULL,
      annotations JSONB,
      input_schema JSONB,
      UNIQUE (server_id, name)
    );

    CREATE TABLE IF NOT EXISTS connections (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      ciphertext BYTEA NOT NULL,
      wrapped_dek BYTEA NOT NULL,
      config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE (owner_id, server_id)
    );

    ALTER TABLE connections ADD COLUMN IF NOT EXISTS config JSONB;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      id UUID PRIMARY KEY,
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version INT NOT NULL,
      config JSONB NOT NULL,
      effectiveness_score NUMERIC(5, 2),
      safety_score NUMERIC(5, 2),
      score_breakdown JSONB,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (agent_id, version)
    );
    CREATE INDEX IF NOT EXISTS agent_versions_owner_status_idx ON agent_versions (owner_id, status);

    CREATE TABLE IF NOT EXISTS graph_runs (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      agent_version_id UUID REFERENCES agent_versions(id),
      kind TEXT NOT NULL CHECK (kind IN ('build', 'playground', 'review')),
      thread_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'failed')),
      interrupt_kind TEXT CHECK (interrupt_kind IN ('select_servers', 'add_connection', 'await_approval')),
      interrupt_payload JSONB,
      -- What a *completed* run actually did — {output: string}. Distinct
      -- from interrupt_payload (which only ever describes a pause): a run
      -- with nobody synchronously watching (a webhook trigger, no browser
      -- tab open) would otherwise finish with zero audit trail — its final
      -- response just discarded. Playground still shows its own response
      -- directly, same as before; this is what makes an unattended run
      -- reviewable after the fact.
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS graph_runs_owner_interrupted_idx ON graph_runs (owner_id, status) WHERE status = 'interrupted';
    ALTER TABLE graph_runs ADD COLUMN IF NOT EXISTS result JSONB;
    -- What actually triggered a 'playground'-kind run — the typed message
    -- (manual test) or the webhook's translated payload. Without this, run
    -- history can show what an agent answered but never what it was asked.
    ALTER TABLE graph_runs ADD COLUMN IF NOT EXISTS trigger_message TEXT;

    -- The review island (data-model.html "Cross-tenant by design — the
    -- marketplace door is the one place isolation is relaxed"): no owner_id,
    -- no tenant_id. graph_run_id (kind='review') is the only way back to a
    -- tenant, and only the Sanitizer's output ever lands here — never the
    -- raw config.
    CREATE TABLE IF NOT EXISTS review_submissions (
      id UUID PRIMARY KEY,
      graph_run_id UUID NOT NULL REFERENCES graph_runs(id),
      sanitized_manifest JSONB NOT NULL,
      effectiveness_score NUMERIC(5, 2) NOT NULL,
      safety_score NUMERIC(5, 2) NOT NULL,
      score_breakdown JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'changes_requested', 'rejected')),
      priority INT NOT NULL DEFAULT 100,
      decision_notes TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS review_submissions_pending_idx ON review_submissions (priority, submitted_at) WHERE status = 'pending';

    -- Public listing — sanitized content only, denormalized so a read never
    -- needs to cross back into a tenant-scoped table.
    CREATE TABLE IF NOT EXISTS marketplace (
      id UUID PRIMARY KEY,
      review_submission_id UUID NOT NULL REFERENCES review_submissions(id),
      sanitized_manifest JSONB NOT NULL,
      effectiveness_score NUMERIC(5, 2) NOT NULL,
      safety_score NUMERIC(5, 2) NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Database not connected yet — call connectDatabase() first.");
  return pool;
}
