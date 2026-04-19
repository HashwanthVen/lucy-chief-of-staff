export interface Signal {
  id: string;
  source: "email" | "teams";
  title: string;
  summary: string;
  sender: string;
  timestamp: number;
  priority: "high" | "medium" | "low";
  context: string | null;
  suggestedAction: string | null;
  references_json: string | null;
  status: "new" | "reviewed" | "acted" | "dismissed";
  extractedAt: number;
  scanId: string;
  sourceUrl: string | null;
  receivedAt: number | null;
}

export interface Scan {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  emailCount: number;
  teamsCount: number;
  totalExtracted: number;
  totalDeduped: number;
  outcome: "success" | "partial" | "failed";
  newSignalIds?: string[];
}

export interface Activity {
  id: string;
  type: string;
  detail: string;
  entityId: string | null;
  timestamp: number;
}

export interface ScanResult {
  source: "email" | "teams";
  title: string;
  summary: string;
  sender: string;
  priority: "high" | "medium" | "low";
  context?: string;
  suggestedAction?: string;
  references?: Array<{ label: string; url: string }>;
  sourceUrl?: string;
  receivedAt?: string;
}

export interface Contact {
  email: string;
  name: string;
  lastContacted: number;
  avgResponseTimeMs: number | null;
  vipScore: number;
  interactionCount: number;
  updatedAt: number;
}

export interface ModelConfig {
  agentRole: string;
  modelId: string;
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  tier: 'semantic' | 'episodic' | 'session';
  content: string;
  tags: string;
  createdAt: number;
  lastTouchedAt: number;
}

export interface UserContext {
  displayName: string;
  email: string;
  team: string[];
  domain: string;
  projects: string[];
}

export interface Feedback {
  id: string;
  type: string;
  detail: string;
  pattern: string | null;
  timestamp: number;
  applied: number;
}

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  useMcp: boolean;
  timeout: number;
}
