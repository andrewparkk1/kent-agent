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
    // Populated dynamically via getLocalModelOptions() based on detected RAM.
    // This static list is a fallback if hardware detection fails.
    { id: "qwen3.5:27b", label: "Qwen 3.5 27B (coding + tools, ~17GB)" },
    { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B (best coding, ~20GB)" },
    { id: "gemma4:12b", label: "Gemma 4 12B (multimodal + tools, ~9.6GB)" },
    { id: "llama3.3:70b", label: "Llama 3.3 70B (GPT-4 class, ~40GB)" },
    { id: "qwen3:4b", label: "Qwen 3 4B (lightweight, ~2.5GB)" },
  ],
  custom: [],
};

// ─── Hardware detection ───────────────────────────────────────────────────

export interface HardwareInfo {
  chip: string;           // e.g. "Apple M1 Max"
  totalCores: number;     // e.g. 10
  perfCores: number;      // e.g. 8
  effCores: number;       // e.g. 2
  gpuCores: number;       // e.g. 32
  ramGB: number;          // e.g. 64
  metalFamily: string;    // e.g. "Metal 4"
  isAppleSilicon: boolean;
}

/** Run a sysctl query and return trimmed stdout, or fallback on failure. */
function sysctl(key: string, fallback = ""): string {
  try {
    const proc = Bun.spawnSync(["sysctl", "-n", key]);
    const out = new TextDecoder().decode(proc.stdout).trim();
    if (out) return out;
  } catch {}
  return fallback;
}

/** Parse an integer from sysctl output, return 0 on failure. */
function sysctlInt(key: string): number {
  const v = parseInt(sysctl(key), 10);
  return isNaN(v) ? 0 : v;
}

/**
 * Detect full system hardware: CPU chip, cores, RAM, GPU cores, Metal family.
 * Uses fast sysctl calls for CPU/RAM and system_profiler for GPU info.
 */
export function detectHardware(): HardwareInfo {
  // CPU / RAM via sysctl (instant)
  const chip = sysctl("machdep.cpu.brand_string", "Unknown");
  const totalCores = sysctlInt("hw.ncpu") || sysctlInt("hw.logicalcpu");
  const perfCores = sysctlInt("hw.perflevel0.logicalcpu");
  const effCores = sysctlInt("hw.perflevel1.logicalcpu");
  const isAppleSilicon = sysctl("hw.optional.arm64") === "1";

  // RAM
  const memBytes = parseInt(sysctl("hw.memsize"), 10);
  const ramGB = !isNaN(memBytes) && memBytes > 0
    ? Math.round(memBytes / (1024 ** 3))
    : Math.round(require("os").totalmem() / (1024 ** 3));

  // GPU info via system_profiler (slower, ~1s)
  let gpuCores = 0;
  let metalFamily = "";
  try {
    const proc = Bun.spawnSync(["system_profiler", "SPDisplaysDataType", "-json"]);
    const json = JSON.parse(new TextDecoder().decode(proc.stdout));
    const gpu = json?.SPDisplaysDataType?.[0];
    if (gpu) {
      gpuCores = parseInt(gpu.sppci_cores, 10) || 0;
      const metal = gpu.spdisplays_mtlgpufamilysupport || "";
      metalFamily = metal.replace("spdisplays_", "").replace("metal", "Metal ");
    }
  } catch {}

  return { chip, totalCores, perfCores, effCores, gpuCores, ramGB, metalFamily, isAppleSilicon };
}

/** Legacy helper — returns just the RAM in GB. */
export function getSystemRamGB(): number {
  return detectHardware().ramGB;
}

/**
 * Format a hardware summary for display during init.
 */
export function formatHardwareSummary(hw: HardwareInfo): string {
  const lines: string[] = [];
  lines.push(`  Chip     : ${hw.chip}`);
  if (hw.perfCores && hw.effCores) {
    lines.push(`  CPU      : ${hw.totalCores} cores (${hw.perfCores}P + ${hw.effCores}E)`);
  } else if (hw.totalCores) {
    lines.push(`  CPU      : ${hw.totalCores} cores`);
  }
  lines.push(`  Memory   : ${hw.ramGB} GB unified`);
  if (hw.gpuCores) lines.push(`  GPU      : ${hw.gpuCores}-core (${hw.metalFamily || "Metal"})`);
  return lines.join("\n");
}

// ─── Model recommendation by hardware tier ────────────────────────────────

export interface LocalModelRecommendation {
  id: string;
  label: string;
  ramTier: string;
  memUsage: string;  // approximate VRAM usage
}

