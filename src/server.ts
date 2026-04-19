import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { initStore, getSignals, updateSignalStatus, getSignalCount, getScansToday, getLastScan, getScans, getActivity, insertActivity, getModelConfig, setModelConfig, insertFeedback, getDismissalPatterns, getRecentFeedback, markFeedbackApplied, deleteMemory } from "./store.js";
import { initMailAgent, initTeamsAgent, initScanner, initRouter, AVAILABLE_MODELS } from "./agents.js";
import { setScannerAgent, runScan, getScannerStatus } from "./scanner.js";
import { setAgents, getMailAgent, getTeamsAgent, handleChatStreaming, handleStreamInbox, handleMeetingPrep, handleRelationships } from "./orchestrator.js";
import { remember, recall, pruneSessionMemories, loadSoul } from "./memory.js";
import { getMemoriesByTier } from "./store.js";
import { userContext } from "./user-context.js";
import fs from "fs";
import type { AgentInstance } from "./agents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "4242", 10);
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || "300000", 10); // 5 min
let scanIntervalStart = Date.now();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// SSE clients for real-time updates
const sseClients: express.Response[] = [];

function broadcastSSE(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
      if (typeof (client as any).flush === "function") (client as any).flush();
    } catch { /* client disconnected */ }
  }
}

// ─── Health ─────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// ─── SSE endpoint ───────────────────────────────────────────
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  res.write("event: connected\ndata: {}\n\n");
  sseClients.push(res);
  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

// ─── Signals API ────────────────────────────────────────────
app.get("/api/signals", (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = parseInt(req.query.limit as string || "100", 10);
  res.json(getSignals(status, limit));
});

app.patch("/api/signals/:id", (req, res) => {
  const { status } = req.body;
  if (!["new", "reviewed", "acted", "dismissed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const updated = updateSignalStatus(req.params.id, status);
  if (updated) {
    insertActivity({
      id: uuidv4(),
      type: "signal-update",
      detail: `Signal marked as ${status}`,
      entityId: req.params.id,
      timestamp: Date.now(),
    });
    broadcastSSE("signal-update", { id: req.params.id, status });

    // Track dismissals for self-learning feedback
    if (status === "dismissed") {
      const signal = getSignals().find(s => s.id === req.params.id);
      if (signal) {
        insertFeedback(uuidv4(), "dismiss", `Dismissed: ${signal.title} from ${signal.sender}`, signal.sender);
      }
    }

    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "Signal not found" });
  }
});

// ─── Stats ──────────────────────────────────────────────────
app.get("/api/stats", (_req, res) => {
  const lastScan = getLastScan();
  const nextScan = scanIntervalStart + SCAN_INTERVAL;
  res.json({
    newCount: getSignalCount("new"),
    scansToday: getScansToday(),
    lastScanTime: lastScan?.finishedAt || null,
    scanner: {
      ...getScannerStatus(),
      nextScanAt: nextScan,
      scanInterval: SCAN_INTERVAL,
    },
  });
});

// ─── Scans ──────────────────────────────────────────────────
app.get("/api/scans", (req, res) => {
  const limit = parseInt(req.query.limit as string || "20", 10);
  res.json(getScans(limit));
});

// ─── Activity ───────────────────────────────────────────────
app.get("/api/activity", (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  res.json(getActivity(limit));
});

// ─── Scanner ────────────────────────────────────────────────
app.post("/scanner/scan", async (_req, res) => {
  try {
    const scan = await runScan();
    scanIntervalStart = Date.now();
    broadcastSSE("scan-complete", { ...scan, newSignalIds: scan.newSignalIds || [] });
    // Log scan to episodic memory
    if (scan.totalExtracted > 0) {
      try { remember("episodic", `[Scan] ${scan.totalExtracted} new signals found (${scan.emailCount} email, ${scan.teamsCount} Teams). ${scan.totalDeduped} deduped.`, ["scan"]); } catch {}
    }
    res.json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[scanner] manual scan error:", message);
    res.status(500).json({ error: message });
  }
});

