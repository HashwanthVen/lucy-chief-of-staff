import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import type { Signal, Scan, Activity, Contact, ModelConfig, MemoryEntry, Feedback } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "..", "lucy.db");

let db: Database.Database;

export function initStore(): void {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      sender TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      priority TEXT NOT NULL,
      context TEXT,
      suggestedAction TEXT,
      references_json TEXT,
      status TEXT DEFAULT 'new',
      extractedAt INTEGER NOT NULL,
      scanId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      startedAt INTEGER,
      finishedAt INTEGER,
      emailCount INTEGER DEFAULT 0,
      teamsCount INTEGER DEFAULT 0,
      totalExtracted INTEGER DEFAULT 0,
      totalDeduped INTEGER DEFAULT 0,
      outcome TEXT
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      type TEXT,
      detail TEXT,
      entityId TEXT,
      timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS contacts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lastContacted INTEGER,
      avgResponseTimeMs INTEGER,
      vipScore INTEGER DEFAULT 0,
      interactionCount INTEGER DEFAULT 0,
      updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS model_config (
      agentRole TEXT PRIMARY KEY,
      modelId TEXT NOT NULL,
      updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      createdAt INTEGER NOT NULL,
      lastTouchedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      detail TEXT NOT NULL,
      pattern TEXT,
      timestamp INTEGER NOT NULL,
      applied INTEGER DEFAULT 0
    );
  `);

  // Add columns to signals (may already exist)
  try { db.exec("ALTER TABLE signals ADD COLUMN sourceUrl TEXT"); } catch {}
  try { db.exec("ALTER TABLE signals ADD COLUMN receivedAt INTEGER"); } catch {}

  // Backfill sourceUrl for existing signals that have none
  const nullUrlSignals = db.prepare("SELECT id, source, title FROM signals WHERE sourceUrl IS NULL OR sourceUrl = ''").all() as Array<{ id: string; source: string; title: string }>;
  if (nullUrlSignals.length > 0) {
    const updateStmt = db.prepare("UPDATE signals SET sourceUrl = ? WHERE id = ?");
    for (const s of nullUrlSignals) {
      const url = s.source === "email"
        ? `https://outlook.office365.com/mail/search?query=${encodeURIComponent(s.title)}`
        : "https://teams.microsoft.com";
      updateStmt.run(url, s.id);
    }
    console.log(`[store] backfilled sourceUrl for ${nullUrlSignals.length} existing signals`);
  }

  // Seed default model configs
  const defaults: [string, string][] = [
    ['router', 'gpt-4.1'],
    ['scanner', 'claude-opus-4.6-1m'],
    ['mail', 'claude-opus-4.6-1m'],
    ['teams', 'claude-opus-4.6-1m'],
    ['briefing', 'claude-opus-4.6-1m'],
    ['meeting-prep', 'claude-opus-4.6-1m'],
  ];
  const seedStmt = db.prepare("INSERT OR REPLACE INTO model_config (agentRole, modelId, updatedAt) VALUES (?, ?, ?)");
  for (const [role, model] of defaults) {
    seedStmt.run(role, model, Date.now());
  }

  // Clean duplicate signals
  const deduped = deduplicateSignals();
  if (deduped > 0) console.log(`[store] cleaned ${deduped} duplicate signals`);

  console.log("[store] SQLite initialized at", DB_PATH);
}

// Deduplication
export function deduplicateSignals(): number {
  db.exec(`
    DELETE FROM signals WHERE id NOT IN (
      SELECT MIN(id) FROM signals GROUP BY LOWER(title), source
    )
  `);
  const row = db.prepare("SELECT changes() as c").get() as { c: number } | undefined;
  return row?.c || 0;
}

