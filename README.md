# ✨ Lucy — Chief of Staff AI

A personal M365 signal dashboard that monitors your email + Teams, surfaces actionable items, and acts like a real Chief of Staff — built on **GitHub Copilot SDK** + **WorkIQ MCP**.

> **Architecture diagram**: 
<img width="1150" height="530" alt="Untitled-2026-04-18-1757" src="https://github.com/user-attachments/assets/34cf927b-7e29-44ef-adca-f539aa0b0abc" />



## What It Does

| Feature | Description |
|---------|-------------|
| **📥 Signal Feed** | Scans email + Teams every 5 min. Prioritizes, deduplicates, shows actionable items with filters |
| **💬 Streaming Chat** | Ask Lucy anything about your M365 data. Real-time SSE streaming with model labels |
| **🔍 Dig Deep** | Click any signal → Lucy finds thread context + drafts a copy-pastable reply |
| **📊 Daily Briefing** | Parallel email + Teams scan → synthesized executive brief |
| **📅 Meeting Prep** | Auto-gathers context for today's meetings from attendee communications |
| **🏛️ Model Council** | Toggle to query multiple LLMs in parallel, pick the best answer |
| **💜 SOUL Personality** | Persistent personality file (`soul/SOUL.md`) injected into every agent |
| **🧠 3-Tier Memory** | Semantic (permanent) · Episodic (7d decay) · Session (1d decay) — Genesis-inspired |
| **💡 Self-Learning** | Tracks dismissal patterns, adapts behavior, "Teach Lucy" input |
| **📈 Analytics** | Time saved, signals processed, priority distribution, top senders |
| **⌨️ Cmd+K + Shortcuts** | Command palette, J/K/D/A/B/S keyboard navigation |
| **🔔 Push Notifications** | Desktop notifications for high-priority signals |
| **🗣️ Voice Output** | Azure Neural TTS (Edge TTS) — Lucy speaks responses with natural voice |
| **🧑 3D Avatar** | TalkingHead avatar with lip-sync, gestures, eye contact, 5 conversation states |
| **🎤 Voice Input** | Push-to-talk microphone (Web Speech API) for two-way conversations |

## Setup — Paste This Into Copilot CLI

Just open Copilot CLI and paste:

```
Clone https://github.com/v-sutharapuh_microsoft/lucy-ghcopilotsdk-chief-of-staff and set it up end-to-end. Check if Node.js 18+ is installed (if not, install it). Check if GitHub CLI is authenticated (if not, run gh auth login). Then run npm install and npm start. Accept any WorkIQ EULA prompts automatically. Open http://localhost:4242 when ready.
```

Or manually:

```bash
git clone https://github.com/v-sutharapuh_microsoft/lucy-ghcopilotsdk-chief-of-staff.git
cd lucy-ghcopilotsdk-chief-of-staff
npm install
npm start
# → Open http://localhost:4242
```

## Prerequisites

- **Node.js 18+** (`winget install OpenJS.NodeJS` or `brew install node`)
- **GitHub Copilot subscription** (active)
- **GitHub CLI** authenticated (`gh auth login`)
- WorkIQ EULA is auto-accepted on first run — no manual steps needed

That's it. Lucy will:
1. Initialize 4 AI agents (Mail, Teams, Scanner, Router)
2. Run EULA preflight on WorkIQ
3. Start Express on port 4242
4. Run first scan after 10 seconds

## Setup for Copilot CLI Agent

If you want to use GitHub Copilot CLI as the coding agent for this project:

```bash
# Navigate to the project
cd lucy-chief-of-staff

# Launch Copilot CLI
copilot

# The CLAUDE.md file in the root tells the agent:
# - Use MS Learn MCP for Azure/M365 docs
# - Use /browse from gstack for web browsing
# - Never use mcp__claude-in-chrome__* tools
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Browser (:4242)                    │
│   Feed | Chat | Brief | Prep | Log | Soul | ⚙  │
│   Cmd+K · Keyboard shortcuts · SSE streaming   │
└──────────────────┬──────────────────────────────┘
                   │ REST + SSE
┌──────────────────▼──────────────────────────────┐
│         Express Server (server.ts)              │
│  14 API endpoints · Intent Router · SSE push    │
└────┬────────┬────────┬────────┬─────────────────┘
     │        │        │        │
 ┌───▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼────┐
 │ Mail │ │Teams │ │Scan │ │Router │
 │Agent │ │Agent │ │ner  │ │       │
 │      │ │      │ │     │ │(no MCP│
 │Opus  │ │Opus  │ │Opus │ │GPT4.1)│
 │4.6-1M│ │4.6-1M│ │4.6  │ │       │
 └──┬───┘ └──┬───┘ └──┬──┘ └───────┘
    │        │        │
    └────────┴────────┘
        WorkIQ MCP
     (@microsoft/workiq)
            │
      Microsoft 365
   (Email · Teams · Calendar)
```

