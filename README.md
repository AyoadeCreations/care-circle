# Care Circle

**Coordinate care responsibilities. Hand off with confidence.**

Care Circle is an MCP-powered assistant that helps family caregivers coordinate who is doing what, when, and for whom — and hands off that information accurately when the next caregiver takes over.

Built for the [Amazon Build, Ship, Shape 2026 Hackathon](https://amazonappdev2026.devpost.com/) — **Alexa+ track**.

> **DEMO DATA NOTICE:** All names, relationships and tasks in this application are entirely fictional. Care Circle is a coordination tool and does not provide medical advice.

---

## What it does

| Capability | Description |
|---|---|
| **Capture update** | Enter a free-text care update. The app extracts proposed tasks for review — nothing is saved until you confirm. |
| **Review & confirm** | Edit task descriptions, dates and assigned people before saving. |
| **Today's plan** | View tasks grouped as overdue, due today, upcoming and unscheduled. |
| **Complete tasks** | Mark tasks done (or reopen them). Every change is recorded in an audit log. |
| **Generate handoff** | One click produces a plain-text handoff summary from live database state — completed, outstanding, upcoming, unassigned. |

---

## Architecture

```
Browser (src/web/)
    │  HTTP requests to /api/*
    ▼
Express Web Server (port 3000)
    │  MCP client (StreamableHTTPClientTransport)
    │  HTTP POST to /mcp
    ▼
MCP Server (same process in unified mode, or port 3001 in dev)
    │  McpServer + StreamableHTTPServerTransport
    │  5 tools: capture, confirm, plan, status, handoff
    ▼
SQLite Database (data/care-circle.db)
```

The web server is a **real MCP client** — it connects to the MCP server using `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`. Every data operation flows through MCP tools; the web server never accesses the database directly for care operations.

**MCP transport:** Streamable HTTP (POST `/mcp`) — satisfies MCP spec ≥ 2025-11-25 as required by the Alexa+ track.

### Directory layout

```
care-circle/
├── src/
│   ├── db/           SQLite schema, seed data, data-access layer
│   ├── mcp/          MCP server + tool implementations
│   ├── server/       Express web server, MCP client, REST routes, unified server
│   ├── types/        Shared TypeScript interfaces
│   ├── utils/        Input validation (Zod), update text parser
│   └── web/          Static HTML/CSS/JS frontend
├── tests/            Vitest automated tests (43 tests)
├── dist/             Compiled JavaScript output (git-ignored)
├── data/             SQLite database file (git-ignored)
├── render.yaml       Render.com deployment configuration
└── ...config files
```

---

## Prerequisites

- **Node.js v18+** (tested on v24.19.0)
- **npm v8+** (tested on v11.17.0)
- No external services, APIs or paid accounts required

---

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/AyoadeCreations/care-circle.git
cd care-circle

# 2. Install dependencies
npm install

# 3. Copy environment file (defaults work for local dev — no edits needed)
cp .env.example .env

# 4. Build TypeScript
npm run build
```

---

## Running locally

### Option A — Unified server (recommended)

Single process, single port. MCP and web UI on port 3000.

```bash
npm run start:unified
# Output: [Care Circle] Unified server running at http://0.0.0.0:3000
# Output: [Care Circle] MCP endpoint: http://0.0.0.0:3000/mcp
```

Set `MCP_URL=http://localhost:3000/mcp` in your `.env` (or it defaults to `http://127.0.0.1:3001/mcp`).

### Option B — Two-process dev mode

**Terminal 1 — MCP server:**
```bash
node dist/mcp/index.js
# Output: [MCP] Care Circle MCP server running at http://127.0.0.1:3001/mcp
```

**Terminal 2 — Web server:**
```bash
node dist/server/index.js
# Output: [Web] Care Circle web app at http://localhost:3000
```

### Single-command dev with file watching

```bash
npm run dev
```

Compiles TypeScript and starts both servers with `--watch` mode.

Then open **http://localhost:3000** in your browser.

The database is created automatically on first start and seeded with fictional demo data (two care recipients, several tasks).

---

## Running tests

```bash
npm test
```

Runs 43 automated tests covering:

1. Proposed update is not treated as confirmed before confirmation
2. Confirmed tasks persist after restarting the server
3. Plan accurately reflects saved tasks and statuses
4. Completing a task updates the database and change history
5. Handoff reflects the real current database state
6. System does not invent a task owner or deadline when one is missing
7. Invalid task IDs and malformed inputs produce safe errors
8. End-to-end vertical slice: capture → confirm → plan → complete → handoff
9. Regression: HTTP status codes — 404 for not-found, 422 for validation only
10. Regression: CSS `[hidden]` attribute must be respected
11. Regression: Duplicate submission prevention in frontend

---

## MCP Tools

All tools are exposed over **Streamable HTTP** at `POST /mcp`.

### `capture_care_update`

Parse a caregiver's natural-language update and return a proposed task list.

**Does NOT save tasks.** Call `confirm_care_update` to save.

| Input | Type | Description |
|---|---|---|
| `recipient_id` | number | ID of the care recipient |
| `caregiver_name` | string | Display name of the submitting caregiver |
| `update_text` | string | Free-form update (max 2000 chars) |

**Returns:** `ProposedUpdate` — includes `update_id`, `proposed_tasks[]` (with confidence level), and `ambiguities[]`.

---

### `confirm_care_update`

Save user-reviewed tasks from a previous `capture_care_update` call.

| Input | Type | Description |
|---|---|---|
| `update_id` | number | ID returned by `capture_care_update` |
| `recipient_id` | number | ID of the care recipient |
| `caregiver_name` | string | Name of the confirming caregiver |
| `confirmed_tasks` | array | Tasks to save (description, due_date, responsible_person) |

**Returns:** `{ saved_tasks: CareTask[], update_id: number }`

---

### `get_today_plan`

Retrieve all open tasks for a recipient, grouped by urgency.

| Input | Type | Description |
|---|---|---|
| `recipient_id` | number | ID of the care recipient |

**Returns:** `TodayPlan` — `overdue`, `due_today`, `upcoming`, `unscheduled` arrays.

---

### `update_task_status`

Mark a task as `completed` or `open`. Writes an audit record.

| Input | Type | Description |
|---|---|---|
| `task_id` | number | ID of the task to update |
| `new_status` | `"open"` \| `"completed"` | New status |
| `changed_by` | string | Name of the person making the change |
| `note` | string (optional) | Note about the change |

**Returns:** `{ task: CareTask, message: string }`

---

### `generate_care_handoff`

Generate a handoff summary from live database state. Saves the handoff to the DB.

| Input | Type | Description |
|---|---|---|
| `recipient_id` | number | ID of the care recipient |
| `generated_by` | string | Name of the person generating the handoff |

**Returns:** `HandoffSummary` — completed, outstanding, upcoming, unassigned arrays, plus `notes` (formatted plain text).

---

## Database schema

| Table | Purpose |
|---|---|
| `care_recipients` | Fictional care recipients |
| `caregivers` | Caregiver display names |
| `care_updates` | Raw update text (stored before confirmation for traceability) |
| `care_tasks` | Confirmed care tasks with status, due date, responsible person |
| `task_history` | Audit log of every status change |
| `handoffs` | Generated handoff summaries |

The database is created and seeded automatically on first start.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `MCP_PORT` | `3001` | MCP server port (two-process mode only) |
| `MCP_URL` | `http://127.0.0.1:3001/mcp` | MCP server endpoint URL |
| `DB_PATH` | `./data/care-circle.db` | Path to SQLite database |
| `NODE_ENV` | `development` | Environment |
| `ALLOWED_ORIGINS` | _(empty)_ | Comma-separated CORS allowed origins |

---

## Deployment

### Render.com (recommended)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render detects `render.yaml` automatically
5. Set environment variables if needed (defaults work for a first deploy)
6. Click Deploy

The `render.yaml` configures:
- Build: `npm install && npm run build`
- Start: `npm run start:unified`
- Persistent disk at `/opt/render/project/data` for the SQLite database
- Health check at `/health`

### Other platforms (Railway, Fly.io)

Any platform that supports:
- Node.js 18+ runtime
- Persistent disk storage (for SQLite)
- Single HTTP port

Use `npm run start:unified` as the start command. Set `MCP_URL` to `http://localhost:$PORT/mcp`.

---

## Demo script

See [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) for the full 3-minute walkthrough.

**Quick summary:**
1. Open the app — select "Margaret Chen"
2. Enter name "Sarah (daughter)" in sidebar
3. Paste: *"Transport for Mum's appointment has changed to Tuesday at 10 AM. We still need to confirm who will pick her up."*
4. Click **Analyse update** — review the proposed tasks
5. Edit the responsible person, click **Confirm and save**
6. See the task appear in today's plan
7. Click the circle to mark a task complete
8. Click **Generate handoff** — copy the summary

---

## Known limitations

- **No LLM integration:** The update parser uses regex/heuristics, not an LLM. Works well for explicit updates but won't catch implied tasks in complex language.
- **Single-user session:** No authentication. In production, user sessions and role-based access would be needed.
- **No real-time sync:** Multiple browser tabs don't auto-refresh. Use the Refresh button.
- **Alexa+ integration:** This is a self-hosted MCP experience with its own web client. The MCP server is wired up correctly to the MCP spec (Streamable HTTP, spec 2025-11-25) but is not directly connected to an Alexa+ agent in this submission.
- **SQLite persistence:** The database file is local to the server. Suitable for demo deployments; production would use an external database.

## Tools and SDKs used

| Tool / SDK | Role |
|---|---|
| `@modelcontextprotocol/sdk` v1.32.1 | MCP server and client implementation |
| `express` | HTTP server for both web UI and MCP endpoint |
| `better-sqlite3` | SQLite database access |
| `zod` | Input validation for all MCP tool inputs |
| `vitest` | Test runner (43 automated tests) |
| `typescript` | Type safety across the full codebase |

---

## License

MIT — see [LICENSE](./LICENSE).
