/** GET /api/settings — return config. POST /api/settings — save config. */
import { loadConfig, saveConfig } from "../../shared/config.ts";
import { userInfo } from "node:os";

export function handleSettings() {
  const config = loadConfig();
  // Mask API keys for display
  const masked = {
    ...config,
    keys: {
      anthropic: config.keys.anthropic ? maskKey(config.keys.anthropic) : "",
      openai: config.keys.openai ? maskKey(config.keys.openai) : "",
      openrouter: config.keys.openrouter ? maskKey(config.keys.openrouter) : "",
      google: config.keys.google ? maskKey(config.keys.google) : "",
    },
  };
  let osUser = "";
  try { osUser = userInfo().username; } catch {}
  return Response.json({ config: masked, raw: config, osUser });
}

export async function handleSettingsSave(req: Request) {
  const body = await req.json();
  const { config } = body as { config: any };
  if (!config) return Response.json({ error: "config required" }, { status: 400 });

  // Merge with existing to preserve keys that weren't sent
  const existing = loadConfig();
  const merged = {
    core: { ...existing.core, ...config.core },
    keys: { ...existing.keys, ...config.keys },
    sources: { ...existing.sources, ...config.sources },
    daemon: { ...existing.daemon, ...config.daemon },
    agent: { ...existing.agent, ...config.agent },
    telegram: { ...existing.telegram, ...config.telegram },
  };

  saveConfig(merged);
  return Response.json({ ok: true });
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 7) + "•".repeat(Math.min(20, key.length - 11)) + key.slice(-4);
}
