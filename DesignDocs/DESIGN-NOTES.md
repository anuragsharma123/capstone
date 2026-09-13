# Design Notes — Data Sense / Agent Marketplace

Running log of the design discussion so we don't lose the thread.
**Append, date your edits, don't rewrite history.** Decisions that get reversed stay in the log with a note.

- Started: 2026-09-08
- Last updated: 2026-09-13 (Rule 8 — real multi-agent coordinator/specialist system built and verified end to end, not just a config schema. `parse_intent` now decides `graph.type` (`sequential` vs `coordinator_specialist`) and proposes named specialist roles when a request genuinely splits into distinct delegated sub-tasks; `search_registry` runs `selectToolsForRole` once per role (coordinator + each specialist, via `Promise.all`), tagging every matched tool with `role`. Config assembly (`services/builder.ts`) partitions confirmed tools by role and **reassigns any non-read tool to the coordinator in code, regardless of which role picked it** — the structural mechanism that keeps Rule 4 intact under Rule 8: only the coordinator ever gets `humanInTheLoopMiddleware`, so a specialist can never silently bypass the approval gate. `run/runtime.ts` builds each specialist as its own plain `createAgent` (no checkpointer, no HITL) wrapped as a `tool()` for the coordinator; the coordinator alone keeps the checkpointer + `interrupt_before`. Live test (GitHub issue triage → Slack digest, specialists `issue_gatherer` + `severity_assessor`): both specialists ran and returned real findings without ever pausing; the coordinator's `slack_send_message` call correctly triggered the approval gate; approving it executed the tool for real (confirmed via the `tool executed: ...` audit log, twice — the mock Slack server rejected the first channel-ID format and the model retried, both attempts properly gated); the agent reported the eventual failure honestly rather than fabricating success. Nothing in the schema/code caps specialist count at 2 — `specialists` is a plain array end to end (`build/graph.ts`, `services/builder.ts`, `run/runtime.ts` all just `.map()`/`Promise.all` over it); this test produced 2 because `parse_intent` inferred exactly 2 roles from that prompt, not because of a hardcoded limit.)
- Earlier: 2026-09-12 (`search_registry` rebuilt as a real tool-selection sub-agent — a second, distinct LLM call shown the full registry catalog, asked to pick the minimal tool set the request needs. Replaces the original ILIKE keyword match, which over-matched badly: a "post to Slack on commit" request came back with every GitHub tool including `delete_file`/`create_repository`, because loose keywords like "commit" hit unrelated tool descriptions server-wide. Every model pick is still re-validated against the real catalog before use — sensitivity always from that row, never the model (Rule 4). Also: Build page UI shipped — a real chat flow (`ChatBuildFlow`) plus a form-mode toggle (`FormBuildFlow`), both driving one shared `useAgentBuilder()` hook so there's exactly one client-side builder; the paused phase now persists to localStorage so a reload doesn't strand the user mid-build.)
- Earlier: 2026-09-12 (Publish lane built: Scoring Engine (`services/scoring.ts`, §2.12's draft formula), Sanitizer (`services/sanitizer.ts`), Admin Review + Marketplace (`services/review.ts`) — full score→gate→sanitize→review→marketplace cycle verified end to end, including both the publish gate actually blocking a low-scoring agent and a rejection sending an `agent_versions` row back to `draft`. Deliberately not built: `resume_outbox`/a worker — publish isn't modeled as a pause inside the build graph here, see §7. Install still not built — needs a second identity to mean anything, see §7.)
- Earlier: 2026-09-12 (Agent Runtime + Approval Gate built and verified end to end — real MCP tool calls via a new `callTool()`, gated by langchain's `humanInTheLoopMiddleware` on `interrupt_before`; new §7 tracks actual implementation status per Rule, separate from §4's design-walkthrough checkboxes)
- Earlier: 2026-09-12 (§2.13 + §4 + §6 — the liveness check now tells a rejected credential apart from an unreachable server: a connected server that comes back 401/403 stays `mcp_servers.status='ok'` but its `connections.status` flips to `expired`; every ping also stamps `connections.last_used_at`. Connections screen (`ConnectionsPage.tsx`) rebuilt as a real table — Server / Status / Secret / Added / Last used / Revoke — backed by these two new columns)
- Earlier: 2026-09-12 (§2.13 + §4 — the scheduled health check now pings a connected server with its decrypted credential, `decryptToken()`'s first real caller; fixes a real false-"dead" on github-mcp-server, verified)
- Earlier: 2026-09-11 (§2.7 addendum 2 — discovery-only credential added so registration can discover a server that gates tools/list behind auth, e.g. the real github-mcp-server; §4 MCP Registry box corrected — auth_spec is registrant-defined, not derived; §6 schema snapshot updated with `transport`/`status`/`last_checked_at`)

---

## 0. How to use this file

- **§1 Documents** — the HTML deliverables and what each covers.
- **§2 Decisions** — every design call made so far, with the reason. This is the important section.
- **§3 Q&A log** — questions asked during review and the short answer.
- **§4 Walkthrough progress** — where we are in the box-by-box review of the architecture.
- **§5 Open questions** — not yet decided.
- **§6 Schema snapshot** — current table list + isolation keys.
- **§7 Implementation status** — what's actually built vs. decided-only, per Rule and per lane. Check here, not §4, for "is this real yet."

---

## 1. Documents (`AnuragDocs/` in the repo)

| File | Covers | Artifact URL |
|---|---|---|
| `highlevel-architecture.html` | System overview diagram (clients → App Server → Platform Services → Postgres), the six-step flow, rules→mechanism table, durable-pause diagram | claude.ai/code/artifact/479d78a5-c063-4afa-983c-10af15a7749e |
| `data-model.html` | Lowest-level Postgres schema, ER diagram, **RLS explainer**, admin-queue (why one Postgres not NoSQL), SKIP LOCKED / outbox patterns | claude.ai/code/artifact/935f2fdd-9981-4397-ae5c-52148f8ad98b |
| `end-to-end-flow.html` | Single start-to-finish flowchart for explaining to the team — 3 phases, 4 human checkpoints, 3 gates | claude.ai/code/artifact/b296a19b-d108-4d09-a059-bdfaf3ec8353 |
| `connection-data-flow.html` | MCP server + tool + connection sequence data-flow; tool read/write/destructive classification; envelope encryption; task-mandated vs. our-design | claude.ai/code/artifact/0fa970cf-637f-44eb-bdc1-a8f18642d46f |
| `agent-builder-data-flow.html` | Build Orchestrator end to end — LangGraph plan/pause/generate/score/deploy sequence; interrupt mechanics; **generate_config** (config doc shape, LLM-vs-code split); **score_agent** (rubric + worked example); **Publish → Review → Marketplace** (Sanitizer, admin decide, why it's not a build-graph pause — added 2026-09-12) | claude.ai/code/artifact/4d8bb24c-8657-41c9-882a-6d6a296e757f |
| `design-pack.html` | **Team reading guide** — what each doc covers, order to read, key decisions, still-open list. Share this one. | claude.ai/code/artifact/f21c4b03-e690-411c-a1a9-ff56f68da990 |
| `README.md` | Plain-text index of `AnuragDocs/` for repo navigation | — |
| `system-design.html` | **Teammate's earlier spec — NOT ours.** Left untouched; we are writing our own design based on the four docs above. |

---

## 2. Decisions

### 2.1 Agent = configuration document, not code  *(Rule 1)*
The platform "builds" an agent by writing a versioned JSON/JSONB document. One shared runtime reads any document and assembles the LangGraph graph. No Python generated or executed per agent.
**Why:** versioning, safety, and the ability to publish an agent into another workspace all fall out of this one choice.

### 2.2 One PostgreSQL — including the admin review queue
No NoSQL, even for the "admin gets bombarded" queue.
**Why:**
- Grading check 1 removes the app-level filter → isolation must be enforced *in the DB*. RLS.
- "Approve" must record the decision **and** schedule the run resume in **one transaction** (checks 5 & 6). Two datastores = dual-write / "approved but never resumed".
- The audit trail wants to be relational (joins to `users`).
- "Bombardment" is a workflow problem: partial index on `status='pending'`, `FOR UPDATE SKIP LOCKED` for concurrent admins, partial-unique index so resubmits don't stack, `priority` for triage, Rule 6 keeps sub-threshold agents out entirely.
- Loose-shaped data still gets `jsonb` columns inside the same DB.

### 2.3 RLS keyed on `owner_id` + `tenant_id`  *(not tenant alone)*  — 2026-09-09
The row-security policy on every user-owned table is:
```sql
using (owner_id = current_setting('app.user_id')::uuid
   and tenant_id = current_setting('app.tenant_id')::uuid)
```
**Why:** Rule 2 says "my agents, my connections, my runs — mine. Nobody else," and grading check 1 is **user**-to-user. A tenant-only policy would let a teammate read your agents once the app filter is removed. `tenant_id` stays as a second barrier and for the marketplace / install / admin / billing paths.
- App connects as a **non-superuser** role (superusers ignore RLS).
- `FORCE ROW LEVEL SECURITY` so the table-owner role obeys too.
- Middleware runs `SET LOCAL app.user_id` / `app.tenant_id` per transaction, from the verified JWT — `SET LOCAL` so pooled connections don't leak identity.
- Read as `current_setting('app.user_id', true)` → `NULL` when unset → policy matches nothing (fail closed).

### 2.4 Which tables carry `owner_id`  — 2026-09-09
**Six user-owned tables:** `mcp_servers`, `mcp_tools`, `connections`, `agents`, `agent_versions`, `graph_runs`.
- `users` → keyed on `tenant_id` (you see your own colleagues).
- `tenants` → root, neither key.
- The registry is **per-user**: each person registers their own servers, classifies their own tools, connects with their own token. Nothing shared between teammates except `tenant` membership.

### 2.5 The isolation exception — marketplace tables have no RLS
`marketplace`, `review_submissions`, `resume_outbox` → **RLS not enabled**, granted only to a separate `app_reviewer` role.
**Why:** the marketplace is meant to be cross-tenant; that's why an admin guards it. The exception lives in the grant, not in a `WHERE` clause someone could forget. Rows are sanitized on entry (Rule 5), so even cross-tenant readers see no company data.

### 2.6 Credentials — envelope encryption  *(Rule 3)*
- Token travels **once** over TLS in the `POST /connections` body.
- Vault generates a fresh per-connection **DEK**, AEAD-encrypts the token → `ciphertext`.
- **KMS** wraps the DEK with a master key that never leaves the KMS → `wrapped_dek`.
- Only `ciphertext` + `wrapped_dek` are stored. Plaintext wiped from memory, never logged/echoed.
- Use = fetch → decrypt in memory → one call → drop. Never in `agent_versions.config`, logs, checkpoints, or API responses.

**What the task actually mandates vs. what we chose:**
- Task fixes the *outcome*: "encrypted immediately", "fetch it, use it, drop it", "search everything you stored — finding it is a fail".
- We chose the *mechanism*: envelope encryption, the KMS boundary, per-connection DEK.
- **Floor:** a single Fernet key in an env var on the token column already passes the grep test. Envelope + KMS is a strengthening (rotation, blast radius, audit), not required.
- **"Vault" is our name for the module**, not a mandate to run HashiCorp Vault.
- Capstone KMS = one master key in an env var; `wrap`/`unwrap` = a small Fernet function.

### 2.7 `auth_spec jsonb` on `mcp_servers`  — 2026-09-09
Describes the *shape* of the credential a server needs — `type` (bearer/header/basic/query), `fields[]` (label, help, `secret` flag), optional `test` call. Holds **no value**.
- Drives what the Connections form renders.
- `secret:true` fields → encrypted into `connections.ciphertext`; `secret:false` fields (base URL, org) → plain `connections.config jsonb`.
- Populated at registration — from the server's own metadata if advertised, else an *Authentication* section the registrant fills once. Read-only thereafter.

**Addendum — 2026-09-11:** built as registrant-defined only; the "from the server's own metadata if advertised" path was not implemented. Real MCP `tools/list` responses have no standard field to capture this from, so it would have been dead code — every real server would fall through to the *Authentication* section anyway. Also dropped the `test` call: verification reuses the same discovery call from registration, now with the submitted credential attached, instead of a second server-specific concept. `headerName`/`queryParam` were added to the shape (required for `header`/`query` types respectively, which need to know *which* header or param to use). See connection-data-flow.html §authspec.

**Addendum 2 — 2026-09-11:** the real `github-mcp-server` binary (unlike `WorkingServer`'s mock) requires auth unconditionally, even to answer `tools/list` — so with registration calling discovery fully unauthenticated, that server could never be registered at all. Register rule 2 is unconditional ("your platform connects to the server and asks it what tools it has") — it has no carve-out for auth-required servers, so failing to discover one is the platform not meeting its own rule, not a server-specific edge case to shrug off. Fix: `POST /api/servers` now accepts an optional `discoveryValues` map, used **only** to authenticate that one discovery call (`registerServer()` builds the attachment via `attachAuth()` and passes it straight to `listTools()`) — it is never written to `connections` or anywhere else, and the registered server still comes back `connected: false`. Storing a credential is still exclusively the Connect step's job; this only unblocks *discovering* a server that gates its tool list behind auth. Verified against the real binary: a bogus token now gets a 400 (server received and rejected it) vs. 401 with none supplied (proves the value actually reaches the call).

### 2.8 Tool classification — `read` / `write` / `destructive`  *(Rule 4)*
Stored on `mcp_tools.sensitivity` (+ `sensitivity_source`, `annotations`). Computed by `classify()` at discovery:
1. platform **override catalog** (`tool_classification_overrides`, no tenant_id) — wins.
2. MCP **annotations** — used only when they make a tool *more* restrictive (spec says hints aren't trustworthy for security).
3. **name/description heuristic** — verb matching.
4. no confident match → **`write`** (fail-safe, never `read`).

Enforced at three points, not one:
- **Build** — write/destructive tool → `require_approval = true` in the config; a config that sets it false is rejected.
- **Runtime** — re-reads `mcp_tools.sensitivity` from the DB before *every* tool call → interrupt regardless of config/prompt. This is the check that survives removing the app filter.
- **Publish** — unguarded write/destructive tool → safety score below threshold → Publish disabled (check 3).

Tenant **cannot** lower a classification. Only a platform admin, via the override catalog (audited).

### 2.9 Clients — two, not four  — 2026-09-09
| Client | Principal | Notes |
|---|---|---|
| **Web app (browser)** | tenant user *or* platform admin (role decides visible tabs) | tenant-scoped surfaces + Marketplace (cross-tenant reads) + Admin Review (admin role) |
| **External API callers** | API token | `POST /agents/{id}/invoke`; wrong tenant → **404, not 403** |

- Marketplace and Admin Review are **surfaces inside the web app**, not separate clients.
- **Marketplace requires login** — it is not a public/anonymous view. "Cross-tenant" ≠ "open".
- The isolation exception is enforced in the **data layer** (marketplace tables have no RLS), not at the client.

### 2.11 Agent config document — draft shape  — 2026-09-09
`agent_versions.config jsonb` holds: `schema_version`, `name`, `description`, `model`, `system_prompt`, `graph` (`{type: sequential | coordinator_specialist, …}`), `tools[]` (`{mcp_server_id, tool_name, sensitivity, require_approval}`), `interrupt_before[]`.
- **LLM decides:** prose (`name`/`description`/`system_prompt`) + `graph.type`.
- **Code decides:** the whole `tools[]` array, `sensitivity`, `require_approval`, `interrupt_before` — copied from `mcp_tools`. The safety gate is never a model's opinion (Rule 4).
- Tools referenced by `mcp_server_id` + capability, **never a credential** → the runtime resolves it to the caller's own connection → portable across tenants.
- Still open: schedule/trigger fields (the cron executor itself remains unbuilt — see §7).

**Addendum — 2026-09-13 (Rule 8 sub-agent representation, resolved):** `graph.type: "coordinator_specialist"` carries `specialists: SpecialistConfig[]`, each `{name, description, system_prompt, tools: AgentConfigTool[]}`. The top-level `tools[]`/`interrupt_before[]` are the **coordinator's own** — distinct from each specialist's nested `tools[]`. No specialist tool ever carries `require_approval: true`: config assembly reassigns any non-read tool to the coordinator regardless of which role's tool-selection call picked it, so the shape itself guarantees a specialist can't hold a gated action. See the 2026-09-13 log entry above for the runtime side.

### 2.12 Scoring rubric — draft  — 2026-09-09
Pure function over the config, no LLM. Two numbers + a stored `score_breakdown`.
- **Effectiveness/100:** tool coverage `min(servers×10,30)` · prompt quality ≤25 · model tier (20/10/5) · graph complexity (15/10/5) · schedule present 10.
- **Safety/100:** write gated `w_appr/w_total×40` · destructive gated `d_appr/d_total×30` (10 if none) · no-creds-in-config regex 20 · read-only ratio `read/total×10`.
- **Publish gate:** blocked if `effectiveness < 60` OR `safety < 70`. Thresholds = a decision, tune later.
- Lives in the standalone **Scoring Engine** module; called by the build's `score_agent` node and re-run on edit / re-introspection.

### 2.10 EDGE layer — Auth is part of the App Server  — 2026-09-09
One box: the **App Server**, with **Auth** nested inside it.
- Auth = verify JWT on every request, mint it on login. Not a separate service (it's Auth.js / JWT middleware in the app).
- App Server = **plumbing, no product logic**: read `user_id`+`tenant_id` from token → `SET LOCAL` (tenant-context middleware) → route to a Platform Service → handle SSE streams.
- Both clients enter through this one box. Nothing talks to Auth directly.
- This is the single most important spot for Rule 2 — if the middleware doesn't set the session vars, RLS fails.

### 2.13 Connection-screen scope boundary: fetch/use/drop and degrade-on-revoke belong to the Run lane  — 2026-09-11
The Connection screen's spec has four requirements. Two are the screen's own job and are built (AnuragBackend): add a credential once, encrypted immediately (§2.6); never return it to a user, agent, or log. The other two are runtime behavior, not registry/connection behavior, and can't be built until the Run lane exists:
- **"Fetch it, use it for that one call, drop it"** — for an actual agent tool call, this is still the Agent Runtime's job and still can't be built before it exists. **Update — 2026-09-12:** `decryptToken()` now has its first real caller, though: the scheduled health check (`health.ts` → `getConnectionAuth()` in `registry.ts`) fetches a connected server's credential, decrypts it, attaches it to one discovery ping, and drops it — same pattern, different trigger (a scheduled check, not a tool call). This was needed so a connected server that gates `tools/list` behind auth (e.g. the real `github-mcp-server`) doesn't read as permanently "dead" (§4). The *agent*-tool-call version of fetch/use/drop remains Run lane scope.
- **Update — 2026-09-12 (second):** that same call site now also reports back onto the `connections` row it read from — `touchConnectionUsage()` in `registry.ts` stamps `last_used_at` on every attempted use, and sets `status` from the outcome: a 401/403 (the credential itself rejected, distinct from the server being unreachable) sets `status='expired'`; anything else that succeeds sets `status='active'`. Reconnecting via Connect (`addConnection` → `storeConnection`) also resets `status='active'` immediately, rather than waiting for the next tick. This is what feeds the Connections screen's Status/Last-used columns — see §4 and `connection-data-flow.html` "Reverse path" update.
- **"Revoking one must leave dependent agents degraded, not crashed"** — degradation is a property of how the Agent Runtime handles a missing connection mid-run; it requires agents and runs to exist first (`agents`, `graph_runs` — still unbuilt, §4). Unchanged by the health-check update above — that's a liveness ping, not an agent run.
**Why this is a scope boundary, not a gap in what's built:** both requirements describe behavior *at tool-call time*, which by definition can't be exercised before the Run lane (Agent Config Store → Agent Runtime → Approval Gate) is built. Tracked against those boxes in §4, not against MCP Registry / Connections.

### 2.14 Publish is a separate action on a finished version, not a pause inside the build graph — 2026-09-12
`data-model.html`'s `resume_outbox` exists for a specific shape: the build graph itself pausing at an `await_approval` interrupt, an admin's decision committing to `review_submissions` and enqueuing a resume in the same transaction, and a worker draining the outbox to call `graph.invoke(Command(resume=…))` on that same thread so it can continue to `deploy`.

That shape assumes the graph is still "live" (mid-thread) when the admin decides. In what's actually built, it isn't: by the time an owner asks to publish, `build/graph.ts`'s thread already finished — `resumeAgentBuild` persisted the `agent_versions` row and the graph reached `END` well before publish is ever requested, as its own later, explicit action. There is nothing to resume; publish just reads an already-finished config, scores it, and (if it clears the gate) writes a `review_submissions` row. Admin approval writes `marketplace` and flips `agent_versions.status` directly — no outbox, no worker, no second `graph.invoke()`.

**Why this is a simplification, not a bug:** the outbox pattern buys transactional safety for resuming a *specific in-flight thread* — a real requirement once `generate_config`/`score_agent`/`deploy` are themselves graph nodes gated by the same pause. They aren't (see §7): `generate_config` is inline code in `services/builder.ts`, `score_agent` doesn't exist as a node at all (`services/scoring.ts` is a plain function called from `services/publish.ts`). Given that, `resume_outbox` would be machinery for a pause that doesn't exist yet. Revisit this decision if/when `generate_config`/`score_agent` become real graph nodes and publish needs to resume that specific thread rather than act on its already-persisted output.

**`review_submissions` was also trimmed:** `claimed_by`/`claimed_at`/`decided_by` (data-model.html) assume multiple distinct admins claiming rows from a shared queue — meaningless with one hardcoded owner. Kept `decision_notes`/`decided_at`; dropped the claim/identity columns. Add them back with real auth.

---

## 3. Q&A log

**Q: How does a user enter the token for a registered MCP server (e.g. GitHub)?**
Not at registration — registration is discovery only. A separate **Add a connection** step writes one `connections` row. Two entry points, same row: the Connections screen, or the build-time gate ("connection missing → add token, re-check"). The form fields come from `mcp_servers.auth_spec`.

**Q: Explain "secret travels once over TLS → Vault encrypts → KMS wraps the DEK → only ciphertext + wrapped_dek stored → plaintext wiped".**
Envelope encryption = two locks. See §2.6. To read the token you need the DB row **and** the right to call the KMS; a stolen DB dump is inert.

**Q: Was Vault + KMS in the task description, or did we conclude it?**
The task fixes the outcome only. Vault/KMS/envelope encryption is our design. See §2.6 "task vs. our design".

**Q: What is an RLS policy filter?**
A boolean expression Postgres evaluates per row and silently appends as a `WHERE` to every query. False rows are invisible (not "denied"). No filter for the app to forget. See `data-model.html` §Row-level security.

**Q: Do we need RLS? Shouldn't tenant_id + user_id form it?**
Yes we need DB-level enforcement (check 1 removes the app filter). And yes — the policy keys on `owner_id` **+** `tenant_id`, not tenant alone. See §2.3.

**Q: Which tables have `owner_id`?**
The six in §2.4.

**Q: What is the App Server in the edge layer?**
Plumbing between Auth and Platform Services. See §2.10.

**Q: Should Auth and App Server be related?**
Merged — Auth is nested inside the App Server. See §2.10.

---

## 4. Walkthrough progress — box-by-box review of Platform Services

Going slow, one box at a time.

- [x] **EDGE** — App Server (+ nested Auth). Plumbing only.
- [x] **Platform Services — overview.** Three lanes following the user journey: **Build → Run → Publish**. Nine boxes.
- [x] **Build lane · Box 1 — MCP Registry (service).**
  - Job: turn a server address into trustworthy metadata (tools + sensitivity). Tools are never guessed — asks the server.
  - Register flow: `POST /mcp-servers` → MCP Client does `initialize` + `tools/list` → `classify()` each tool → write `mcp_servers` + `mcp_tools` (both `owner_id`-scoped). `auth_spec` is **not** derived from the server response — real MCP servers don't advertise it — the registrant defines its shape (type + labeled fields) on the Register form itself; see §2.7, §2.13.
  - Does **not** touch credentials — that's Connections / Vault.
  - **Scheduled liveness check** (AnuragBackend `health.ts`) — a periodic job re-pings every registered server and marks it `status = 'ok' | 'dead'` with `last_checked_at`. **Update — 2026-09-12:** a *connected* server is now pinged with its stored credential attached (decrypt → attach → ping → drop, via `getConnectionAuth()`) — fixed a real false-"dead" on the real `github-mcp-server` this way (confirmed: flipped from `dead` to `ok` on the next tick post-fix, `connected` unchanged throughout). Residual gap, unchanged: an *unconnected* server that needs auth just to answer `tools/list` still reads "dead" — nothing to authenticate the ping with yet, correctly so.
  - **Update — 2026-09-12 (second):** that ping's result now also lands on the *connection*, not just the server. A 401/403 with the credential attached means the server is up but the token is bad — `mcp_servers.status` stays `ok`, while `connections.status` flips to `expired`; a successful ping sets `connections.status` back to `active` and always stamps `connections.last_used_at`. The Connections screen (`ConnectionsPage.tsx`) now renders these as a real table (Server / Status / Secret / Added / Last used / Revoke) instead of the old flex-row list — Secret is always the fixed mask `••••••••••••`, never a real value (Rule 3).
  - Neighbours: App Server (in), MCP Client (out to the world), Postgres, later the Build Orchestrator reads these tables.
- [x] **Build lane · Box 2 — Build Orchestrator** (the box with pause markers). Full write-up in `agent-builder-data-flow.html`.
  - LangGraph graph: `parse_intent → search_registry → ⏸present_tools → check_connections → ⏸request_credentials → generate_config → score_agent → deploy → done`.
  - `present_tools` always pauses; `request_credentials` only if a connection is missing.
  - A pause = `interrupt()` → full state to the checkpointer (Postgres) keyed by `thread_id` → `graph_runs` row `status='interrupted'` + `interrupt_kind` + `interrupt_payload` → HTTP returns. Resume loads state, continues from that node. Survives restart (check 5) because state is in Postgres not memory.
  - **`generate_config`** — LLM writes `name`/`description`/`system_prompt` and picks the `graph.type` (`sequential` or `coordinator_specialist`, plus named specialist roles — see §2.11 addendum, §7). **Code** fills `tools[]` (`mcp_server_id`, `tool_name`, `sensitivity`, `require_approval`) and `interrupt_before` — copied from `mcp_tools`, so a model/prompt can't move the gate; for `coordinator_specialist`, code also reassigns any non-read tool to the coordinator regardless of which role picked it, so a specialist can never end up holding the one thing that needs approval. Output = one JSON doc → new `agent_versions` row. Tools referenced by `mcp_server_id` + capability, never a credential → portable to another tenant. Versioned, never mutated in place.
  - **`score_agent`** — pure function over the config (no LLM). Effectiveness/100 (tool coverage, prompt quality, model tier, graph complexity, schedule) + Safety/100 (write gated, destructive gated, no-creds-in-config regex, read-only ratio). Stores `score_breakdown` so every point is traceable. Publish blocked if `effectiveness < 60` OR `safety < 70` — this is how Rule 4 becomes a publish-time check (check 3). Calls the standalone Scoring Engine (Box 3) so it can re-score on edit / re-introspection.
- [x] **Build lane · Box 3 — Scoring Engine.**
  - It's the **library**; `score_agent` is the **call site** (a graph node = glue: get config from state → call `score()` → put result back → SSE event). Not two scorers.
  - Factored out because it has other callers: edit/re-save, re-introspection re-score, agent-page "why this score". One rubric, one place.
  - `score(config) → {effectiveness, safety, breakdown}` — pure: counting list items + a lookup table + one regex. No LLM, no I/O, no writes (the caller persists onto `agent_versions`).
  - Worked example (GitHub→Slack) added to `agent-builder-data-flow.html` §score: effectiveness 55 → blocks publish; drop the gate → safety 35 (check 3).
  - It's an in-process module, **not** a microservice. Threshold gate (`< 60` / `< 70`) lives in the Publish flow (button + server endpoint), not in the Engine.
- [x] **Run lane · Agent Config Store.** `agents` + `agent_versions` tables, written by `services/builder.ts` once the build graph's two pauses clear. See §7 for what's still missing from the full box (`generate_config`'s model-chosen `graph.type`, `score_agent`).
- [x] **Run lane · Agent Runtime.** `run/runtime.ts`: loads a persisted config, gives it real MCP tools via a new `callTool()` (mcpClient.ts), one LangChain `createAgent` ReAct loop per run. Also owns the Connection screen's fetch→use→drop cycle (§2.13) — confirmed live: `getConnectionAuth()` → `attachAuth()` → `callTool()` → drop, per tool call. Degrade-on-revoke (§2.13's other half) still unverified — no test yet of revoking mid-run.
- [x] **Run lane · Approval Gate.** langchain's `humanInTheLoopMiddleware`, `interruptOn` built from `config.interrupt_before` (code-decided at build time, Rule 4 — the Runtime only enforces it). Verified end to end: a gated `send_email` call paused, was approved, then executed for real (and its real failure was reported gracefully, not crashed).
- [x] **Publish lane · Sanitizer.** `services/sanitizer.ts` — strips a config down to `{name, description, model, graphType, capabilities: [{toolName, sensitivity}]}`. No `mcp_server_id`, no `system_prompt`, no owner reference. Verified: a published manifest contains none of those.
- [x] **Publish lane · Admin Review.** `services/review.ts` — `review_submissions` queue, `decide()` approves (→ `marketplace` row, `agent_versions.status='published'`) or sends back to `draft` (`changes_requested`/`rejected`). No real `is_admin` check — one hardcoded owner stands in for both submitter and reviewer, matching the rest of this prototype. Verified both branches live: a real agent blocked by the score gate (55/100 effectiveness), a real one cleared it (69/100) and published, and a rejection correctly reverted `agent_versions.status` to `draft` without touching `marketplace`.
- [x] **Publish lane · Marketplace** (listing only — no browse/filter UI, no Install). `GET /api/marketplace`.
- [ ] Install — **not built.** "Installer supplies own creds, independent copy" needs a second identity to mean anything; there is exactly one hardcoded owner in the whole prototype. Deferred until real auth exists (§7).
- [ ] Right-side: External MCP Servers, Credential Vault, KMS
- [ ] Postgres layer

---

## 5. Open questions

- **Agent config document — remaining gaps** — draft shape landed in §2.11; `coordinator_specialist` sub-agent representation resolved 2026-09-13 (§2.11 addendum). Still open: schedule/trigger fields (cron executor unbuilt), edit semantics.
- **Build graph interrupt points** — how a resumed run reconciles with a registry/connection that changed while paused (e.g. a tool's `sensitivity` shifted).
- **Scoring thresholds** — §2.12 has draft formulas; the 60 / 70 cutoffs need validation against real agents.
- **`agent_versions` vs. `agents.config`** — do we keep a separate versions table, or `config` + `version` on `agents` with history in blob storage? (Our data-model uses `agent_versions`; teammate's spec puts `config` on `agents`.)
- **HITL for the external API** — how a non-interactive caller handles an approval pause (pending state + approve endpoint?).

---

## 6. Schema snapshot (current)

| Table | Isolation key | RLS |
|---|---|---|
| `tenants` | — (root) | — |
| `users` | `tenant_id` | yes |
| `mcp_servers` | `owner_id` + `tenant_id` · unique `(owner_id, address)` · has `auth_spec`, `transport`, `status` + `last_checked_at` (health check, §4) | yes |
| `mcp_tools` | `owner_id` + `tenant_id` (denorm from server) · `sensitivity`, `sensitivity_source`, `annotations` | yes |
| `connections` | `owner_id` + `tenant_id` · unique `(owner_id, server_id)` · `ciphertext`, `wrapped_dek`, `config`, `status` (`active\|expired`, liveness check §4), `last_used_at` (§4) | yes |
| `agents` | `owner_id` + `tenant_id` | yes |
| `agent_versions` | `owner_id` + `tenant_id` (denorm from agent) · `config jsonb`, scores | yes |
| `graph_runs` | `owner_id` + `tenant_id` · `thread_id`, `interrupt_kind` | yes |
| `tool_classification_overrides` | — (platform-level) | — |
| `marketplace` | — · `review_submission_id`, `sanitized_manifest`, scores, `published_at` | **off (exception)** |
| `review_submissions` | — · `graph_run_id`, `sanitized_manifest`, `priority`, `decision_notes` (no `claimed_by`/`decided_by` — one owner stands in for both roles, §2.14) | **off (exception)** |
| `resume_outbox` | **not built** — publish isn't a build-graph pause here, so nothing needs resuming via an outbox (§2.14) | — |
| LangGraph checkpoint tables (`checkpoints`, `_writes`, `_blobs`) | by `thread_id` | (langgraph-managed) |

---

## 7. Implementation status vs. the 8 Rules — 2026-09-12

**Why this section exists, separate from §4:** §4's checkboxes track whether a box's *design* has been walked through and decided — not whether code exists for it. That gap became real: §4 marks Build lane Box 2 and Box 3 `[x]`, but `generate_config` (as an LLM-driven node choosing `graph.type`) and the entire Scoring Engine are **not implemented** — only decided. This section tracks actual running code in `AnuragBackend`/`AnuragFrontend`, so the two questions don't get conflated again.

| Rule | Status | Evidence |
|---|---|---|
| 1 — Config, not code | ✅ Built | `agent_versions.config` jsonb; `run/runtime.ts` interprets any config generically — no per-agent code generated. |
| 2 — Tenant isolation | 🟡 Structural only | Every table carries `owner_id`/`tenant_id` and every query filters on it — but no RLS policy exists (`db.ts`'s own comment says so), and there is exactly one hardcoded owner (`tenancy.ts`'s `DEFAULT_OWNER_ID`). Untestable as multi-user until real auth exists. |
| 3 — Credentials vanish | ✅ Built | Envelope encryption; fetch→use→drop verified live in both `health.ts` (liveness ping) and `run/runtime.ts` (real tool calls); Secret column is always a fixed mask, never a real value. |
| 4 — Risky actions ask first | ✅ Built | `interrupt_before` computed from `mcp_tools.sensitivity` at build time; enforced at run time by `humanInTheLoopMiddleware` — verified end to end (`send_email` paused for approval, resumed, executed). |
| 5 — Publishing strips the company | ✅ Built | `services/sanitizer.ts` — verified a real published manifest carries no `mcp_server_id`, no `system_prompt`, no owner reference. |
| 6 — Scores must mean something | ✅ Built | `services/scoring.ts` implements §2.12's draft formula; `services/publish.ts` enforces the `<60`/`<70` gate — verified live blocking a real 55/100 agent and passing a real 69/100 one. `score_agent` is not a graph node (§2.14) — scoring runs at publish time, not build time. |
| 7 — Every agent gets an endpoint | 🟡 Partial | `POST /api/agents/:versionId/run` exists and works, but there's no Postman export, no distinct external-API framing, and no cross-tenant 404 check (nothing to cross yet — one owner). |
| 8 — One real multi-agent system | ✅ Built | `parse_intent` picks `graph.type` (`sequential`/`coordinator_specialist`) and proposes named specialists; `run/runtime.ts` builds each specialist as its own `createAgent` wrapped as a coordinator tool. Verified end to end 2026-09-13: coordinator delegated to 2 specialists (neither ever paused, both read-only), coordinator's `slack_send_message` correctly hit the approval gate, approve → real tool execution (audit-logged). |

**By lane:**
- **Build** (MCP Registry, Build Orchestrator through `present_tools`/`check_connections`/`request_credentials`): ✅ built and tested. `generate_config`'s model-chosen `graph.type`: ✅ built — `parse_intent` picks `sequential` or `coordinator_specialist` and proposes specialist roles per request; `search_registry` runs per-role tool selection. `score_agent` as a graph node: ❌ not built — scoring lives in the Publish lane instead (§2.14), not the build graph.
- **Run** (Agent Config Store, Agent Runtime, Approval Gate): ✅ all three built and verified end to end this session.
- **Publish** (Sanitizer, Admin Review, Marketplace listing): ✅ all three built and verified end to end — score→gate→sanitize→review→marketplace, both the approve and reject branches. **Install**: ❌ not built — needs a second identity to mean anything (§2.14's sibling gap: there's exactly one hardcoded owner).
- **Frontend**: Registry + Connections pages are fully built UI. **Update — 2026-09-12:** `/build` is now real UI too — a chat flow and a form-mode toggle, both against one shared `useAgentBuilder()` hook, with the Playground (approval-gate UI included) embedded once a build finishes. My Agents and Marketplace are still `ComingSoonPage` — the Publish/Admin Review lane above was built and tested via direct API calls only, with no UI yet.
