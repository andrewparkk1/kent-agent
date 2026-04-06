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
    { id: "llama3.1:8b", label: "Llama 3.1 8B (lightweight)" },
    { id: "llama3.1:70b", label: "Llama 3.1 70B" },
    { id: "mistral", label: "Mistral 7B" },
    { id: "codellama", label: "Code Llama" },
    { id: "deepseek-r1:14b", label: "DeepSeek R1 14B" },
    { id: "qwen2.5:14b", label: "Qwen 2.5 14B" },
  ],
  custom: [],
};

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
    // Local servers typically don't need an API key, but allow one
    return { model, apiKey: api_key || undefined };
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