Each agent is its own `CopilotClient` instance — they **never share sessions**.

## File Structure

```
src/
├── types.ts           — All interfaces (Signal, Scan, Contact, etc.)
├── user-context.ts    — User config (name, email, team, projects)
├── agents.ts          — CopilotClient factory, model registry, SOUL injection
├── scanner.ts         — Background M365 scanner with dedup
├── store.ts           — SQLite CRUD (7 tables)
├── orchestrator.ts    — Chat routing, briefing, meeting prep
├── memory.ts          — 3-tier memory with temporal decay
└── server.ts          — Express server, 14 endpoints, startup orchestration
soul/
└── SOUL.md            — Persistent personality (Identity/Voice/Values/Style/Boundaries)
memory/
├── semantic/          — Permanent memories (identity, preferences)
├── episodic/          — Daily logs (7-day decay)
└── session/           — Task checkpoints (1-day decay)
public/
├── index.html         — Dashboard UI (Fluent UI 2 dark theme, ~118KB)
└── architecture.html  — Architecture diagram
```

## Configuration

### Models (configurable per agent in Settings tab)

| Agent | Default Model | Purpose |
|-------|--------------|---------|
| Mail | claude-opus-4.6-1m | Email queries, thread context |
| Teams | claude-opus-4.6-1m | Teams chat/channel queries |
| Scanner | claude-opus-4.6-1m | Background signal extraction |
| Router | gpt-4.1 | Fast intent classification |
| Briefing | claude-opus-4.6-1m | Executive brief synthesis |
| Meeting Prep | claude-opus-4.6-1m | Attendee context assembly |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4242` | Server port |
| `SCAN_INTERVAL` | `300000` | Scan interval in ms (5 min) |
| `LUCY_MODEL` | — | Override default model for all agents |

### Personalizing Lucy

1. Edit `soul/SOUL.md` — change voice, values, boundaries
2. Edit `src/user-context.ts` — update name, email, team, projects
3. Use "Teach Lucy" in the Soul tab — natural language preferences saved to memory
4. Use the Settings tab — pick models per agent

## Key Design Decisions

- **WorkIQ is the ONLY M365 interface** — Agent365 MCP servers require VS Code OAuth passthrough. WorkIQ handles its own auth headlessly.
- **Never share CopilotSessions** — each `sendAndWait` blocks until idle. Sharing = deadlock.
- **Scanner timeout: 180s** — WorkIQ M365 calls take 30-90s. Don't lower this.
- **EULA preflight required** — WorkIQ needs EULA acceptance on first use. Auto-handled.
- **SOUL.md is injected, not a system prompt** — it's loaded as context, allowing the user to edit it without restarting.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `EADDRINUSE: address already in use :::4242` | Kill the existing process: `npx kill-port 4242` or change `PORT` |
| WorkIQ timeout/errors | WorkIQ has intermittent outages. Wait 5 min, try again. Lucy handles it gracefully. |
| `model X unavailable` | Check your Copilot subscription tier. Some models require premium. Change in Settings. |
| Scanner finds nothing | Check your M365 inbox. Scanner looks at last 24h. If inbox is empty, signals will be empty. |
| Agent init failed (non-fatal) | One agent failing doesn't crash the server. Check logs for which agent. |

## Chamber Integration

Lucy's features are also available as extensions for [Chamber](https://github.com/ianphil/chamber) (Electron desktop app):

| PR | Feature | Status |
|----|---------|--------|
| [#100](https://github.com/ianphil/chamber/pull/100) | Scanner Extension (M365 signal monitoring) | Open |
| [#101](https://github.com/ianphil/chamber/pull/101) | Memory Decay (3-tier temporal memory) | Open |
| [#102](https://github.com/ianphil/chamber/pull/102) | Model Council (parallel multi-LLM) | Open |
| [#103](https://github.com/ianphil/chamber/pull/103) | Signal Feed + Dig Deep | Open |
| [#104](https://github.com/ianphil/chamber/pull/104) | Feedback + Analytics | Open |

All PRs are purely additive — zero changes to existing Chamber code. Tested against Chamber's full test suite (580 tests, zero regression).

## License

Internal use only.
