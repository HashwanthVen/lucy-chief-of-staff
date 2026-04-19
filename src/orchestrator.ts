import { v4 as uuidv4 } from "uuid";
import type { AgentInstance } from "./agents.js";
import { insertActivity, upsertContact } from "./store.js";

let mailAgent: AgentInstance | null = null;
let teamsAgent: AgentInstance | null = null;
let routerAgent: AgentInstance | null = null;

const CHAT_TIMEOUT = 180_000; // 3 minutes (WorkIQ is slow)

export type Intent = "mail" | "teams" | "briefing" | "meeting-prep" | "general";

export function setAgents(
  mail: AgentInstance | null,
  teams: AgentInstance | null,
  router: AgentInstance | null
): void {
  mailAgent = mail;
  teamsAgent = teams;
  routerAgent = router;
}

export function getMailAgent(): AgentInstance | null { return mailAgent; }
export function getTeamsAgent(): AgentInstance | null { return teamsAgent; }

async function classifyIntent(query: string): Promise<Intent> {
  if (!routerAgent) return "general";

  try {
    const result = await routerAgent.session.sendAndWait(
      { prompt: query },
      15_000
    );
    const classification = (result?.data?.content || "general")
      .trim()
      .toLowerCase();
    if (classification.includes("briefing")) return "briefing";
    if (classification.includes("meeting-prep")) return "meeting-prep";
    if (classification.includes("mail")) return "mail";
    if (classification.includes("teams")) return "teams";
    return "general";
  } catch {
    console.error("[router] classification failed, defaulting to general");
    return "general";
  }
}

function pickAgent(intent: Intent): { agent: AgentInstance | null; name: string } {
  switch (intent) {
    case "mail":
      return { agent: mailAgent, name: "mail-agent" };
    case "teams":
      return { agent: teamsAgent, name: "teams-agent" };
    case "briefing":
    case "meeting-prep":
      return { agent: mailAgent, name: "mail-agent" };
    case "general":
    default:
      // Use router for general queries — it has NO MCP, so won't call WorkIQ
      return { agent: routerAgent || mailAgent, name: routerAgent ? "router" : "mail-agent" };
  }
}

export interface ChatResponse {
  content: string;
  agent: string;
  intent: string;
}

// ─── Single-agent streaming (mail, teams, general) ─────────

function streamSingleAgent(
  agent: AgentInstance,
  agentName: string,
  prompt: string,
  onDelta: (chunk: string) => void,
  onDone: () => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      insertActivity({
        id: uuidv4(),
        type: "chat",
        detail: `[${agentName}] ${prompt.slice(0, 100)}`,
        entityId: null,
        timestamp: Date.now(),
      });
      onDone();
      resolve();
    };

    const handler = (event: any) => {
      if (resolved) return; // Skip if this request is done
      if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
        onDelta(event.data.deltaContent);
      } else if (event.type === "session.idle") {
        cleanup();
      }
    };

    agent.session.on(handler);

    const timer = setTimeout(() => {
      console.error(`[${agentName}] streaming timeout after ${CHAT_TIMEOUT}ms`);
      onDelta("\n\n⚠️ Response timed out. WorkIQ may be slow — try again.");
      cleanup();
    }, CHAT_TIMEOUT);

    console.log(`[${agentName}] streaming response...`);
    agent.session.send({ prompt }).catch((err: Error) => {
      console.error(`[${agentName}] send error:`, err);
      onDelta(`\n\nError: ${err.message}`);
      cleanup();
    });
  });
}

// ─── Collect full response from agent (non-streaming) ──────

function collectAgentResponse(
  agent: AgentInstance,
  agentName: string,
  prompt: string
): Promise<string> {
  return new Promise<string>((resolve) => {
    let content = "";
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(content);
    };

    const handler = (event: any) => {
      if (resolved) return; // Skip if this request is done
      if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
        content += event.data.deltaContent;
      } else if (event.type === "session.idle") {
        finish();
      }
    };

    agent.session.on(handler);

    const timer = setTimeout(() => {
      console.error(`[${agentName}] collect timeout after ${CHAT_TIMEOUT}ms`);
      if (!content) content = "(no response — timed out)";
      finish();
    }, CHAT_TIMEOUT);

    agent.session.send({ prompt }).catch((err: Error) => {
      console.error(`[${agentName}] collect error:`, err);
      content = `Error: ${err.message}`;
      finish();
    });
  });
}

// ─── Briefing handler ──────────────────────────────────────