/**
 * Pick the best local model for an AI agent (tool calling + code) based on
 * available unified memory. Recommendations are from research on Ollama models
 * as of early 2026, optimized for coding, reasoning, and function calling.
 *
 *   8GB  → qwen3:4b            (~2.5GB, light but capable)
 *  16GB  → gemma4:12b          (~9.6GB, strong tool calling + multimodal)
 *  24GB  → qwen3.5:27b         (~17GB, best all-rounder, SWE-bench 72.4%)
 *  32GB  → qwen2.5-coder:32b   (~20GB, best local coding model)
 *  48GB  → llama3.3:70b        (~40GB, GPT-4 class quality)
 *  64GB  → qwen3.5:122b        (~45GB, high quality MoE with headroom)
 *  96GB+ → gpt-oss:120b        (~70GB, matches o3-mini benchmarks)
 */
export function recommendLocalModel(ramGB: number): LocalModelRecommendation {
  if (ramGB >= 96) {
    return { id: "gpt-oss:120b", label: "GPT-OSS 120B (OpenAI-class reasoning)", ramTier: "96GB+", memUsage: "~70GB" };
  }
  if (ramGB >= 64) {
    return { id: "qwen3.5:122b", label: "Qwen 3.5 122B MoE (high quality, efficient)", ramTier: "64GB", memUsage: "~45GB" };
  }
  if (ramGB >= 48) {
    return { id: "llama3.3:70b", label: "Llama 3.3 70B (GPT-4 class)", ramTier: "48GB", memUsage: "~40GB" };
  }
  if (ramGB >= 32) {
    return { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B (best local coding)", ramTier: "32GB", memUsage: "~20GB" };
  }
  if (ramGB >= 24) {
    return { id: "qwen3.5:27b", label: "Qwen 3.5 27B (coding + tool use + reasoning)", ramTier: "24GB", memUsage: "~17GB" };
  }
  if (ramGB >= 16) {
    return { id: "gemma4:12b", label: "Gemma 4 12B (multimodal + tool calling)", ramTier: "16GB", memUsage: "~9.6GB" };
  }
  return { id: "qwen3:4b", label: "Qwen 3 4B (lightweight assistant)", ramTier: "8GB", memUsage: "~2.5GB" };
}

/**
 * Get all model options for the local provider, ordered by RAM requirement.
 * Returns the full list so users can pick alternatives beyond the top recommendation.
 */
export function getLocalModelOptions(ramGB: number): SuggestedModel[] {
  // All models ordered largest → smallest. Filter to those that fit with ~4GB OS headroom.
  const all: (SuggestedModel & { minRam: number })[] = [
    { id: "gpt-oss:120b",        label: "GPT-OSS 120B (reasoning, ~70GB)",          minRam: 96 },
    { id: "qwen3.5:122b",        label: "Qwen 3.5 122B MoE (quality + efficient, ~45GB)", minRam: 64 },
    { id: "llama3.3:70b",        label: "Llama 3.3 70B (GPT-4 class, ~40GB)",       minRam: 48 },
    { id: "qwen2.5-coder:32b",   label: "Qwen 2.5 Coder 32B (best coding, ~20GB)", minRam: 32 },
    { id: "qwen3-coder:30b",     label: "Qwen3 Coder 30B MoE (agentic, ~17GB)",    minRam: 24 },
    { id: "qwen3.5:27b",         label: "Qwen 3.5 27B (coding + tools, ~17GB)",     minRam: 24 },
    { id: "devstral-small-2:24b", label: "Devstral Small 2 24B (SWE-bench #1, ~15GB)", minRam: 24 },
    { id: "gemma4:12b",          label: "Gemma 4 12B (multimodal + tools, ~9.6GB)", minRam: 16 },
    { id: "qwen2.5-coder:14b",   label: "Qwen 2.5 Coder 14B (coding, ~9GB)",       minRam: 16 },
    { id: "phi4:14b",            label: "Phi-4 14B (math + STEM, ~9GB)",            minRam: 16 },
    { id: "qwen3:8b",            label: "Qwen 3 8B (fast general, ~4.7GB)",         minRam: 12 },
    { id: "qwen3:4b",            label: "Qwen 3 4B (lightweight, ~2.5GB)",          minRam: 8 },
    { id: "phi4-mini",           label: "Phi-4 Mini 3.8B (light coding, ~2.5GB)",   minRam: 8 },
  ];
  return all.filter((m) => m.minRam <= ramGB);
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
