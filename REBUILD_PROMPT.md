# Lucy Chief of Staff -- Rebuild Prompt

## What This Is

Personal M365 signal dashboard built on GitHub Copilot SDK. Monitors email + Teams via WorkIQ, surfaces actionable items in a single pane with priority/context/suggested action.

## Stack

- **Runtime**: Node.js 18+ / TypeScript / tsx runner
- **SDK**: `@github/copilot-sdk` (npm) -- spawns Copilot CLI subprocesses
- **Auth**: GitHub Copilot subscription (logged-in user, default)
- **M365**: WorkIQ MCP (`@microsoft/workiq`) -- stdio, handles own auth
- **DB**: better-sqlite3 (local)
- **UI**: Express + vanilla HTML/JS + SSE streaming
- **Port**: 4242

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                   Browser                    │
│   Tabs: Inbox | Chat | Activity Log         │
│   Scanner bar: phase status + countdown      │
└──────────────────┬──────────────────────────┘
                   │ SSE + REST
┌──────────────────▼──────────────────────────┐
│              Express Server (:4242)          │
│  /ask (chat SSE)  /scanner/*  /api/signals  │
└──────┬───────┬───────┬───────┬──────────────┘
       │       │       │       │
   ┌───▼──┐ ┌─▼──┐ ┌──▼──┐ ┌─▼────┐
   │ Mail │ │Team│ │Scan │ │Router│
   │Agent │ │Agnt│ │ner  │ │/Synth│
   │CLI#1 │ │CLI#│ │CLI#3│ │CLI#4 │
   └──┬───┘ └─┬──┘ └──┬──┘ └──────┘
      │       │       │
      └───────┴───────┘
          WorkIQ MCP
       (@microsoft/workiq)
              │
        Microsoft 365
     (Email, Teams, Calendar)
```

**Key**: Each box is its own `CopilotClient` + `CopilotSession` + CLI subprocess. They do NOT share sessions.

---

## Hard-Won Technical Lessons

### 1. WorkIQ is the ONLY M365 interface

The Agent365 MCP servers (`calendar_tools`, `mail_tools`, `Teams_tools`) use `oauth2_identity_passthrough` which **only works inside VS Code**. Headless Copilot CLI subprocesses cannot authenticate to them. WorkIQ handles its own auth and works headlessly.

### 2. WorkIQ requires EULA acceptance

On startup, send a preflight message to each WorkIQ session:

```typescript
await session.sendAndWait({
  prompt: "Accept the WorkIQ EULA at https://github.com/microsoft/work-iq-mcp then confirm done."
}, 30_000).catch(() => {});
```

Also set `onUserInputRequest` to auto-respond "yes":

```typescript
onUserInputRequest: async () => ({ answer: "yes", wasFreeform: true })
```

### 3. WorkIQ is SLOW

M365 API calls take 30-90 seconds. Set timeouts:
- Scanner: `180_000` (3 min)
- Chat queries: `120_000` (2 min)
- System prompt MUST say: "Tools can take up to 60 seconds -- do NOT retry or say they timed out. Just wait."

### 4. Never share a CopilotSession

Each `sendAndWait` blocks the session until idle. If the scanner and chat share a session, one blocks the other → timeouts. Each agent gets its own `CopilotClient`.

### 5. Use an intent router

Before dispatching, do a fast LLM call to classify which agent to invoke. Simple queries go to one agent only -- saves 60-90s vs fan-out-all.

### 6. SSE flush

Express buffers small writes. Fix:

```typescript
req.socket.setNoDelay(true);
// After every res.write():
if (typeof (res as any).flush === "function") (res as any).flush();
```

### 7. Model selection

Use `gpt-5.4` (or `gpt-4.1` fallback). Check available models:

```typescript
const models = await client.listModels();
```

---

## Agents

### Mail Agent (CopilotClient #1)

```typescript
const mailClient = new CopilotClient();
await mailClient.start();
const mailSession = await mailClient.createSession({
  model: "gpt-5.4",
  streaming: true,
  onPermissionRequest: approveAll,
  onUserInputRequest: async () => ({ answer: "yes", wasFreeform: true }),
  systemMessage: {
    content: "You are the MAIL AGENT. Use WorkIQ to query the user's Outlook email. " +
      "When asked to scan, check for recent emails needing action (decisions, approvals, requests, deadlines). " +
      "Ignore newsletters, automated notifications, FYI-only messages. Return structured JSON. " +
      "Tools can take up to 60 seconds -- do NOT retry or say they timed out."
  },
  mcpServers: {
    workiq: {
      type: "local",
      command: "C:\\Program Files\\nodejs\\npx.cmd",
      args: ["-y", "@microsoft/workiq", "mcp"],
      tools: ["*"],
      timeout: 120000,
    },
  },
});
```

### Teams Agent (CopilotClient #2)

Same as Mail Agent but system prompt says:

```
"You are the TEAMS AGENT. Use WorkIQ to query the user's Teams chats and channels.
When asked to scan, check for recent messages needing action (decisions, follow-ups, approvals).
Return structured JSON."
```

### Scanner (CopilotClient #3)

Dedicated session, runs every 5 minutes:

```
System prompt: "You are a background scanner. Use WorkIQ to check the user's M365 for actionable items.
Output ONLY valid JSON arrays. No markdown, no explanation."
```

### Router / Synth (CopilotClient #4)

No MCP servers. Used for:
1. Intent classification (which agent to invoke)
2. Synthesizing multi-agent responses

---

## Scanner Flow

Every 5 minutes (configurable via `SCAN_INTERVAL` env var):

1. **Scan emails**: Ask WorkIQ for actionable emails from last 30 min
2. **Scan Teams**: Ask WorkIQ for actionable Teams messages from last 30 min
3. **Analyze**: For each item, WorkIQ determines context + priority + suggested action
4. **Dedup**: Match against existing `new` status items only (not `acted` or `dismissed`)
   - Exact: same source + sender + title within 4h window
   - Fuzzy: title word overlap >= 80%
5. **Persist**: Insert new items to SQLite
6. **Emit**: Push SSE events to connected browsers
7. **Log**: Record scan in history

### Scanner Output Schema

```json
[{
  "source": "email",
  "title": "RE: EASA Workshop Timeline",
  "summary": "Meera needs confirmation on March workshop dates by EOD Friday",
  "sender": "Meera",
  "priority": "high",
  "context": "EA Security Accelerate workshop. Meera is blocked on venue booking.",
  "suggestedAction": "Reply confirming March 15-16 or propose alternatives"
}]
```

---

## Data Model (SQLite)

```sql
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- 'email' | 'teams'
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sender TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  priority TEXT NOT NULL,         -- 'high' | 'medium' | 'low'
  context TEXT,
  suggestedAction TEXT,
  references_json TEXT,           -- [{label, url}]
  status TEXT DEFAULT 'new',      -- 'new' | 'reviewed' | 'acted' | 'dismissed'
  extractedAt INTEGER NOT NULL,
  scanId TEXT NOT NULL
);

CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  startedAt INTEGER,
  finishedAt INTEGER,
  emailCount INTEGER,
  teamsCount INTEGER,
  totalExtracted INTEGER,
  totalDeduped INTEGER,
  outcome TEXT                    -- 'success' | 'partial' | 'failed'
);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  type TEXT,
  detail TEXT,
  entityId TEXT,
  timestamp INTEGER
);
```

---

## MCP Server Config

```typescript
// WorkIQ -- the ONLY M365 interface that works headlessly
mcpServers: {
  workiq: {
    type: "local",
    command: "C:\\Program Files\\nodejs\\npx.cmd",
    args: ["-y", "@microsoft/workiq", "mcp"],
    tools: ["*"],
    timeout: 120000,
  },
}

// MS Learn -- for docs/reference (no auth needed)
mcpServers: {
  "ms-learn": {
    type: "http",
    url: "https://learn.microsoft.com/api/mcp",
    tools: ["*"],
  },
}
```

---

## Dashboard UI

Tab-based layout (responsive, works at any width):

| Tab | Content |
|-----|---------|
| **📥 Inbox** | All new signals sorted by priority then recency. Cards: source icon, priority badge, title, summary, sender, time ago, context, suggested action. Buttons: Review / Dismiss |
| **💬 Chat** | Ask Lucy anything, streaming SSE response |
| **📋 Log** | Audit trail of scans, actions, dismissals |

**Top bar**: stats (new count, scans today, last scan time)
**Scanner bar**: live phase status ("Scanning emails..."), countdown to next scan, Scan Now button

---

## User Context

```typescript
const userCtx = {
  displayName: "Hashwanth Sutharapu",
  email: "v-sutharapuh@microsoft.com",
  team: ["Akshat Jain", "Arnav Loonker", "Manasa Jayaprakash", "Rohit Bundele"],
  domain: "GPS Incentives",
  projects: ["IncentraX", "EASA", "AI Pod", "Lucy", "WorkFAST"]
};
```

---

## Startup Sequence

1. Create Mail Agent (CopilotClient #1) → start → createSession with WorkIQ → EULA preflight
2. Create Teams Agent (CopilotClient #2) → start → createSession with WorkIQ → EULA preflight
3. Create Scanner (CopilotClient #3) → start → createSession with WorkIQ → EULA preflight
4. Create Router/Synth (CopilotClient #4) → start → createSession (no MCP)
5. Initialize SQLite DB (auto-migrate tables)
6. Start Express on port 4242
7. Start scanner interval (5 min, first scan after 10s)
8. Log: "Lucy ready. UI → http://localhost:4242"

---

## Agent Harness Principles

When rebuilding this in an agent harness (e.g. a Copilot coding agent, Codex, or similar), follow these principles:

### 1. Build incrementally, verify each layer

Don't build the whole thing in one shot. Go in this order and verify each step compiles + runs before moving on:

1. **Skeleton first**: `package.json` + `tsconfig.json` + empty `server.ts` that starts Express on 4242 and returns health check. Run it.
2. **Single agent**: Create ONE `CopilotClient` + session with WorkIQ. Send a test prompt ("What is 2+2?"). Verify it returns a response. This catches auth/model/SDK issues early.
3. **Scanner standalone**: Build the scanner module. Test it with a manual HTTP call (`POST /scanner/scan`). Verify it calls WorkIQ and returns JSON. Don't wire it to the UI yet.
4. **SQLite**: Add the DB layer. Insert a test signal. Query it back. Verify persistence survives restarts.
5. **UI last**: Build the HTML after all APIs are verified working via curl/Invoke-RestMethod.

### 2. One file per concern

- `types.ts` -- all interfaces/types
- `store.ts` -- all SQLite CRUD
- `scanner.ts` -- scanner logic + its own CopilotClient
- `orchestrator.ts` -- chat agents + intent router + synth
- `server.ts` -- Express routes + SSE endpoints
- `user-context.ts` -- user config
- `public/index.html` -- UI (single file, vanilla JS)

### 3. Test via REST before testing via UI

Every feature should be verifiable via `curl` or `Invoke-RestMethod` before the UI is built. This separates backend bugs from frontend bugs.

```powershell
# Health check
Invoke-RestMethod http://localhost:4242/health

# Manual scan
Invoke-RestMethod -Method POST http://localhost:4242/scanner/scan

# List signals
Invoke-RestMethod http://localhost:4242/api/signals

# Chat
Invoke-WebRequest -Method POST -Uri http://localhost:4242/ask -ContentType "application/json" -Body '{"prompt":"hi"}'
```

### 4. Error boundaries everywhere

- Wrap every `sendAndWait` in try/catch -- WorkIQ WILL timeout sometimes
- Scanner failures should be logged but not crash the server
- Use `process.on("unhandledRejection")` and `process.on("uncaughtException")`
- Each agent init failure should be non-fatal (skip that agent, log warning)

### 5. Log everything to stdout

Every scan start/end, every agent call, every error. Format: `[component] message`. Examples:
```
[scanner] scanning...
[scanner] done: 3 extracted, 1 deduped, 2 new
[scanner] error: Timeout after 180000ms
[mail-agent] tool call: workiq-ask_work_iq
[router] classified as: analyst
```

### 6. Don't over-engineer the UI

Single HTML file. No React, no build step, no npm frontend deps. Vanilla JS + fetch + EventSource for SSE. The UI is a thin display layer over REST APIs. If it breaks, the APIs still work.

### 7. Idempotent restarts

- SQLite DB persists across restarts (don't wipe on startup)
- Scanner picks up where it left off (uses `lastScan` timestamp)
- EULA preflight is safe to re-run (idempotent)
- Port conflicts: check `EADDRINUSE`, kill stale processes, or use a configurable port

---

## What NOT To Do

- **Don't** use Agent365 MCP servers from headless CLI (oauth2_identity_passthrough = VS Code only)
- **Don't** use `az cli` tokens for Graph mail/calendar (first-party app lacks Mail.ReadWrite consent)
- **Don't** share a CopilotSession between scanner and chat
- **Don't** set scanner timeout below 180s
- **Don't** fan out to all agents for simple queries -- use intent router
- **Don't** skip the WorkIQ EULA preflight -- scanner will just return empty results

---

## Reference

- SDK repo: https://github.com/github/copilot-sdk
- SDK Node README: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
- SDK MCP docs: https://github.com/github/copilot-sdk/blob/main/docs/features/mcp.md
- Getting started: https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
- WorkIQ: https://github.com/microsoft/work-iq-mcp
- MS Learn MCP: https://learn.microsoft.com/api/mcp
