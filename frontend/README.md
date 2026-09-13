# AnuragFrontend

Vite + React + TypeScript app for the Agent Builder Platform — the UI half
of Anurag's personal build (pairs with `capstone/backend`). Talks to that
backend over HTTP; it does not call MCP servers directly and does not use
`localStorage` for state — see `capstone/DesignDocs` for the full design.

## Running manually

```bash
cd capstone/frontend
npm install      # only needed once, or after pulling dependency changes
npm run dev
```

`npm run dev` starts the **Vite dev server** — this is the one that actually
serves the app; `npm run build` only compiles a static production bundle to
`dist/` and does *not* start anything (a common mix-up — if you ran `build`
expecting a running app, that's why nothing was listening).

Vite picks the first free port starting at **5173** and prints the real one
to the terminal — don't assume a fixed port. This app also requires
**`capstone/backend` to already be running** (`npm run server:start` there,
or `npm run dev`) — it talks to it over HTTP (`VITE_API_BASE_URL`, default
`http://localhost:8001`) and doesn't work standalone.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server — **this is "start the frontend"** |
| `npm run build` | Typecheck + compile a static production bundle to `dist/` — does not serve anything |
| `npm run preview` | Serve that already-built `dist/` bundle (only useful after `build`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## What's here

- **Header + left sidebar** (`react-router-dom`): MCP Registry, Connections, Build, My Agents, Marketplace.
- **MCP Registry** (`/registry`) — register a server (address, transport, visibility, auth shape), see its discovered tools tagged `read`/`write`/`destructive`, connect a credential, see live health status.
- **Connections** (`/connections`) — every credential on file across servers: status (`active`/`expired`), masked secret, added/last-used timestamps, revoke.
- **Build** (`/build`) — describe an agent in plain English (or use Form mode). Backed by `useAgentBuilder()`, one state machine shared by both a chat UI (`ChatBuildFlow`) and a form UI (`FormBuildFlow`) — neither re-implements the builder, they're two skins over the same hook. Walks through: registry search (an LLM tool-selection sub-agent, not a keyword match) → confirm/prune matched tools → connect any missing credential → a finished agent card (name, description, shape, tools by server, approval summary, trigger classification, score). The paused state persists to `localStorage` so a reload doesn't strand you mid-build — the backend pause itself already survives a restart via its own Postgres checkpointer.
- **Playground** (embedded under a finished Build) — send the agent a message; if it needs to call a tool flagged `require_approval`, it pauses with an approval card (raw args, Approve/Reject) before continuing. Each message starts a fresh run thread — no cross-message memory.
- **My Agents / Marketplace** — still `ComingSoonPage` stubs; the backend for both (Admin Review, Marketplace listing) exists and is tested via direct API calls only.

## Structure

```
src/
  components/   Header/Sidebar/Footer/AppShell (layout), icons.tsx,
                ServerCard/AddServerForm/AuthSpecEditor (Registry),
                AgentPlayground, build/ (ToolPickerWidget, ConnectionsWidget,
                AgentCard, ChatBuildFlow, FormBuildFlow)
  pages/        McpRegistryPage, ConnectionsPage, BuildPage, ComingSoonPage
  hooks/        useAgentBuilder — the one client-side build state machine
  lib/          api.ts (typed fetch client — pure functions, no React),
                format.ts (date/relative-time helpers)
  styles/       global.css — light-theme-only token system
```

## What's deliberately not here yet

- No real auth/tenant — every request is scoped to one hardcoded owner on the backend.
- No My Agents list UI — the Build flow is linear (build → test immediately in the embedded Playground); there's no way yet to come back later and reopen an older agent's Playground from this UI.
- No Marketplace/Admin Review UI — those endpoints exist and work, just untested through a screen.
- No webhook/schedule execution — an agent's `trigger` is classified (`webhook`/`schedule`/`manual`) and shown on its card, but nothing actually invokes it automatically; it only runs when you send it a message in the Playground.
