/**
 * Model resolution — maps Config provider/model settings to a pi-ai Model object.
 *
 * Supports known cloud providers (anthropic, openai, openrouter, google) via the
 * pi-ai model registry, plus local models (Ollama, LM Studio, llama.cpp) and
 * custom OpenAI-compatible endpoints.
 */
import { getModel, getModels } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { Config, ModelProvider } from "./config.ts";

// ─── Default base URLs for local inference servers ─────────────────────────

export const LOCAL_BASE_URLS = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  llamacpp: "http://localhost:8080/v1",
} as const;

export const DEFAULT_LOCAL_BASE_URL: string = LOCAL_BASE_URLS.ollama;

// ─── Provider → API mapping ────────────────────────────────────────────────

/** Maps our provider names to the pi-ai KnownProvider names used by getModel(). */
const KNOWN_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  google: "google",
};

// ─── Suggested models per provider ─────────────────────────────────────────

export interface SuggestedModel {
  id: string;
  label: string;
}

export const SUGGESTED_MODELS: Record<ModelProvider, SuggestedModel[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast, cheap)" },
  ],
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1 (recommended)" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini (fast, cheap)" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (fastest)" },
    { id: "o3", label: "o3 (reasoning)" },
    { id: "o4-mini", label: "o4-mini (reasoning, cheap)" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 via OpenRouter" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 via OpenRouter" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro via OpenRouter" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1 via OpenRouter" },
    { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick via OpenRouter" },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (recommended)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast)" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  local: [
    { id: "llama3.3:8b", label: "Llama 3.3 8B (best default, 5GB)" },
    { id: "gemma4:e2b", label: "Gemma 4 E2B (ultra-light, 1.5GB)" },
    { id: "phi4:14b", label: "Phi-4 14B (best reasoning, 10GB)" },
    { id: "qwen2.5:14b", label: "Qwen 2.5 14B (best quality, 10GB)" },
    { id: "gemma4:e4b", label: "Gemma 4 E4B (3GB)" },
    { id: "deepseek-r1:14b", label: "DeepSeek R1 14B" },
    { id: "mistral", label: "Mistral 7B" },
  ],
  custom: [],
};

// ─── RAM-based local model auto-selection ─────────────────────────────────

export interface LocalModelRecommendation {
  id: string;
  label: string;
  ramTier: string;
}

/**
 * Detect system RAM (in GB) using macOS sysctl.
 * Falls back to os.totalmem() if sysctl is unavailable.
 */
export function getSystemRamGB(): number {
  try {
    const proc = Bun.spawnSync(["sysctl", "-n", "hw.memsize"]);
    const bytes = parseInt(new TextDecoder().decode(proc.stdout).trim(), 10);
    if (!isNaN(bytes) && bytes > 0) return Math.round(bytes / (1024 ** 3));
  } catch {}
  // Fallback
  const os = require("os");
  return Math.round(os.totalmem() / (1024 ** 3));
}

/**
 * Pick the best local model based on available system RAM.
 *
 *   8GB  → gemma4:e2b       (1.5GB model, leaves headroom)
 *   16GB → llama3.3:8b      (5GB model, best all-rounder)
 *   24GB → phi4:14b          (10GB model, best reasoning)
 *   32GB → qwen2.5:14b      (10GB model, best quality + headroom)
 */
export function recommendLocalModel(ramGB: number): LocalModelRecommendation {
  if (ramGB >= 32) {
    return { id: "qwen2.5:14b", label: "Qwen 2.5 14B (best quality)", ramTier: "32GB+" };
  }
  if (ramGB >= 24) {
    return { id: "phi4:14b", label: "Phi-4 14B (best reasoning)", ramTier: "24GB" };
  }
  if (ramGB >= 16) {
    return { id: "llama3.3:8b", label: "Llama 3.3 8B (best default)", ramTier: "16GB" };
  }
  return { id: "gemma4:e2b", label: "Gemma 4 E2B (ultra-light)", ramTier: "8GB" };
}

// ─── Build a custom Model object for local/custom endpoints ────────────────

function buildCustomModel(
  modelId: string,
  provider: string,
  baseUrl: string,
): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}

// ─── Main resolver ─────────────────────────────────────────────────────────

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string | undefined;
}

/**
 * Resolve a pi-ai Model object from the user's config.
 * Returns the model + the API key to pass in stream options.
 */