// Signals
export function insertSignal(signal: Signal): void {
  db.prepare(`
    INSERT OR IGNORE INTO signals (id, source, title, summary, sender, timestamp, priority, context, suggestedAction, references_json, status, extractedAt, scanId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.id, signal.source, signal.title, signal.summary, signal.sender,
    signal.timestamp, signal.priority, signal.context, signal.suggestedAction,
    signal.references_json, signal.status, signal.extractedAt, signal.scanId
  );
}

export function getSignals(status?: string, limit = 100): Signal[] {
  if (status) {
    return db.prepare("SELECT * FROM signals WHERE status = ? ORDER BY priority = 'high' DESC, timestamp DESC LIMIT ?").all(status, limit) as Signal[];
  }
  return db.prepare("SELECT * FROM signals ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, timestamp DESC LIMIT ?").all(limit) as Signal[];
}

export function updateSignalStatus(id: string, status: string): boolean {
  const result = db.prepare("UPDATE signals SET status = ? WHERE id = ?").run(status, id);
  return result.changes > 0;
}

export function getRecentSignals(withinMs: number): Signal[] {
  const since = Date.now() - withinMs;
  return db.prepare("SELECT * FROM signals WHERE status = 'new' AND extractedAt > ?").all(since) as Signal[];
}

// Scans
export function insertScan(scan: Scan): void {
  db.prepare(`
    INSERT OR REPLACE INTO scans (id, startedAt, finishedAt, emailCount, teamsCount, totalExtracted, totalDeduped, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(scan.id, scan.startedAt, scan.finishedAt, scan.emailCount, scan.teamsCount, scan.totalExtracted, scan.totalDeduped, scan.outcome);
}

export function getScans(limit = 20): Scan[] {
  return db.prepare("SELECT * FROM scans ORDER BY startedAt DESC LIMIT ?").all(limit) as Scan[];
}

export function getLastScan(): Scan | undefined {
  return db.prepare("SELECT * FROM scans ORDER BY startedAt DESC LIMIT 1").get() as Scan | undefined;
}

// Activity
export function insertActivity(activity: Activity): void {
  db.prepare(`
    INSERT INTO activity (id, type, detail, entityId, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(activity.id, activity.type, activity.detail, activity.entityId, activity.timestamp);
}

export function getActivity(limit = 50): Activity[] {
  return db.prepare("SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?").all(limit) as Activity[];
}

export function getSignalCount(status = "new"): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM signals WHERE status = ?").get(status) as { count: number };
  return row.count;
}

export function getScansToday(): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db.prepare("SELECT COUNT(*) as count FROM scans WHERE startedAt >= ?").get(startOfDay.getTime()) as { count: number };
  return row.count;
}

// Contacts
export function upsertContact(contact: Contact): void {
  db.prepare(`
    INSERT OR REPLACE INTO contacts (email, name, lastContacted, avgResponseTimeMs, vipScore, interactionCount, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(contact.email, contact.name, contact.lastContacted, contact.avgResponseTimeMs, contact.vipScore, contact.interactionCount, contact.updatedAt);
}

export function getContacts(limit = 100): Contact[] {
  return db.prepare("SELECT * FROM contacts ORDER BY lastContacted DESC LIMIT ?").all(limit) as Contact[];
}

export function getVips(minScore = 70): Contact[] {
  return db.prepare("SELECT * FROM contacts WHERE vipScore >= ? ORDER BY vipScore DESC").all(minScore) as Contact[];
}

// Model Config
export function getModelConfig(): ModelConfig[] {
  return db.prepare("SELECT * FROM model_config ORDER BY agentRole").all() as ModelConfig[];
}

export function setModelConfig(role: string, modelId: string): void {
  db.prepare("INSERT OR REPLACE INTO model_config (agentRole, modelId, updatedAt) VALUES (?, ?, ?)").run(role, modelId, Date.now());
}

// Memory
export function insertMemory(entry: MemoryEntry): void {
  db.prepare(`
    INSERT OR REPLACE INTO memory (id, tier, content, tags, createdAt, lastTouchedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.id, entry.tier, entry.content, entry.tags, entry.createdAt, entry.lastTouchedAt);
}

export function searchMemory(query: string, tier?: string): MemoryEntry[] {
  const pattern = `%${query}%`;
  if (tier) {
    return db.prepare("SELECT * FROM memory WHERE tier = ? AND (content LIKE ? OR tags LIKE ?) ORDER BY lastTouchedAt DESC").all(tier, pattern, pattern) as MemoryEntry[];
  }
  return db.prepare("SELECT * FROM memory WHERE content LIKE ? OR tags LIKE ? ORDER BY lastTouchedAt DESC").all(pattern, pattern) as MemoryEntry[];
}

export function touchMemory(id: string): void {
  db.prepare("UPDATE memory SET lastTouchedAt = ? WHERE id = ?").run(Date.now(), id);
}

export function getMemoriesByTier(tier: string): MemoryEntry[] {
  return db.prepare("SELECT * FROM memory WHERE tier = ? ORDER BY lastTouchedAt DESC").all(tier) as MemoryEntry[];
}

export function deleteMemory(id: string): void {
  db.prepare("DELETE FROM memory WHERE id = ?").run(id);
}

// Feedback
export function insertFeedback(id: string, type: string, detail: string, pattern: string | null): void {
  db.prepare(`
    INSERT OR IGNORE INTO feedback (id, type, detail, pattern, timestamp, applied)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, type, detail, pattern, Date.now());
}

export function getRecentFeedback(limit = 50): Feedback[] {
  return db.prepare("SELECT * FROM feedback ORDER BY timestamp DESC LIMIT ?").all(limit) as Feedback[];
}

export function getDismissalPatterns(): Array<{ pattern: string; count: number }> {
  return db.prepare(`
    SELECT pattern, COUNT(*) as count
    FROM feedback
    WHERE type = 'dismiss' AND pattern IS NOT NULL AND applied = 0
    GROUP BY pattern
    HAVING COUNT(*) >= 3
    ORDER BY count DESC
  `).all() as Array<{ pattern: string; count: number }>;
}

export function markFeedbackApplied(ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE feedback SET applied = 1 WHERE id IN (${placeholders})`).run(...ids);
}