app.get("/scanner/status", (_req, res) => {
  const nextScan = scanIntervalStart + SCAN_INTERVAL;
  res.json({
    ...getScannerStatus(),
    nextScanAt: nextScan,
    scanInterval: SCAN_INTERVAL,
  });
});

// ─── Models API ─────────────────────────────────────────────
app.get("/api/models", (_req, res) => {
  res.json({ available: AVAILABLE_MODELS, config: getModelConfig() });
});

app.put("/api/config/models", (req, res) => {
  const { agentRole, modelId } = req.body;
  if (!agentRole || !modelId) {
    return res.status(400).json({ error: "agentRole and modelId required" });
  }
  const valid = AVAILABLE_MODELS.some((m) => m.id === modelId);
  if (!valid) {
    return res.status(400).json({ error: `Invalid modelId. Must be one of: ${AVAILABLE_MODELS.map((m) => m.id).join(", ")}` });
  }
  setModelConfig(agentRole, modelId);
  res.json({ ok: true, agentRole, modelId });
});

// ─── Soul & Memory API ──────────────────────────────────────
const SOUL_PATH = path.join(__dirname, "..", "soul", "SOUL.md");

app.get("/api/soul", (_req, res) => {
  const content = loadSoul();
  const memory = {
    semantic: getMemoriesByTier("semantic").length,
    episodic: getMemoriesByTier("episodic").length,
    session: getMemoriesByTier("session").length,
  };
  res.json({ content, memory });
});

