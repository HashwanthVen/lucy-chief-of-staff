import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { MCPLocalServerConfig } from "@github/copilot-sdk";
import { userContext } from "./user-context.js";
import { buildMemoryContext } from "./memory.js";

export const AVAILABLE_MODELS = [
  { id: "claude-opus-4.7",    name: "Claude Opus 4.7",    tier: "premium" },
  { id: "claude-opus-4.6",    name: "Claude Opus 4.6",    tier: "premium" },
  { id: "claude-opus-4.6-1m", name: "Claude Opus 4.6 1M", tier: "premium" },
  { id: "claude-sonnet-4.6",  name: "Claude Sonnet 4.6",  tier: "standard" },
  { id: "gpt-5.4",            name: "GPT-5.4",            tier: "standard" },
  { id: "gpt-5.2-codex",      name: "GPT-5.3 Codex",     tier: "standard" },
  { id: "gpt-4.1",            name: "GPT-4.1",            tier: "fast" },
  { id: "gemini-3.1-pro",     name: "Gemini 3.1 Pro",     tier: "standard" },
] as const;

const DEFAULT_MODEL = "gpt-5.4";
const MODEL_FALLBACK = "gpt-4.1";

const WORKIQ_MCP: Record<string, MCPLocalServerConfig> = {
  workiq: {
    type: "local",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@microsoft/workiq", "mcp"],
    tools: ["*"],
    timeout: 120_000,
  },
};

interface AgentInstance {
  client: CopilotClient;
  session: Awaited<ReturnType<CopilotClient["createSession"]>>;
}

async function eulaPreflightMsg(
  session: AgentInstance["session"]
): Promise<void> {
  try {
    await session.sendAndWait(
      {
        prompt:
          "Accept the WorkIQ EULA at https://github.com/microsoft/work-iq-mcp then confirm done.",
      },
      30_000
    );
  } catch {
    // Preflight is best-effort
  }
}

async function createAgent(
  name: string,
  systemPrompt: string,
  useMcp: boolean,
  requestedModel?: string
): Promise<AgentInstance | null> {
  try {
    const client = new CopilotClient({
      cliArgs: ["--allow-all-tools", "--allow-all-paths"],
    });
    await client.start();

    let model = requestedModel || DEFAULT_MODEL;
    try {
      const models = await client.listModels();
      const available = models.map((m: { id: string }) => m.id);
      if (!available.includes(model) && available.includes(MODEL_FALLBACK)) {
        console.log(
          `[${name}] model ${model} unavailable, falling back to ${MODEL_FALLBACK}`
        );
        model = MODEL_FALLBACK;
      }
    } catch {
      // listModels may not be available
    }

    const memoryCtx = buildMemoryContext();
    const fullPrompt = memoryCtx + systemPrompt;
    console.log(`[${name}] system prompt: ${fullPrompt.length} chars (SOUL: ${memoryCtx.includes("SOUL") ? "✅" : "❌"}, memory: ${memoryCtx.length} chars)`);

    const session = await client.createSession({
      model,
      streaming: true,
      onPermissionRequest: approveAll,
      onUserInputRequest: async () => ({ answer: "yes", wasFreeform: true }),
      systemMessage: {
        content: fullPrompt,
      },
      ...(useMcp ? { mcpServers: WORKIQ_MCP } : {}),
    });

    if (useMcp) {
      console.log(`[${name}] running EULA preflight...`);
      await eulaPreflightMsg(session);
    }

    console.log(`[${name}] ready (model: ${model})`);
    return { client, session };
  } catch (err) {
    console.error(`[${name}] init failed (non-fatal):`, err);
    return null;
  }
}

// System prompts
const MAIL_PROMPT = `You are Lucy's MAIL AGENT for ${userContext.displayName} (${userContext.email}).
Domain: ${userContext.domain}. Team: ${userContext.team.join(", ")}.
Projects: ${userContext.projects.join(", ")}.

Use WorkIQ to query the user's Outlook email.

RESPONSE FORMAT RULES (CRITICAL):
- ALWAYS respond in clear, readable prose with bullet points and bold text.
- NEVER output raw JSON arrays or objects in your response. If WorkIQ returns JSON data, YOU MUST reformat it into human-readable bullet points.
- NEVER just pass through WorkIQ's raw response. Always summarize and synthesize.
- For each email, format as: **Subject** — from *Sender* (time ago). Brief summary. [Priority: high/medium/low]
- Group by priority: 🔴 High first, then 🟡 Medium, then 🟢 Low.
- If WorkIQ returns no data or empty results, say "No actionable items found" — do NOT output empty arrays.

THREAD CONTEXT: For EVERY email, CHECK THE THREAD CONTEXT. If it is a reply (RE:) or forward (FW:), read the full conversation thread before assigning priority.

Tools can take up to 60 seconds — do NOT retry or say they timed out. Just wait.`;