export function resolveModel(config: Config): ResolvedModel {
  const { provider, default_model: modelId, base_url, api_key } = config.agent;

  // --- Known cloud providers: look up from pi-ai's registry ----------------
  const knownProvider = KNOWN_PROVIDER_MAP[provider];
  if (knownProvider) {
    // Try exact lookup first
    const model = getModel(knownProvider as any, modelId as any);
    if (model) {
      const key = getApiKeyForProvider(provider, config);
      return { model, apiKey: key || undefined };
    }

    // Fallback: scan all models for this provider for a partial id match
    const allModels = getModels(knownProvider as any);
    const match = allModels.find((m) => m.id === modelId);
    if (match) {
      const key = getApiKeyForProvider(provider, config);
      return { model: match, apiKey: key || undefined };
    }

    // If model not found in registry, build a custom one with the right API
    const apiMap: Record<string, string> = {
      anthropic: "anthropic-messages",
      openai: "openai-completions",
      openrouter: "openai-completions",
      google: "google-generative-ai",
    };
    const apiType = apiMap[provider] ?? "openai-completions";
    const providerModels = getModels(knownProvider as any);
    const template = providerModels[0];
    const fallbackModel: Model<Api> = {
      id: modelId,
      name: modelId,
      api: apiType as Api,
      provider: knownProvider,
      baseUrl: template?.baseUrl ?? "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    };
    const key = getApiKeyForProvider(provider, config);
    return { model: fallbackModel, apiKey: key || undefined };
  }

  // --- Local models (Ollama, LM Studio, llama.cpp) -------------------------
  if (provider === "local") {
    const url: string = base_url || DEFAULT_LOCAL_BASE_URL;
    const model = buildCustomModel(modelId, "local", url);
    // Local servers don't need a real API key, but pi-ai requires one to be set.
    // Pass user-supplied key or a dummy placeholder so the stream doesn't reject.
    return { model, apiKey: api_key || "ollama" };
  }

  // --- Custom OpenAI-compatible endpoint -----------------------------------
  if (provider === "custom") {
    if (!base_url) {
      throw new Error("Custom provider requires a base_url in config.agent.base_url");
    }
    const model = buildCustomModel(modelId, "custom", base_url);
    return { model, apiKey: api_key || undefined };
  }

  throw new Error(`Unknown model provider: ${provider}`);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getApiKeyForProvider(provider: string, config: Config): string {
  switch (provider) {
    case "anthropic":
      return config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "";
    case "openai":
      return config.keys.openai || process.env.OPENAI_API_KEY || "";
    case "openrouter":
      return config.keys.openrouter || process.env.OPENROUTER_API_KEY || "";
    case "google":
      return config.keys.google || process.env.GOOGLE_API_KEY || "";
    default:
      return "";
  }
}

/** Validate that the required API key / base URL is available for a provider. */
export function validateProviderConfig(config: Config): { valid: boolean; error?: string } {
  const { provider, base_url } = config.agent;

  switch (provider) {
    case "anthropic": {
      const key = config.keys.anthropic || process.env.ANTHROPIC_API_KEY;
      if (!key) return { valid: false, error: "Anthropic API key is required. Set it in ~/.kent/config.json or ANTHROPIC_API_KEY env var." };
      return { valid: true };
    }
    case "openai": {
      const key = config.keys.openai || process.env.OPENAI_API_KEY;
      if (!key) return { valid: false, error: "OpenAI API key is required. Set it in ~/.kent/config.json or OPENAI_API_KEY env var." };
      return { valid: true };
    }
    case "openrouter": {
      const key = config.keys.openrouter || process.env.OPENROUTER_API_KEY;
      if (!key) return { valid: false, error: "OpenRouter API key is required. Set it in ~/.kent/config.json or OPENROUTER_API_KEY env var." };
      return { valid: true };
    }
    case "google": {
      const key = config.keys.google || process.env.GOOGLE_API_KEY;
      if (!key) return { valid: false, error: "Google API key is required. Set it in ~/.kent/config.json or GOOGLE_API_KEY env var." };
      return { valid: true };
    }
    case "local":
      return { valid: true };
    case "custom": {
      if (!base_url) return { valid: false, error: "Custom provider requires a base URL in config.agent.base_url." };
      return { valid: true };
    }
    default:
      return { valid: false, error: `Unknown provider: ${provider}` };
  }
}
