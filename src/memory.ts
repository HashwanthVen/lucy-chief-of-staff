import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import {
  insertMemory,
  searchMemory,
  touchMemory,
  getMemoriesByTier,
} from "./store.js";
import type { MemoryEntry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const SOUL_PATH = path.join(ROOT, "soul", "SOUL.md");
const MEMORY_DIR = path.join(ROOT, "memory");

// Decay half-lives in days
const HALF_LIFE: Record<string, number> = {
  semantic: Infinity,
  episodic: 7,
  session: 1,
};

// Load SOUL.md
export function loadSoul(): string {
  try {
    return fs.readFileSync(SOUL_PATH, "utf-8");
  } catch {
    console.warn("[memory] SOUL.md not found at", SOUL_PATH);
    return "";
  }
}

// Exponential decay: relevance(t) = e^(-ln(2) * age_days / half_life)
export function decayScore(
  baseScore: number,
  lastTouchedAt: number,
  tier: string
): number {
  const halfLife = HALF_LIFE[tier] ?? 7;
  if (!isFinite(halfLife)) return baseScore; // semantic = no decay

  const ageDays = (Date.now() - lastTouchedAt) / (1000 * 60 * 60 * 24);
  const decay = Math.exp((-Math.LN2 * ageDays) / halfLife);
  return baseScore * decay;
}

// Write to memory
export function remember(
  tier: "semantic" | "episodic" | "session",
  content: string,
  tags: string[] = []
): string {
  const id = uuidv4();
  const now = Date.now();

  // Write to filesystem
  const dir = path.join(MEMORY_DIR, tier);
  fs.mkdirSync(dir, { recursive: true });

  const filename =
    tier === "episodic"
      ? `${new Date().toISOString().slice(0, 10)}.md`
      : `${id.slice(0, 8)}-${tags[0] || "note"}.md`;

  const filepath = path.join(dir, filename);
  const frontmatter = `---
tier: ${tier}
created_at: ${new Date(now).toISOString()}
last_touched_at: ${new Date(now).toISOString()}
tags: ${tags.join(", ")}
---

`;

  if (tier === "episodic" && fs.existsSync(filepath)) {
    // Append to existing daily log
    fs.appendFileSync(filepath, `\n---\n${content}\n`);
  } else {
    fs.writeFileSync(filepath, frontmatter + content);
  }

  // Write to SQLite for search
  insertMemory({
    id,
    tier,
    content,
    tags: tags.join(","),
    createdAt: now,
    lastTouchedAt: now,
  });

  console.log(`[memory] stored ${tier} memory: ${id.slice(0, 8)}`);
  return id;
}

// Search with temporal decay applied
export function recall(
  query: string,
  tier?: string
): Array<MemoryEntry & { score: number }> {
  const results = searchMemory(query, tier);
  return results
    .map((entry) => ({
      ...entry,
      score: decayScore(1.0, entry.lastTouchedAt, entry.tier),
    }))
    .filter((e) => e.score > 0.05) // skip very old entries
    .sort((a, b) => b.score - a.score);
}

// Touch a memory (rehearsal — resets decay)
export function rehearse(memoryId: string): void {
  touchMemory(memoryId);
}

// Prune session checkpoints to last N
export function pruneSessionMemories(keepLast = 10): number {
  const sessions = getMemoriesByTier("session");
  if (sessions.length <= keepLast) return 0;

  const toRemove = sessions
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, sessions.length - keepLast);

  // Move to archive (don't delete)
  const archiveDir = path.join(MEMORY_DIR, "session", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });

  let pruned = 0;
  for (const entry of toRemove) {
    const files = fs.readdirSync(path.join(MEMORY_DIR, "session"));
    for (const f of files) {
      if (f.startsWith(entry.id.slice(0, 8))) {
        const src = path.join(MEMORY_DIR, "session", f);
        const dst = path.join(archiveDir, f);
        try {
          fs.renameSync(src, dst);
          pruned++;
        } catch {}
      }
    }
  }

  console.log(`[memory] pruned ${pruned} session memories, kept last ${keepLast}`);
  return pruned;
}

// Get today's episodic log
export function getTodayLog(): string {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(MEMORY_DIR, "episodic", `${today}.md`);
  try {
    return fs.readFileSync(filepath, "utf-8");
  } catch {
    return "";
  }
}

// Build context string for agent system prompts
export function buildMemoryContext(): string {
  const soul = loadSoul();
  const semanticMemories = getMemoriesByTier("semantic")
    .slice(0, 10)
    .map((m) => m.content)
    .join("\n");
  const todayLog = getTodayLog();

  let ctx = "";
  if (soul) {
    ctx += `<soul>\n${soul}\n</soul>\n\n`;
  }
  if (semanticMemories) {
    ctx += `<semantic_memory>\n${semanticMemories}\n</semantic_memory>\n\n`;
  }
  if (todayLog) {
    ctx += `<today_log>\n${todayLog}\n</today_log>\n\n`;
  }
  return ctx;
}