const TEAMS_PROMPT = `You are Lucy's TEAMS AGENT for ${userContext.displayName} (${userContext.email}).
Domain: ${userContext.domain}. Team: ${userContext.team.join(", ")}.
Projects: ${userContext.projects.join(", ")}.

Use WorkIQ to query the user's Teams chats and channels.

RESPONSE FORMAT RULES (CRITICAL):
- ALWAYS respond in clear, readable prose with bullet points and bold text.
- NEVER output raw JSON arrays or objects in your response. If WorkIQ returns JSON data, YOU MUST reformat it into human-readable bullet points.
- NEVER just pass through WorkIQ's raw response. Always summarize and synthesize.
- For each message, format as: **Topic** — from *Sender* in #Channel (time ago). Brief summary.
- Group by priority: 🔴 High first, then 🟡 Medium, then 🟢 Low.
- If WorkIQ returns no data or empty results, say "No actionable items found" — do NOT output empty arrays.

THREAD CONTEXT: For EVERY message, CHECK THE THREAD CONTEXT. Read the full thread to understand what is being discussed before assigning priority.

Tools can take up to 60 seconds — do NOT retry or say they timed out. Just wait.`;

const SCANNER_PROMPT = `You are a background scanner for ${userContext.displayName} (${userContext.email}).
Domain: ${userContext.domain}. Team: ${userContext.team.join(", ")}.
Projects: ${userContext.projects.join(", ")}.

CRITICAL INSTRUCTIONS:
1. Use WorkIQ to scan M365 email and Teams for actionable items.
2. For EVERY email/message: CHECK THE THREAD CONTEXT. If it's a reply (RE:) or forward (FW:), read the full thread to understand what's being discussed before labeling priority. A reply saying "Approved" to a request you made is LOW priority. A reply saying "Need your input ASAP" is HIGH.
3. Tools can take up to 60 seconds — do NOT retry or say they timed out. Just wait.
4. Output ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each item MUST have exactly these fields:
{
  "source": "email" or "teams",
  "title": "<subject or topic>",
  "summary": "<1-2 sentence actionable summary>",
  "sender": "<display name>",
  "priority": "high" | "medium" | "low",
  "context": "<why this matters, thread context>",
  "suggestedAction": "<specific action to take>",
  "sourceUrl": "<Outlook web link for emails: https://outlook.office365.com/mail/search?query=SUBJECT. For Teams: https://teams.microsoft.com. ALWAYS provide a link — use the search URL pattern if no direct ID is available>",
  "receivedAt": "<ISO 8601 timestamp of when the original message was sent>"
}`;

const ROUTER_PROMPT = `You are an intent router for Lucy, a Chief of Staff AI. Classify user queries into one of these categories:
- "mail" — questions about email, inbox, messages, priorities, what needs attention, what's urgent, action items, who contacted me
- "teams" — questions about Teams chats, channels, team discussions
- "briefing" — daily summary, what do I need to know today, catch me up, brief me
- "meeting-prep" — prepare for meeting, who am I meeting, context for meeting
- "general" — ONLY greetings (hi, hello), small talk, or meta questions about Lucy herself

IMPORTANT: If the user asks about priorities, action items, what needs attention, urgent items, or anything about their work — classify as "mail" NOT "general".
Only use "general" for pure greetings and small talk.

When classified as "general", respond naturally as Lucy — a helpful, warm chief of staff AI.
For all other categories, respond with ONLY the category name, nothing else.`;

export async function initMailAgent(model?: string): Promise<AgentInstance | null> {
  return createAgent("mail-agent", MAIL_PROMPT, true, model);
}

export async function initTeamsAgent(model?: string): Promise<AgentInstance | null> {
  return createAgent("teams-agent", TEAMS_PROMPT, true, model);
}

export async function initScanner(model?: string): Promise<AgentInstance | null> {
  return createAgent("scanner", SCANNER_PROMPT, true, model);
}

export async function initRouter(model?: string): Promise<AgentInstance | null> {
  return createAgent("router", ROUTER_PROMPT, false, model);
}

export type { AgentInstance };
