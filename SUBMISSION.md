# Care Circle — Hackathon Submission Materials

## Project description

Care Circle solves a real, underserved problem: the information gap between caregivers.

When families care for an elderly or unwell relative, multiple people take turns — a daughter handles mornings, a son handles evenings, a neighbour covers weekends. Each handoff is a moment where things fall through the cracks: medication not collected, appointments missed, tasks nobody knew about.

Care Circle gives caregivers a shared, reliable record of what has changed, what is confirmed, and what needs to happen next — then produces an accurate handoff summary when the next person takes over.

**The differentiator is care state, not communication.** Other tools are messaging apps. Care Circle is a coordination record: proposed changes must be explicitly confirmed before they are saved, and the handoff is generated from live database state, not from memory or conversation history.

---

## Real user problem

A family caregiver typically:
- Learns about a change (transport moved, appointment rescheduled) and needs to act on it
- Doesn't always know what the previous caregiver already handled
- Passes information verbally or via text messages — easily lost or misremembered
- Needs a quick, accurate summary for the next person taking over

Care Circle captures this workflow as structured operations backed by an MCP server, with a web interface that makes the proposal-then-confirm pattern explicit.

---

## MCP architecture

```
Browser
  └─ HTTP /api/*
      └─ Express Web Server (REST API layer)
          └─ @modelcontextprotocol/sdk StreamableHTTPClientTransport
              └─ POST /mcp
                  └─ McpServer (StreamableHTTPServerTransport)
                      └─ 5 MCP tools
                          └─ SQLite database
```

### Why MCP matters here

The MCP layer isn't cosmetic. The web server never queries the database directly for care operations — all data flows through typed MCP tool calls. This means:

1. The same tools can be called by any MCP-compatible client (Alexa+, other agents, Claude Desktop)
2. Tool inputs are validated by Zod schemas on the MCP server, not just the HTTP layer
3. Every tool has a clear, documented contract — inputs, outputs, side effects
4. The `capture_care_update` tool is intentionally non-destructive: it returns a proposal, never saves

### Compliance

- Transport: **Streamable HTTP** (POST `/mcp`) — MCP spec 2025-11-25
- SDK: `@modelcontextprotocol/sdk` v1.32.1
- The MCP server is called at runtime for every data operation, not just referenced in documentation

---

## Developer tools, SDKs and APIs used

| Tool | Version | Role |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.1 | MCP server + client. Used `McpServer`, `StreamableHTTPServerTransport`, `StreamableHTTPClientTransport`, `Client`. |
| `express` | 4.21.2 | HTTP server for web UI, REST API, and MCP endpoint |
| `better-sqlite3` | 13.0.3 | Synchronous SQLite driver. WAL mode for better concurrency. |
| `zod` | 3.25.76 | Schema validation for all MCP tool inputs. Type-safe at the boundary. |
| `vitest` | 3.2.4 | Test runner — 43 automated tests |
| `typescript` | 5.8.3 | Full type safety across server, MCP tools, and shared types |
| `concurrently` | 9.1.2 | Run MCP and web servers in parallel during development |

---

## Honest feedback on tools used

### MCP SDK (`@modelcontextprotocol/sdk` v1.32.1)

**What worked well:**
- The `McpServer` API is clean. Registering tools with Zod schemas inline is ergonomic and the type inference works.
- `StreamableHTTPServerTransport` in stateless mode is simple to wire up with Express.
- The client (`StreamableHTTPClientTransport`) works reliably for per-request connections.

**Friction encountered:**
- The stateless transport model requires creating a new `Client` and `Transport` instance per MCP call. This adds latency and is not immediately obvious from the docs.
- Error handling across the transport boundary is opaque — `isError: true` with a text content block requires the caller to parse error messages themselves. There is no structured error code field in `CallToolResult`.
- The `StreamableHTTPClientTransport` throws connection errors as generic `Error` objects with no consistent code, making it hard to distinguish "server is down" from "request failed".
- Documentation on `sessionIdGenerator: undefined` for stateless mode was not prominently documented — discovered through trial and error.