async function handleBriefing(
  onMeta: (agent: string, intent: string) => void,
  onPhase: (phase: string) => void,
  onDelta: (chunk: string) => void,
  onDone: () => void
): Promise<void> {
  onMeta("briefing", "briefing");

  if (!mailAgent && !teamsAgent) {
    onDelta("No agents are currently available for briefing. Check server logs.");
    onDone();
    return;
  }

  const briefingPrompt = "Check my inbox for emails from the last 24 hours that need my action — decisions, approvals, direct requests, or deadlines. List the top 5 most important ones with: who sent it, what they need, and why it's urgent. Respond in bullet points, not JSON.";

  // Fire off parallel queries
  onPhase("Checking email...");
  const mailPromise = mailAgent
    ? collectAgentResponse(mailAgent, "mail-agent", briefingPrompt)
    : Promise.resolve("(mail agent unavailable)");

  onPhase("Checking Teams...");
  const teamsPromise = teamsAgent
    ? collectAgentResponse(teamsAgent, "teams-agent", briefingPrompt)
    : Promise.resolve("(Teams agent unavailable)");

  const [mailSummary, teamsSummary] = await Promise.all([mailPromise, teamsPromise]);

  onPhase("Synthesizing...");

  // Synthesize into a structured brief
  const synthesized = formatBriefing(mailSummary, teamsSummary);
  onDelta(synthesized);

  insertActivity({
    id: uuidv4(),
    type: "briefing",
    detail: "Daily briefing generated",
    entityId: null,
    timestamp: Date.now(),
  });

  onDone();
}

function formatBriefing(mailSummary: string, teamsSummary: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return [
    `## 📋 Daily Brief — ${dateStr}\n`,
    `### 📧 Email`,
    mailSummary.trim(),
    ``,
    `### 💬 Teams`,
    teamsSummary.trim(),
  ].join("\n");
}

// ─── Stream inbox handler (all recent comms) ──────────────

export interface StreamItem {
  source: "email" | "teams";
  subject: string;
  senderName: string;
  senderEmail: string;
  receivedTime: string;
  snippet: string;
  needsAction: boolean;
  priority: "high" | "medium" | "low";
  sourceUrl: string | null;
}

export async function handleStreamInbox(
  onPhase: (text: string) => void,
  onItems: (source: string, items: StreamItem[]) => void,
  onError: (msg: string) => void,
  onDone: () => void
): Promise<void> {
  const emailPrompt = `List the 30 most recent emails from the last 48 hours. For each, return: subject, sender name, sender email, received time (ISO 8601), a 1-sentence snippet of the body, whether it needs action (boolean), priority (high/medium/low), and the web URL to open it. Return ONLY a valid JSON array with these exact fields for each item:
{"subject":"...","senderName":"...","senderEmail":"...","receivedTime":"...","snippet":"...","needsAction":true/false,"priority":"high|medium|low","sourceUrl":"...or null"}
No markdown, no explanation, just the JSON array.`;

  const teamsPrompt = `List the 30 most recent Teams chat messages and channel messages from the last 48 hours. For each, return: subject/topic as "subject", sender display name as "senderName", sender email as "senderEmail", sent time (ISO 8601) as "receivedTime", a 1-sentence snippet as "snippet", whether it needs action (boolean) as "needsAction", priority (high/medium/low), and the web URL to open it as "sourceUrl". Return ONLY a valid JSON array:
{"subject":"...","senderName":"...","senderEmail":"...","receivedTime":"...","snippet":"...","needsAction":true/false,"priority":"high|medium|low","sourceUrl":"...or null"}
No markdown, no explanation, just the JSON array.`;

  // Fetch emails
  if (mailAgent) {
    onPhase("Loading recent emails...");
    try {
      const result = await mailAgent.session.sendAndWait(
        { prompt: emailPrompt },
        CHAT_TIMEOUT
      );
      const raw = result?.data?.content || "[]";
      const items = parseStreamItems(raw, "email");
      onItems("email", items);
    } catch (err) {
      onError(`Email fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    onError("Mail agent unavailable");
  }

  // Fetch Teams
  if (teamsAgent) {
    onPhase("Loading recent Teams messages...");
    try {
      const result = await teamsAgent.session.sendAndWait(
        { prompt: teamsPrompt },
        CHAT_TIMEOUT
      );
      const raw = result?.data?.content || "[]";
      const items = parseStreamItems(raw, "teams");
      onItems("teams", items);
    } catch (err) {
      onError(`Teams fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    onError("Teams agent unavailable");
  }

  onDone();
}

function parseStreamItems(text: string, source: "email" | "teams"): StreamItem[] {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        source,
        subject: String(item.subject || item.title || item.topic || "Untitled"),
        senderName: String(item.senderName || item.sender || "Unknown"),
        senderEmail: String(item.senderEmail || ""),
        receivedTime: String(item.receivedTime || item.receivedAt || new Date().toISOString()),
        snippet: String(item.snippet || item.summary || ""),
        needsAction: Boolean(item.needsAction),
        priority: (["high", "medium", "low"].includes(String(item.priority)) ? String(item.priority) : "low") as "high" | "medium" | "low",
        sourceUrl: item.sourceUrl ? String(item.sourceUrl) : null,
      }));
    }
    return [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed2 = JSON.parse(match[0]);
        if (Array.isArray(parsed2)) {
          return parsed2.map((item: Record<string, unknown>) => ({
            source,
            subject: String(item.subject || item.title || "Untitled"),
            senderName: String(item.senderName || item.sender || "Unknown"),
            senderEmail: String(item.senderEmail || ""),
            receivedTime: String(item.receivedTime || new Date().toISOString()),
            snippet: String(item.snippet || item.summary || ""),
            needsAction: Boolean(item.needsAction),
            priority: (["high", "medium", "low"].includes(String(item.priority)) ? String(item.priority) : "low") as "high" | "medium" | "low",
            sourceUrl: item.sourceUrl ? String(item.sourceUrl) : null,
          }));
        }
      } catch { /* ignore */ }
    }
    return [];
  }
}

