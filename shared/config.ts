import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Kent hosted infrastructure — reads from .env (Bun auto-loads)
export const CONVEX_URL_DEV = process.env.CONVEX_URL_DEV ?? "";
export const CONVEX_URL_PROD = process.env.CONVEX_URL ?? "";
export const CONVEX_URL = process.env.KENT_ENV === "dev" ? CONVEX_URL_DEV : CONVEX_URL_PROD;
export const KENT_TELEGRAM_BOT = process.env.KENT_TELEGRAM_BOT ?? "";

export interface Config {
  core: {
    device_token: string;
  };
  // No more convex_url, e2b keys — these are hosted
  keys: {
    anthropic: string; // placeholder "[encrypted]" — real keys in Convex
    openai: string; // placeholder "[encrypted]" — real keys in Convex
  };
  sources: {
    imessage: boolean;
    signal: boolean;
    granola: boolean;
    gmail: boolean;
    github: boolean;
    chrome: boolean;
    apple_notes: boolean;
  };
  daemon: {
    sync_interval_minutes: number;
  };
  agent: {
    default_model: string;
    max_turns: number;
    default_runner: "cloud" | "local" | "auto";
  };
  telegram: {
    linked: boolean;
    user_id: number | null; // auto-detected via deep link
    username: string | null;
  };
}

export const KENT_DIR = join(homedir(), ".kent");
export const CONFIG_PATH = join(KENT_DIR, "config.json");
export const PID_PATH = join(KENT_DIR, "daemon.pid");
export const LOG_PATH = join(KENT_DIR, "daemon.log");
export const PLIST_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "sh.kent.daemon.plist",
);

export const DEFAULT_CONFIG: Config = {
  core: {
    device_token: "",
  },
  keys: {
    anthropic: "",
    openai: "",
  },
  sources: {
    imessage: false,
    signal: false,
    granola: false,
    gmail: false,
    github: false,
    chrome: false,
    apple_notes: false,
  },
  daemon: {
    sync_interval_minutes: 5,
  },
  agent: {
    default_model: "claude-sonnet-4-20250514",
    max_turns: 10,
    default_runner: "auto",
  },
  telegram: {
    linked: false,
    user_id: null,
    username: null,
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
    return JSON.parse(raw) as Config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  ensureKentDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
