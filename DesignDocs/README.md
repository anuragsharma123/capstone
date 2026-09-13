# AnuragDocs — Design Pack

Design docs for the Data Sense / Agent Builder capstone. Open the `.html` files in a browser.

**Start with `design-pack.html`** — it's the reading guide: what each doc covers, the order to read them, the key decisions, and what's still open.

| File | What it covers |
|---|---|
| `design-pack.html` | Reading guide / index (read this first) |
| `end-to-end-flow.html` | One start-to-finish flowchart of the whole product |
| `highlevel-architecture.html` | System overview diagram · six-step flow · how each of the 8 rules is satisfied |
| `data-model.html` | Every Postgres table · ER diagram · row-level-security explainer · admin-queue design |
| `connection-data-flow.html` | Registering an MCP server · tool read/write/destructive classification · envelope-encrypting the token |
| `agent-builder-data-flow.html` | The Build Orchestrator graph · the two pauses · `generate_config` · `score_agent` (with worked example) |
| `DESIGN-NOTES.md` | Running decision log — every call with its reasoning, plus box-by-box walkthrough progress |

`system-design.html` at the repo root is an earlier spec by a teammate — needs reconciling with these before submission.