// ─── Meeting prep handler ──────────────────────────────────

export interface MeetingInfo {
  title: string;
  time: string;
  endTime: string;
  attendees: string[];
  location: string;
  context: string;
}

export async function handleMeetingPrep(
  onPhase: (text: string) => void,
  onMeetings: (meetings: MeetingInfo[]) => void,
  onError: (msg: string) => void,
  onDone: () => void
): Promise<void> {
  const agent = mailAgent || teamsAgent;
  if (!agent) {
    onError("No agents available for meeting prep.");
    onDone();
    return;
  }

  const agentName = mailAgent ? "mail-agent" : "teams-agent";

  onPhase("Fetching today's meetings...");

  const meetingPrompt = `What meetings does the user have today and tomorrow? For each meeting, return: title, start time (ISO 8601), end time (ISO 8601), list of attendee names, and location or meeting link. Return ONLY a valid JSON array:
[{"title":"...","time":"...","endTime":"...","attendees":["Name1","Name2"],"location":"..."}]
No markdown, no explanation, just the JSON array.`;

  try {
    const result = await agent.session.sendAndWait(
      { prompt: meetingPrompt },
      CHAT_TIMEOUT
    );
    const raw = result?.data?.content || "[]";
    let meetings = parseMeetings(raw);

    if (meetings.length > 0) {
      onPhase("Gathering context for meetings...");

      // For each meeting, try to get attendee context
      for (let i = 0; i < meetings.length && i < 5; i++) {
        const m = meetings[i];
        if (m.attendees.length > 0) {
          const contextAgent = mailAgent || teamsAgent;
          if (contextAgent) {
            try {
              const contextResult = await contextAgent.session.sendAndWait(
                {
                  prompt: `Briefly summarize any recent emails or Teams messages involving these people: ${m.attendees.join(", ")}. Focus on what was discussed related to "${m.title}". Keep it to 2-3 sentences max. If no relevant context, say "No recent context found." Return plain text only.`,
                },
                60_000
              );
              meetings[i].context = contextResult?.data?.content?.trim() || "No recent context found.";
            } catch {
              meetings[i].context = "Could not fetch context.";
            }
          }
        }
      }
    }

    onMeetings(meetings);
    insertActivity({
      id: uuidv4(),
      type: "meeting-prep",
      detail: `Meeting prep: ${meetings.length} meetings found`,
      entityId: null,
      timestamp: Date.now(),
    });
  } catch (err) {
    onError(`Meeting fetch error: ${err instanceof Error ? err.message : String(err)}`);
  }

  onDone();
}

function parseMeetings(text: string): MeetingInfo[] {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const tryParse = (s: string): MeetingInfo[] => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, unknown>) => ({
          title: String(item.title || "Untitled"),
          time: String(item.time || item.startTime || ""),
          endTime: String(item.endTime || ""),
          attendees: Array.isArray(item.attendees) ? item.attendees.map(String) : [],
          location: String(item.location || ""),
          context: "",
        }));
      }
    } catch { /* ignore */ }
    return [];
  };
  let result = tryParse(cleaned);
  if (result.length === 0) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) result = tryParse(match[0]);
  }
  return result;
}

// ─── Relationship intelligence handler ─────────────────────

export interface WaitingItem {
  senderName: string;
  senderEmail: string;
  subject: string;
  receivedTime: string;
  waitingHours: number;
}