**Workaround built:** Created `McpToolError` and `McpConnectionError` typed error classes. Embedded structured error codes (`[NOT_FOUND]`, `[INVALID_INPUT]`) in the tool's text response so the client can extract and map them to HTTP status codes.

---

## Friction log

| # | Task | Steps taken | Expected | Actual | Severity | Workaround |
|---|---|---|---|---|---|---|
| 1 | All MCP errors returned 422 | Used `callMcpTool`, caught `Error` in route | Different status per error type | All caught errors returned 422 | Medium | Added typed error classes; parse error code from text |
| 2 | MCP server starts on import | Imported `mcp/index.ts` from unified server | No auto-start on import | `startMcpServer()` ran at module level, causing EADDRINUSE | Low | Added `process.argv[1]` guard to prevent auto-start on import |
| 3 | Duplicate form submissions | User clicks Analyse twice quickly | Second click blocked | Second click sent duplicate API request | Low | Added `isSubmitting` state flag; disabled button during request |
| 4 | `[hidden]` CSS override | Set `display:flex` on loading overlay | Overlay hides correctly | `display:flex` overrode UA `display:none` for `[hidden]` | Medium | Added `[hidden] { display: none !important }` rule |
| 5 | Double "Error:" prefix | MCP tool returns `"Error: message"`, route re-wraps | Clean error message to browser | Browser saw `"Error: Error: message"` | Low | Strip `"Error: "` prefix in `McpToolError` constructor |

---

## Known limitations

1. **No LLM:** The update parser uses regex heuristics. Works for explicit updates but not implied tasks.
2. **No authentication:** Single-user, no sessions. Not suitable for production without auth.
3. **SQLite persistence:** Local file. Demo deployments on Render have a persistent disk; not suitable for multi-instance production.
4. **Alexa+ not directly integrated:** The MCP server conforms to Streamable HTTP spec and could be connected to an Alexa+ agent, but this submission uses a custom web client. The actual Alexa+ connection is a next step.
5. **No real-time sync:** Multiple browser tabs don't update automatically.

---

## Demo walkthrough (under 3 minutes)

**Setup:** App is running at [your deployed URL]. Navigate there in a fresh browser session.

**Step 1 — Select a care recipient (0:00–0:15)**
- The sidebar shows two fictional recipients: Margaret Chen and Arthur Okafor
- Click **Margaret Chen** — the dashboard loads her open tasks

**Step 2 — Enter your name (0:15–0:25)**
- Type "Sarah (daughter)" in the "Your name" field

**Step 3 — Submit an update (0:25–0:55)**
- In the "Add an update" box, type:
  *"Transport for Mum's appointment has changed to Tuesday at 10 AM. We still need to confirm who will pick her up."*
- Click **Analyse update →**
- Two proposed tasks appear with confidence badges
- Note: nothing is saved yet — the panel says "Nothing is saved until you click Confirm"

**Step 4 — Review and confirm (0:55–1:20)**
- Edit the responsible person on the second task: type "James (son-in-law)"
- Click **✔ Confirm and save**
- The dashboard refreshes — both new tasks appear in the plan

**Step 5 — Complete a task (1:20–1:35)**
- Click the circle next to one of the existing tasks
- It moves out of the plan (completed tasks are hidden)

**Step 6 — Generate handoff (1:35–2:05)**
- Click **📋 Generate handoff**
- A plain-text summary appears showing: completed tasks, outstanding tasks, upcoming appointments
- Click **Copy** — the text is in your clipboard

**Step 7 — Switch recipient (2:05–2:20)**
- Click **Arthur Okafor** in the sidebar
- His tasks load — completely separate from Margaret's

**Step 8 — Error states (2:20–2:40)**
- Click **Generate handoff** without entering your name → toast error
- Click **Analyse update** without entering text → inline error
- Both errors are clear, no broken UI

---

## Remaining next steps (if more time)

1. Connect the MCP server directly to an Alexa+ agent skill
2. Add Amazon Bedrock LLM call in `parseUpdateText` for better task extraction
3. Add authentication (Amazon Cognito)
4. Export handoff as PDF or share via email
5. Push notifications for overdue tasks