app.put("/api/soul", (req, res) => {
  const { content } = req.body;
  if (typeof content !== "string") return res.status(400).json({ error: "content required" });
  try {
    fs.mkdirSync(path.dirname(SOUL_PATH), { recursive: true });
    fs.writeFileSync(SOUL_PATH, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Memory API ─────────────────────────────────────────────
app.get("/api/memory/:tier", (req, res) => {
  const tier = req.params.tier;
  if (!["semantic", "episodic", "session"].includes(tier)) {
    return res.status(400).json({ error: "Invalid tier" });
  }
  const memories = getMemoriesByTier(tier);
  res.json(memories);
});

app.delete("/api/memory/:id", (req, res) => {
  deleteMemory(req.params.id);
  res.json({ ok: true });
});

// ─── Analytics API ──────────────────────────────────────────
app.get("/api/analytics", (_req, res) => {
  const now = Date.now();
  const dayAgo = now - 86400000;
  const weekAgo = now - 604800000;

  const allSignals = getSignals(undefined, 1000);
  const todaySignals = allSignals.filter(s => s.extractedAt > dayAgo);
  const weekSignals = allSignals.filter(s => s.extractedAt > weekAgo);

  const scansToday = getScansToday();
  const activity = getActivity(100);
  const chatCount = activity.filter(a => a.type === "chat").length;
  const digDeepCount = activity.filter(a => a.type === "dig-deep" || (a.detail && a.detail.includes("Dig Deep"))).length;

  // Top senders
  const senderCounts: Record<string, number> = {};
  weekSignals.forEach(s => { senderCounts[s.sender] = (senderCounts[s.sender] || 0) + 1; });
  const topSenders = Object.entries(senderCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Priority distribution
  const priorityDist: Record<string, number> = { high: 0, medium: 0, low: 0 };
  weekSignals.forEach(s => { if (s.priority in priorityDist) priorityDist[s.priority]++; });

  // Status distribution
  const statusDist: Record<string, number> = { new: 0, reviewed: 0, acted: 0, dismissed: 0 };
  allSignals.forEach(s => { if (s.status in statusDist) statusDist[s.status]++; });

  // Estimate time saved
  const briefCount = activity.filter(a => a.type === "briefing").length;
  const timeSavedMin = (statusDist.reviewed + statusDist.acted + statusDist.dismissed) * 2 + digDeepCount * 5 + briefCount * 3;

  res.json({
    today: { signals: todaySignals.length, scans: scansToday, chats: chatCount },
    week: { signals: weekSignals.length, topSenders, priorityDist },
    totals: { signals: allSignals.length, statusDist, timeSavedMin, digDeeps: digDeepCount, briefs: briefCount },
  });
});

// ─── Feedback (self-learning) ────────────────────────────
app.get("/api/feedback/check", (_req, res) => {
  const patterns = getDismissalPatterns();
  const suggestions = patterns.filter(p => p.count >= 3);
  res.json({ suggestions });
});

app.post("/api/feedback", (req, res) => {
  const { type, detail, action } = req.body;
  if (!type || !detail) {
    return res.status(400).json({ error: "type and detail required" });
  }

  insertFeedback(uuidv4(), type, detail, null);

  // Save user preference to semantic memory
  if (action) {
    remember("semantic", `[User Preference] ${action}`, ["preference", type]);
  }

  // Mark related dismissal patterns as applied
  if (type === "ignore-sender" || type === "ignore-keyword") {
    const recent = getRecentFeedback(200);
    const toMark = recent
      .filter(f => f.type === "dismiss" && f.applied === 0 && f.detail.includes(detail))
      .map(f => f.id);
    if (toMark.length > 0) markFeedbackApplied(toMark);
  }

  res.json({ ok: true });
});

// ─── Briefing API ───────────────────────────────────────────
app.get("/api/brief", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);

  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };

  try {
    await handleChatStreaming(
      "Give me my daily briefing — what needs my attention today?",
      (agent, intent) => {
        res.write(`event: meta\ndata: ${JSON.stringify({ agent, intent })}\n\n`);
        flush();
      },
      (chunk) => {
        res.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        flush();
      },
      () => {
        res.write("event: done\ndata: {}\n\n");
        flush();
        res.end();
      },
      (phase) => {
        res.write(`event: phase\ndata: ${JSON.stringify({ phase })}\n\n`);
        flush();
      }
    );
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});

// ─── Stream (full inbox) API ────────────────────────────────
app.get("/api/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };

  try {
    await handleStreamInbox(
      (text) => {
        res.write(`event: phase\ndata: ${JSON.stringify({ text })}\n\n`);
        flush();
      },
      (source, items) => {
        res.write(`event: items\ndata: ${JSON.stringify({ source, items })}\n\n`);
        flush();
      },
      (msg) => {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        flush();
      },
      () => {
        res.write("event: done\ndata: {}\n\n");
        flush();
        res.end();
      }
    );
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});

// ─── Meeting Prep API ───────────────────────────────────────
app.get("/api/meetings", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };

  try {
    await handleMeetingPrep(
      (text) => {
        res.write(`event: phase\ndata: ${JSON.stringify({ text })}\n\n`);
        flush();
      },
      (meetings) => {
        res.write(`event: meetings\ndata: ${JSON.stringify({ meetings })}\n\n`);
        flush();
      },
      (msg) => {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        flush();
      },
      () => {
        res.write("event: done\ndata: {}\n\n");
        flush();
        res.end();
      }
    );
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});

// ─── Relationships API ──────────────────────────────────────
app.get("/api/relationships", async (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  _req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };

  try {
    await handleRelationships(
      (text) => {
        res.write(`event: phase\ndata: ${JSON.stringify({ text })}\n\n`);
        flush();
      },
      (data) => {
        res.write(`event: result\ndata: ${JSON.stringify(data)}\n\n`);
        flush();
      },
      (msg) => {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        flush();
      },
      () => {
        res.write("event: done\ndata: {}\n\n");
        flush();
        res.end();
      }
    );
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});

// ─── Dig Deep ───────────────────────────────────────────────
app.post("/api/signals/:id/dig-deep", async (req, res) => {
  const signal = getSignals().find(s => s.id === req.params.id);
  if (!signal) return res.status(404).json({ error: "Signal not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
  const writeSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flush();
  };

  // Helper: stream an agent call with live reasoning deltas
  function streamAgentCall(
    agent: AgentInstance,
    agentName: string,
    prompt: string,
    phaseLabel: string,
    timeout = 120_000
  ): Promise<string> {
    return new Promise((resolve) => {
      let content = "";
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(content);
      };

      const handler = (event: any) => {
        if (resolved) return;
        if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
          content += event.data.deltaContent;
          // Stream each chunk to the client as live reasoning
          writeSSE("reasoning", { phase: phaseLabel, text: event.data.deltaContent });
        } else if (event.type === "tool.execution_start" && event.data?.toolName) {
          writeSSE("tool", { phase: phaseLabel, tool: event.data.toolName });
        } else if (event.type === "session.idle") {
          finish();
        }
      };

      agent.session.on(handler);

      const timer = setTimeout(() => {
        console.error(`[dig-deep] ${agentName} timeout after ${timeout}ms`);
        if (!content) content = "(timed out waiting for response)";
        finish();
      }, timeout);

      agent.session.send({ prompt }).catch((err: Error) => {
        console.error(`[dig-deep] ${agentName} error:`, err);
        content = `Error: ${err.message}`;
        finish();
      });
    });
  }

  // Phase 1: Search memory
  writeSSE("phase", { text: "🧠 Searching memory for related context..." });
  const memories = recall(signal.title + " " + signal.sender);
  writeSSE("memory", {
    memories: memories.slice(0, 5).map(m => ({ content: m.content, tier: m.tier, score: m.score }))
  });

  const agent = signal.source === "email" ? getMailAgent() : getTeamsAgent();
  const agentName = signal.source === "email" ? "mail-agent" : "teams-agent";

  if (!agent) {
    writeSSE("context", { context: "Agent not available." });
    writeSSE("draft", { draft: "Cannot generate draft — agent not available." });
    writeSSE("done", {});
    res.end();
    return;
  }

  // Phase 2: Get thread context — STREAMED with live reasoning
  writeSSE("phase", { text: `📨 Finding thread context via ${agentName}...` });

  const threadContext = await streamAgentCall(
    agent, agentName,
    `Find the full conversation thread context for this ${signal.source} from ${signal.sender} about "${signal.title}". 
Summary: ${signal.summary}
${signal.context ? `Context: ${signal.context}` : ""}

Include:
1. The full conversation thread (all replies and who said what)
2. Who else is involved in this thread
3. What specific decision or action is needed from me
4. Any deadlines or time pressure mentioned
5. Any related prior discussions

Respond in clear bullet points. Be thorough.`,
    "context", 120_000
  );

  writeSSE("context", { context: threadContext || "No additional context found." });

  // Phase 3: Draft reply — STREAMED with live reasoning
  writeSSE("phase", { text: "✏️ Drafting suggested reply..." });

  const draftReply = await streamAgentCall(
    agent, agentName,
    `Based on this context, draft a professional reply to ${signal.sender} about "${signal.title}".

Signal: ${signal.summary}
${signal.context ? `Background: ${signal.context}` : ""}
Thread context: ${threadContext.slice(0, 1500)}
${signal.suggestedAction ? `Suggested action: ${signal.suggestedAction}` : ""}

Write a concise, professional reply that Hashwanth Sutharapu can copy-paste directly into ${signal.source === "email" ? "Outlook" : "Teams"}. 
- Keep it under 150 words
- Warm but direct tone
- Start with the reply directly (no "Subject:" or "Dear")
- Include specific action items or next steps
- Reference relevant details from the thread`,
    "draft", 90_000
  );

  writeSSE("draft", { draft: draftReply || "Could not generate draft." });
  writeSSE("done", {});
  res.end();

  // Log to episodic memory
  try {
    remember("episodic", `[Dig Deep] Signal: "${signal.title}" from ${signal.sender}.\nContext: ${threadContext.slice(0, 300)}\nDraft: ${draftReply.slice(0, 200)}`, ["dig-deep", signal.source]);
  } catch {}
});

// ─── Draft Reply ────────────────────────────────────────────
app.post("/api/signals/:id/draft-reply", async (req, res) => {
  const signal = getSignals().find(s => s.id === req.params.id);
  if (!signal) return res.status(404).json({ error: "Signal not found" });

  // SSE streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
  const writeSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flush();
  };

  const agent = signal.source === "email" ? getMailAgent() : getTeamsAgent();
  if (!agent) {
    writeSSE("error", { error: "Agent not available" });
    res.end();
    return;
  }

  writeSSE("phase", { text: "Drafting reply..." });

  try {
    const result = await agent.session.sendAndWait({
      prompt: `Draft a professional reply to ${signal.sender} about "${signal.title}".
Context: ${signal.summary}
${signal.context ? `Background: ${signal.context}` : ""}
${signal.suggestedAction ? `Suggested action: ${signal.suggestedAction}` : ""}

Write a concise reply (under 100 words) that Hashwanth can copy-paste into ${signal.source === "email" ? "Outlook" : "Teams"}. Be direct, warm, action-oriented. Start with the reply text directly.`
    }, 90_000);

    const draft = result?.data?.content || "Could not generate draft.";
    writeSSE("draft", { draft, signal: { title: signal.title, sender: signal.sender, source: signal.source } });
  } catch (err) {
    writeSSE("error", { error: err instanceof Error ? err.message : "Unknown error" });
  }

  writeSSE("done", {});
  res.end();

  // Log to memory
  try {
    remember("episodic", `[Draft Reply] Drafted reply to ${signal.sender} about "${signal.title}"`, ["draft", signal.source]);
  } catch {}
});

