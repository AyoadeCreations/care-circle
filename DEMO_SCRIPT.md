# Care Circle — Demo Script

**Target: under 3 minutes**

---

## Setup before recording

1. Run `npm run build` in the project directory
2. Open two terminal windows side by side
3. Clear any existing database: delete `data/care-circle.db` if it exists
4. Open http://localhost:3000 in Chrome/Edge (maximised)
5. Open browser DevTools → Network tab so you can show real API calls if asked

---

## Script

### [0:00 – 0:20] Opening — The problem

**Narrate:**
> "Family caregiving is coordinated between multiple people — children, neighbours, spouses — often over text messages that get lost, or handoffs that leave someone without critical information. Care Circle solves this with an AI-powered coordination layer built on the open Model Context Protocol."

Show: The Care Circle homepage, clean and loaded.

---

### [0:20 – 0:45] Start the servers

**Show terminal 1:**
```
node dist/mcp/index.js
```

> "The MCP server starts on port 3001, exposing five tools over Streamable HTTP."

**Show terminal 2:**
```
node dist/server/index.js
```

> "The web server connects to it as a real MCP client — every data operation goes through the protocol."

---

### [0:45 – 1:10] Today's plan

**Actions:**
1. Click **Margaret Chen** in the recipient selector
2. Type "Sarah (daughter)" into the Your Name field

**Narrate:**
> "I select Margaret — a fictional demo recipient — and enter my name as the caregiver. The dashboard loads Margaret's tasks from the MCP server, showing what's due today, what's upcoming, and what's unscheduled."

Show the task groups populating.

---

### [1:10 – 1:45] Capture and confirm an update

**Actions:**
1. Click in the update textarea
2. Type (or paste):
   > *"Transport for Mum's appointment has changed to Tuesday at 10 AM. We still need to confirm who will pick her up."*
3. Click **Analyse update**

**Narrate:**
> "I type a real update — plain language, as a caregiver would actually write it. Care Circle calls the `capture_care_update` MCP tool, which parses it and returns a *proposal* — nothing is saved yet."

Show the confirm panel appearing with proposed tasks.

4. Edit the "responsible person" field — type "James (son-in-law)"
5. Click **Confirm and save**

**Narrate:**
> "I review the proposal, fill in who's responsible, and confirm. The `confirm_care_update` tool saves these as permanent tasks. The plan updates immediately."

Show the new task appearing in the plan.

---

### [1:45 – 2:10] Complete a task

**Actions:**
1. Find the "Pick up blood pressure medication" task
2. Click the circle button on the left

**Narrate:**
> "When Sarah picks up the medication, she marks it done. `update_task_status` is called — the change is persisted and an audit record is written. The task disappears from the active plan."

Show the task being removed from the plan view.

---

### [2:10 – 2:45] Generate handoff

**Actions:**
1. Click **Generate handoff**

**Narrate:**
> "At the end of her shift, Sarah clicks Generate Handoff. The `generate_care_handoff` tool reads live data from the database — completed tasks, what's still outstanding, upcoming appointments, anything unassigned — and formats it into a clear summary."

Show the handoff panel appearing with real data.

2. Click **Copy**

**Narrate:**
> "She copies it and sends it to the next caregiver. No details lost. No invented information."

---

### [2:45 – 3:00] Close

**Narrate:**
> "Care Circle — real MCP tools, real persistent state, real coordination. Built with the official Model Context Protocol SDK over Streamable HTTP. All source code is open and linked in the submission."

Show the project URL / GitHub repo.

---

## Key talking points

- **Real MCP:** Uses `@modelcontextprotocol/sdk` v1.32.1, `StreamableHTTPServerTransport` and `StreamableHTTPClientTransport` — not a simulation.
- **Safety by design:** `capture_care_update` never saves anything; `confirm_care_update` is the explicit save step.
- **No invented data:** Dates and responsible people are only included if explicitly stated in the update.
- **Persistent state:** SQLite database survives server restarts.
- **34 automated tests** cover all 8 required scenarios.
- **Fictional data only:** No real patient information.
