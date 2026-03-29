import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  core: {
    convex_url: string;
    device_token: string;
  };
  keys: {
    openai: string;
    anthropic: string;
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
    e2b_template_id: string;
  };
  channels: {
    telegram: {
      enabled: boolean;
      bot_token: string;
      allowed_user_ids: number[];
    };
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
    convex_url: "",
    device_token: "",
  },
  keys: {
    openai: "",
    anthropic: "",
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
    e2b_template_id: "",
  },
  channels: {
    telegram: {
      enabled: false,
      bot_token: "",
      allowed_user_ids: [],
    },
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
