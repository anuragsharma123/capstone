# AnuragBackend

Node/TypeScript backend for the Agent Builder Platform — MCP Registry,
Connections, Agent Builder (LangGraph), Agent Runtime, and Publish/Admin
Review/Marketplace. Pairs with `capstone/frontend`. See `capstone/DesignDocs`
for the full design and `DESIGN-NOTES.md` §7 for what's actually built vs.
still open.

## Running manually

```bash
cp .env.example .env   # first time only
# generate a KMS key and paste it into .env's KMS_MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# add a real ANTHROPIC_API_KEY too — required, the Agent Builder calls Claude
npm install
npm run server:start
```

`npm run server:start` is the one to use day to day — it runs the dev
server (`tsx`, no build step needed) in the background, logs to
`server.log`, and is a no-op if already running. Pair it with `npm run
server:stop` / `npm run server:restart`.

**`npm run build` + `npm run start` is a different path** — `build` compiles
TypeScript to `dist/` (`tsc`), then `start` runs *that compiled output*
(`node dist/index.js`), not your current `src/`. If you edit `src/` and only
`start` (without rebuilding), you're running stale code. Use it for a
production-style run; use `server:start`/`npm run dev` for everyday
development.

| Command | What it does |
|---|---|
| `npm run server:start` | **Recommended** — background dev server (tsx, direct from `src/`), logs to `server.log` |
| `npm run server:stop` / `server:restart` | Stop / restart the above |
| `npm run dev` | Same dev server, foreground (blocks the terminal) |
| `npm run build` | Compile `src/` → `dist/` |
| `npm start` | Run the **compiled** `dist/index.js` — requires `build` first, and again after every `src/` change |
| `npm run typecheck` | `tsc --noEmit` |

Listens on port `8001` by default. Requires `capstone/frontend` pointed at
it (`VITE_API_BASE_URL`) and, for real tool calls, the MCP servers your
`mcp_servers` rows point at actually running (e.g. `WorkingServer`'s mocks).

## Endpoints

| Method | Path | Does |
|---|---|---|
| `POST` / `GET` | `/api/servers` | register / list MCP servers — connects, calls `tools/list`, classifies every tool |
| `DELETE` | `/api/servers/:id` | remove a server (cascades to tools + connection) |
| `POST` / `DELETE` | `/api/servers/:id/connection` | add/replace or revoke a credential |
| `POST` | `/api/agents/build` | start building an agent from a free-text prompt — pauses for tool confirmation |
| `POST` | `/api/agents/build/:threadId/resume` | resume a paused build (confirmed tools, or a missing credential) |
| `POST` | `/api/agents/:versionId/run` | run an agent — pauses if a gated tool call needs approval |
| `POST` | `/api/agents/runs/:threadId/resume` | resume a paused run with approve/reject decisions |
| `POST` | `/api/agents/:versionId/publish` | score + gate + sanitize + submit for review |
| `GET` | `/api/review-submissions` | admin review queue |
| `POST` | `/api/review-submissions/:id/decide` | approve / request changes / reject |
| `GET` | `/api/marketplace` | published (sanitized) agents |
| `GET` | `/healthz` | no-auth status check |

## What's actually built vs. simplified

See `DESIGN-NOTES.md` §7 for the authoritative, per-Rule status table. In short:

- **Built and tested end to end:** MCP Registry + Connections (incl. scheduled liveness checks), the Build Orchestrator (LangGraph — a real tool-selection sub-agent, not keyword matching; two real pause/resume points backed by a Postgres checkpointer), the Agent Runtime (real MCP tool calls, an approval gate via `humanInTheLoopMiddleware`), and Publish → Admin Review → Marketplace (a real Scoring Engine, a Sanitizer, an approve/reject queue).
- **Deliberately simplified:** no real auth — every row is scoped to one hard-coded owner/tenant (`src/tenancy.ts`); RLS policies aren't enabled (schema is RLS-ready, chosen `embedded-postgres` specifically so this is possible later); no Install (needs a second identity to mean anything); no webhook/schedule *execution* (an agent's trigger is classified and stored, nothing invokes it automatically yet).
- **Credentials:** envelope-encrypted (`src/crypto.ts`), never stored or returned in plaintext — verified via `services/registry.ts`'s `storeConnection`/`getConnectionAuth` (fetch → use → drop, same pattern used by both the health checker and the Agent Runtime).

## Structure

```
src/
  config.ts        env validation (PORT, PG_*, KMS_MASTER_KEY, ANTHROPIC_API_KEY) — fails fast
  tenancy.ts        the hard-coded owner/tenant, isolated to one file
  db.ts             embedded-postgres lifecycle + pg.Pool + schema
  crypto.ts         envelope encryption (Rule 3)
  classify.ts       read/write/destructive classification (Rule 4)
  mcpClient.ts      real MCP discovery + tool calls (tools/list, tools/call)
  authSpec.ts       credential shape contract + attach-to-request logic
  health.ts         scheduled liveness check (servers + connections)
  checkpointer.ts   shared Postgres-backed LangGraph checkpointer (build + run)
  build/graph.ts    the Build Orchestrator — parse_intent, tool-selection sub-agent, present_tools/check_connections/request_credentials
  run/runtime.ts    the Agent Runtime — createAgent + humanInTheLoopMiddleware
  services/
    registry.ts     MCP Registry + Connections business logic
    builder.ts       Agent Config Store — persists what build/graph.ts produces
    runner.ts        drives run/runtime.ts, records graph_runs
    scoring.ts       Scoring Engine (pure function, no LLM)
    sanitizer.ts      strips a config to its publishable manifest
    review.ts        Admin Review decisions + Marketplace listing
    publish.ts       score → gate → sanitize → submit for review
  routes/
    servers.ts, agents.ts, runs.ts, publish.ts   Express routers — thin, call services/
  index.ts          app bootstrap, CORS, mount routes, start health checker + checkpointer
```
