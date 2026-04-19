import { v4 as uuidv4 } from "uuid";
import type { AgentInstance } from "./agents.js";
import type { Signal, ScanResult, Scan } from "./types.js";
import {
  insertSignal,
  insertScan,
  insertActivity,
  getRecentSignals,
} from "./store.js";
import { userContext } from "./user-context.js";

const SCAN_TIMEOUT = 180_000; // 3 minutes
const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — check against a full week of signals

let scannerAgent: AgentInstance | null = null;
let scanning = false;
let currentPhase = "idle";
let lastScanTime: number | null = null;

export function setScannerAgent(agent: AgentInstance | null): void {
  scannerAgent = agent;
}

export function getScannerStatus() {
  return {
    scanning,
    currentPhase,
    lastScanTime,
  };
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

function isDuplicate(result: ScanResult, existing: Signal[]): boolean {
  const resultTitle = (result.title || "").toLowerCase().trim();
  const resultSender = (result.sender || "").toLowerCase().trim();
  
  for (const signal of existing) {
    const sigTitle = signal.title.toLowerCase().trim();
    const sigSender = signal.sender.toLowerCase().trim();
    
    // Exact match: same title (any source/sender)
    if (resultTitle === sigTitle) {
      return true;
    }
    // Same source + sender + similar title
    if (
      signal.source === result.source &&
      sigSender === resultSender &&
      wordOverlap(signal.title, result.title) >= 0.6
    ) {
      return true;
    }
    // Cross-source: 70% word overlap in title (same message in email + Teams)
    if (wordOverlap(signal.title, result.title) >= 0.7) {
      return true;
    }
  }
  return false;
}

function parseJsonResponse(text: string): ScanResult[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Try to find JSON array in the text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}

export async function runScan(): Promise<Scan> {
  if (!scannerAgent) {
    throw new Error("Scanner agent not initialized");
  }
  if (scanning) {
    throw new Error("Scan already in progress");
  }

  scanning = true;
  const scanId = uuidv4();
  const scan: Scan = {
    id: scanId,
    startedAt: Date.now(),
    finishedAt: null,
    emailCount: 0,
    teamsCount: 0,
    totalExtracted: 0,
    totalDeduped: 0,
    outcome: "failed",
  };

  try {
    const existingSignals = getRecentSignals(DEDUP_WINDOW_MS);
    const newSignals: Signal[] = [];

    // Scan emails
    currentPhase = "Scanning emails...";
    console.log("[scanner] scanning emails...");
    try {
      const emailTimeWindow = lastScanTime
        ? `since ${new Date(lastScanTime).toISOString()}`
        : "from the last 24 hours";
      const emailResponse = await scannerAgent.session.sendAndWait(
        {
          prompt: `Check ${userContext.displayName}'s (${userContext.email}) Outlook inbox for ALL actionable emails ${emailTimeWindow}. Include:
- Emails requiring a decision or approval
- Direct requests or asks from anyone
- Meeting-related action items or follow-ups
- Deadlines or time-sensitive items
- Emails from these teammates: ${userContext.team.join(", ")}
- Anything related to projects: ${userContext.projects.join(", ")}

IMPORTANT: For each email, CHECK THE THREAD/CONVERSATION CONTEXT. If it is a reply (RE:) or forward (FW:), read the full thread to understand what is being discussed before assigning priority.

Exclude only: newsletters, automated build notifications, marketing emails, system-generated alerts with no action needed.

Return a JSON array where each item has these exact fields:
{"source":"email","title":"<subject>","summary":"<1-2 sentence summary>","sender":"<name>","priority":"high|medium|low","context":"<why this matters>","suggestedAction":"<what to do>","sourceUrl":"https://outlook.office365.com/mail/search?query=<url-encoded subject>","receivedAt":"<ISO 8601 timestamp of when it was sent>"}
IMPORTANT: For sourceUrl, ALWAYS construct an Outlook search link using the email subject. Format: https://outlook.office365.com/mail/search?query=<url-encoded subject>`,
        },
        SCAN_TIMEOUT
      );
      const emailResults = parseJsonResponse(
        emailResponse?.data?.content || "[]"
      );
      console.log(`[scanner] email raw response (${(emailResponse?.data?.content || "").length} chars), parsed ${emailResults.length} items`);
      if (emailResults.length === 0 && emailResponse?.data?.content) {
        console.log("[scanner] email raw preview:", emailResponse.data.content.slice(0, 500));
      }      scan.emailCount = emailResults.length;
      for (const r of emailResults) {
        r.source = "email";
        if (!isDuplicate(r, existingSignals)) {
          const receivedMs = r.receivedAt ? new Date(r.receivedAt).getTime() : Date.now();
          const signal: Signal = {
            id: uuidv4(),
            source: "email",
            title: r.title || "Untitled",
            summary: r.summary || "",
            sender: r.sender || "Unknown",
            timestamp: receivedMs,
            priority: r.priority || "medium",
            context: r.context || null,
            suggestedAction: r.suggestedAction || null,
            references_json: r.references
              ? JSON.stringify(r.references)
              : null,
            status: "new",
            extractedAt: Date.now(),
            scanId,
            sourceUrl: r.sourceUrl || `https://outlook.office365.com/mail/search?query=${encodeURIComponent(r.title || "")}`,
            receivedAt: receivedMs,
          };
          newSignals.push(signal);
        } else {
          scan.totalDeduped++;
        }
      }
    } catch (err) {
      console.error("[scanner] email scan error:", err);
    }

    // Scan Teams
    currentPhase = "Scanning Teams...";
    console.log("[scanner] scanning Teams...");
    try {
      const teamsTimeWindow = lastScanTime
        ? `since ${new Date(lastScanTime).toISOString()}`
        : "from the last 24 hours";
      const teamsResponse = await scannerAgent.session.sendAndWait(
        {
          prompt: `Check ${userContext.displayName}'s (${userContext.email}) Teams chats and channel messages ${teamsTimeWindow} for anything actionable. Include:
- Direct messages asking for help, input, or a decision
- Channel threads where someone @mentioned or needs a response
- Follow-up items from recent conversations
- Messages from teammates: ${userContext.team.join(", ")}
- Anything related to projects: ${userContext.projects.join(", ")}

IMPORTANT: For each message, CHECK THE THREAD/CONVERSATION CONTEXT. If it is part of a thread, read the full thread to understand what is being discussed before assigning priority.

Exclude only: bot messages, automated notifications with no action needed, general chatter.

Return a JSON array where each item has these exact fields:
{"source":"teams","title":"<topic>","summary":"<1-2 sentence summary>","sender":"<name>","priority":"high|medium|low","context":"<why this matters>","suggestedAction":"<what to do>","sourceUrl":"https://teams.microsoft.com","receivedAt":"<ISO 8601 timestamp of when it was sent>"}
IMPORTANT: For sourceUrl, provide https://teams.microsoft.com as the Teams link.`,
        },
        SCAN_TIMEOUT
      );
      const teamsResults = parseJsonResponse(
        teamsResponse?.data?.content || "[]"
      );
      console.log(`[scanner] teams raw response (${(teamsResponse?.data?.content || "").length} chars), parsed ${teamsResults.length} items`);
      if (teamsResults.length === 0 && teamsResponse?.data?.content) {
        console.log("[scanner] teams raw preview:", teamsResponse.data.content.slice(0, 500));
      }
      scan.teamsCount = teamsResults.length;
      for (const r of teamsResults) {
        r.source = "teams";
        if (!isDuplicate(r, existingSignals)) {
          const receivedMs = r.receivedAt ? new Date(r.receivedAt).getTime() : Date.now();
          const signal: Signal = {
            id: uuidv4(),
            source: "teams",
            title: r.title || "Untitled",
            summary: r.summary || "",
            sender: r.sender || "Unknown",
            timestamp: receivedMs,
            priority: r.priority || "medium",
            context: r.context || null,
            suggestedAction: r.suggestedAction || null,
            references_json: r.references
              ? JSON.stringify(r.references)
              : null,
            status: "new",
            extractedAt: Date.now(),
            scanId,
            sourceUrl: r.sourceUrl || "https://teams.microsoft.com",
            receivedAt: receivedMs,
          };
          newSignals.push(signal);
        } else {
          scan.totalDeduped++;
        }
      }
    } catch (err) {
      console.error("[scanner] Teams scan error:", err);
    }

    // Persist
    currentPhase = "Saving results...";
    for (const signal of newSignals) {
      insertSignal(signal);
    }
    scan.totalExtracted = newSignals.length;
    scan.newSignalIds = newSignals.map(s => s.id);
    scan.finishedAt = Date.now();
    scan.outcome =
      scan.emailCount + scan.teamsCount > 0 ? "success" : "partial";
    insertScan(scan);

    insertActivity({
      id: uuidv4(),
      type: "scan",
      detail: `Scan complete: ${newSignals.length} new, ${scan.totalDeduped} deduped`,
      entityId: scanId,
      timestamp: Date.now(),
    });

    lastScanTime = Date.now();
    console.log(
      `[scanner] done: ${scan.totalExtracted} extracted, ${scan.totalDeduped} deduped, ${newSignals.length} new`
    );

    return scan;
  } finally {
    scanning = false;
    currentPhase = "idle";
  }
}