export async function handleRelationships(
  onPhase: (text: string) => void,
  onResult: (data: { waiting: WaitingItem[]; stale: WaitingItem[] }) => void,
  onError: (msg: string) => void,
  onDone: () => void
): Promise<void> {
  const agent = mailAgent || teamsAgent;
  if (!agent) {
    onError("No agents available for relationship intelligence.");
    onDone();
    return;
  }

  onPhase("Finding emails waiting for your reply...");

  const waitingPrompt = `List emails in the user's inbox that have been waiting for a reply for more than 24 hours. For each: sender name, sender email, subject, received time (ISO 8601), and approximate hours waiting. Return ONLY a valid JSON array:
[{"senderName":"...","senderEmail":"...","subject":"...","receivedTime":"...","waitingHours":48}]
No markdown, no explanation, just the JSON array.`;

  const stalePrompt = `Who has the user not responded to in the last week? List the people and their most recent unanswered message. For each: sender name, sender email, subject, received time (ISO 8601), and approximate hours since message. Return ONLY a valid JSON array:
[{"senderName":"...","senderEmail":"...","subject":"...","receivedTime":"...","waitingHours":120}]
No markdown, no explanation, just the JSON array.`;

  let waiting: WaitingItem[] = [];
  let stale: WaitingItem[] = [];

  try {
    const waitingResult = await agent.session.sendAndWait(
      { prompt: waitingPrompt },
      CHAT_TIMEOUT
    );
    waiting = parseWaitingItems(waitingResult?.data?.content || "[]");
  } catch (err) {
    onError(`Waiting items error: ${err instanceof Error ? err.message : String(err)}`);
  }

  onPhase("Checking for stale contacts...");

  try {
    const staleResult = await agent.session.sendAndWait(
      { prompt: stalePrompt },
      CHAT_TIMEOUT
    );
    stale = parseWaitingItems(staleResult?.data?.content || "[]");
  } catch (err) {
    onError(`Stale contacts error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Store contacts in DB
  for (const item of [...waiting, ...stale]) {
    if (item.senderEmail) {
      upsertContact({
        email: item.senderEmail,
        name: item.senderName,
        lastContacted: new Date(item.receivedTime).getTime() || Date.now(),
        avgResponseTimeMs: item.waitingHours * 3600000,
        vipScore: item.waitingHours > 72 ? 80 : 50,
        interactionCount: 1,
        updatedAt: Date.now(),
      });
    }
  }

  insertActivity({
    id: uuidv4(),
    type: "relationships",
    detail: `Relationship intel: ${waiting.length} waiting, ${stale.length} stale`,
    entityId: null,
    timestamp: Date.now(),
  });

  onResult({ waiting, stale });
  onDone();
}

function parseWaitingItems(text: string): WaitingItem[] {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const tryParse = (s: string): WaitingItem[] => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, unknown>) => ({
          senderName: String(item.senderName || item.sender || "Unknown"),
          senderEmail: String(item.senderEmail || ""),
          subject: String(item.subject || item.title || ""),
          receivedTime: String(item.receivedTime || item.receivedAt || ""),
          waitingHours: Number(item.waitingHours || item.hoursWaiting || 0),
        }));
      }
    } catch { /* ignore */ }
    return [];
  };
  let result = tryParse(cleaned);
  if (result.length === 0) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) result = tryParse(match[0]);
  }
  return result;
}

// ─── Main streaming handler ────────────────────────────────

export async function handleChatStreaming(
  prompt: string,
  onMeta: (agent: string, intent: string) => void,
  onDelta: (chunk: string) => void,
  onDone: () => void,
  onPhase?: (phase: string) => void
): Promise<void> {
  const intent = await classifyIntent(prompt);
  console.log(`[router] classified as: ${intent}`);

  const phase = onPhase || (() => {});

  // Briefing: parallel multi-agent flow
  if (intent === "briefing") {
    return handleBriefing(onMeta, phase, onDelta, onDone);
  }

  // Meeting-prep: placeholder
  if (intent === "meeting-prep") {
    onMeta("meeting-prep", "meeting-prep");
    onDelta("🚧 Meeting prep is coming soon. This feature will gather context about your upcoming meetings, attendees, and relevant threads.");
    onDone();
    return;
  }

  // Single-agent routing (mail, teams, general)
  const { agent, name: agentName } = pickAgent(intent);
  onMeta(agentName, intent);

  if (!agent) {
    onDelta("No agents are currently available. Check server logs.");
    onDone();
    return;
  }

  return streamSingleAgent(agent, agentName, prompt, onDelta, onDone);
}