// ─── Model Council ──────────────────────────────────────────
app.post("/api/council", async (req, res) => {
  const { prompt, models } = req.body;

  if (!prompt || !models || models.length < 2) {
    return res.status(400).json({ error: "prompt and at least 2 models required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
  const writeSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flush();
  };

  const { CopilotClient, approveAll } = await import("@github/copilot-sdk");
  const { buildMemoryContext } = await import("./memory.js");

  const systemPrompt = buildMemoryContext() +
    "You are Lucy, a Chief of Staff AI. Respond in clear, readable prose. Never output raw JSON. Tools can take up to 60 seconds — do NOT retry or say they timed out.";

  writeSSE("council-start", { models, prompt });

  const promises = models.map(async (modelId: string) => {
    try {
      const client = new CopilotClient({
        cliArgs: ["--allow-all-tools", "--allow-all-paths"],
      });
      await client.start();

      const session = await client.createSession({
        model: modelId,
        streaming: true,
        onPermissionRequest: approveAll,
        onUserInputRequest: async () => ({ answer: "yes", wasFreeform: true }),
        systemMessage: { content: systemPrompt },
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

      let content = "";
      let resolved = false;

      return new Promise<string>((resolve) => {
        const handler = (event: any) => {
          if (resolved) return;
          if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
            content += event.data.deltaContent;
            writeSSE("council-delta", { model: modelId, text: event.data.deltaContent });
          } else if (event.type === "session.idle") {
            resolved = true;
            writeSSE("council-complete", { model: modelId, content });
            client.stop().catch(() => {});
            resolve(content);
          }
        };

        session.on(handler);

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            writeSSE("council-complete", { model: modelId, content: content || "(timed out)" });
            client.stop().catch(() => {});
            resolve(content || "(timed out)");
          }
        }, 180_000);

        session.send({ prompt }).catch((err: Error) => {
          if (!resolved) {
            resolved = true;
            writeSSE("council-complete", { model: modelId, content: `Error: ${err.message}` });
            client.stop().catch(() => {});
            resolve(`Error: ${err.message}`);
          }
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeSSE("council-complete", { model: modelId, content: `Failed to start: ${msg}` });
      return `Failed: ${msg}`;
    }
  });

  await Promise.all(promises);
  writeSSE("council-done", {});
  res.end();
});

app.post("/api/council/vote", (req, res) => {
  const { model, prompt } = req.body;
  remember("episodic", `[Council Vote] User preferred ${model} for query: "${prompt?.slice(0, 100)}"`, ["council", "preference"]);
  res.json({ ok: true });
});

// ─── Chat (real SSE streaming) ──────────────────────────────
app.post("/ask", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);

  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
  let chatAgent = "";
  let chatContent = "";

  try {
    await handleChatStreaming(
      prompt,
      // onMeta — send agent info immediately
      (agent, intent) => {
        chatAgent = agent;
        res.write(`event: meta\ndata: ${JSON.stringify({ agent, intent })}\n\n`);
        flush();
      },
      // onDelta — stream each chunk as it arrives
      (chunk) => {
        chatContent += chunk;
        res.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        flush();
      },
      // onDone — log to episodic memory
      () => {
        res.write("event: done\ndata: {}\n\n");
        flush();
        res.end();
        // Log chat to episodic memory (async, non-blocking)
        if (chatContent.length > 10) {
          try {
            remember("episodic", `[Chat] Q: ${prompt.slice(0, 200)}\nA (${chatAgent}): ${chatContent.slice(0, 500)}`, ["chat", chatAgent]);
          } catch {}
        }
      },
      // onPhase — progress updates for multi-step flows
      (phase) => {
        res.write(`event: phase\ndata: ${JSON.stringify({ phase })}\n\n`);
        flush();
      }
    );
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});

// ─── Startup ────────────────────────────────────────────────
async function startup(): Promise<void> {
  console.log("[startup] initializing Lucy...");

  // 1. Init SQLite
  initStore();

  // 1b. Seed semantic memory (idempotent — only adds if empty)
  const semanticCount = getMemoriesByTier("semantic").length;
  if (semanticCount === 0) {
    remember("semantic", `User: ${userContext.displayName} (${userContext.email})\nDomain: ${userContext.domain}\nTeam: ${userContext.team.join(", ")}\nProjects: ${userContext.projects.join(", ")}`, ["identity", "user"]);
    remember("semantic", `Lucy is a Chief of Staff AI. She is decisive, context-aware, and protective of the user's time. She prioritizes action items and relationship tracking.`, ["identity", "lucy"]);
    console.log("[memory] seeded semantic memory with user identity");
  }

  // 2. Init agents with model config from SQLite
  console.log("[startup] initializing agents (this may take a moment)...");

  const modelConfigs = getModelConfig();
  const modelFor = (role: string) => modelConfigs.find((c) => c.agentRole === role)?.modelId;

  let mail: AgentInstance | null = null;
  let teams: AgentInstance | null = null;
  let scanner: AgentInstance | null = null;
  let router: AgentInstance | null = null;

  try { mail = await initMailAgent(modelFor("mail")); } catch (e) { console.error("[startup] mail agent failed:", e); }
  try { teams = await initTeamsAgent(modelFor("teams")); } catch (e) { console.error("[startup] teams agent failed:", e); }
  try { scanner = await initScanner(modelFor("scanner")); } catch (e) { console.error("[startup] scanner failed:", e); }
  try { router = await initRouter(modelFor("router")); } catch (e) { console.error("[startup] router failed:", e); }

  setAgents(mail, teams, router);
  setScannerAgent(scanner);

  // 3. Start Express
  const server = app.listen(PORT, () => {
    console.log(`[server] Lucy ready. UI → http://localhost:${PORT}`);
  });

  // 4. Start scanner interval
  if (scanner) {
    setTimeout(async () => {
      try {
        console.log("[scanner] running initial scan...");
        const scan = await runScan();
        scanIntervalStart = Date.now();
        broadcastSSE("scan-complete", { ...scan, newSignalIds: scan.newSignalIds || [] });
      } catch (err) {
        console.error("[scanner] initial scan failed:", err);
      }
    }, 10_000);

    setInterval(async () => {
      try {
        const status = getScannerStatus();
        if (status.scanning) {
          console.log("[scanner] skipping scheduled scan — previous scan still running");
          return;
        }
        const scan = await runScan();
        scanIntervalStart = Date.now();
        broadcastSSE("scan-complete", { ...scan, newSignalIds: scan.newSignalIds || [] });
      } catch (err) {
        console.error("[scanner] scheduled scan failed:", err);
      }
    }, SCAN_INTERVAL);
  } else {
    console.warn("[startup] scanner not available — background scans disabled");
  }

  // 5. Graceful shutdown
  process.on("SIGINT", () => {
    console.log("[server] shutting down...");
    server.close(() => process.exit(0));
  });
}

// Error handlers
process.on("unhandledRejection", (err) => {
  console.error("[server] unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
});

startup().catch((err) => {
  console.error("[startup] fatal error:", err);
  process.exit(1);
});

