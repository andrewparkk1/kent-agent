/**
 * Config schema + paths. Everything lives under ~/.kent/:
 * - config.json: API keys, source toggles, daemon interval, agent model
 * - kent.db: SQLite database (items, threads, messages)
 * - daemon.pid / daemon.log / daemon-state.json: daemon lifecycle
 * - prompts/: agent system prompt files
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ModelProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "google"
  | "local"
  | "custom";

export interface Config {
  core: {
    device_token: string;
    timezone: string;
  };
  keys: {
    anthropic: string;
    openai: string;
    openrouter: string;
    google: string;
  };
  sources: {
    imessage: boolean;
    signal: boolean;
    granola: boolean;
    gmail: boolean;
    gcal: boolean;
    gtasks: boolean;
    gdrive: boolean;
    github: boolean;
    chrome: boolean;
    apple_notes: boolean;
    ai_coding: boolean;
  };
  daemon: {
    sync_interval_seconds: number;
  };
  agent: {
    provider: ModelProvider;
    default_model: string;
    base_url: string;
    api_key: string;
  };
}

export const KENT_DIR = join(homedir(), ".kent");
export const CONFIG_PATH = join(KENT_DIR, "config.json");
export const PID_PATH = join(KENT_DIR, "daemon.pid");
export const LOG_PATH = join(KENT_DIR, "daemon.log");
export const DAEMON_STATE_PATH = join(KENT_DIR, "daemon-state.json");
export const PROMPTS_DIR = join(KENT_DIR, "prompts");
export const PLIST_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "sh.kent.daemon.plist",
);
export const WEB_PLIST_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "sh.kent.web.plist",
);

export const DEFAULT_CONFIG: Config = {
  core: {
    device_token: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  keys: {
    anthropic: "",
    openai: "",
    openrouter: "",
    google: "",
  },
  sources: {
    imessage: false,
    signal: false,
    granola: false,
    gmail: false,
    gcal: false,
    gtasks: false,
    gdrive: false,
    github: false,
    chrome: false,
    apple_notes: false,
    ai_coding: false,
  },
  daemon: {
    sync_interval_seconds: 300,
  },
  agent: {
    provider: "anthropic",
    default_model: "claude-sonnet-4-6",
    base_url: "",
    api_key: "",
  },
};

export function ensureKentDir(): void {
  if (!existsSync(KENT_DIR)) {
    mkdirSync(KENT_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureKentDir();
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    // Deep merge with defaults so new fields get filled in
    return {
      core: { ...DEFAULT_CONFIG.core, ...saved.core },
      keys: { ...DEFAULT_CONFIG.keys, ...saved.keys },
      sources: { ...DEFAULT_CONFIG.sources, ...saved.sources },
      daemon: { ...DEFAULT_CONFIG.daemon, ...saved.daemon },
      agent: { ...DEFAULT_CONFIG.agent, ...saved.agent },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  ensureKentDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
