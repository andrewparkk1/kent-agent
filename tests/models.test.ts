import { test, expect, describe } from "bun:test";
import type { Config } from "@shared/config.ts";
import { DEFAULT_CONFIG } from "@shared/config.ts";
import {
  resolveModel,
  validateProviderConfig,
  SUGGESTED_MODELS,
  DEFAULT_LOCAL_BASE_URL,
  LOCAL_BASE_URLS,
} from "@shared/models.ts";

/**
 * Tests for model resolution across all provider types.
 *
 * Uses the DEFAULT_CONFIG as a base and overrides provider/model fields
 * to test each supported provider path.
 */

function makeConfig(overrides: Partial<Config["agent"]> & { keys?: Partial<Config["keys"]> }): Config {
  const { keys, ...agentOverrides } = overrides;
  return {
    ...DEFAULT_CONFIG,
    keys: { ...DEFAULT_CONFIG.keys, ...(keys ?? {}) },
    agent: { ...DEFAULT_CONFIG.agent, ...agentOverrides },
  };
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

describe("resolveModel — anthropic", () => {
  test("resolves a known Anthropic model from the registry", () => {
    const config = makeConfig({
      provider: "anthropic",
      default_model: "claude-sonnet-4-6",
      keys: { anthropic: "sk-ant-test" },
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("claude-sonnet-4-6");
    expect(model.provider).toBe("anthropic");
    expect(model.api).toBe("anthropic-messages");
    expect(apiKey).toBe("sk-ant-test");
  });

  test("falls back to constructing a model for unknown anthropic model id", () => {
    const config = makeConfig({
      provider: "anthropic",
      default_model: "claude-future-99",
      keys: { anthropic: "sk-ant-test" },
    });
    const { model } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("claude-future-99");
    expect(model.api).toBe("anthropic-messages");
  });

  test("returns API key from config", () => {
    const config = makeConfig({
      provider: "anthropic",
      default_model: "claude-sonnet-4-6",
      keys: { anthropic: "my-key" },
    });
    const { apiKey } = resolveModel(config);
    expect(apiKey).toBe("my-key");
  });

  test("returns undefined apiKey when no key is configured", () => {
    const config = makeConfig({
      provider: "anthropic",
      default_model: "claude-sonnet-4-6",
      keys: { anthropic: "" },
    });
    // Clear env var for test
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { apiKey } = resolveModel(config);
      expect(apiKey).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

// ─── OpenAI ─────────────────────────────────────────────────────────────────

describe("resolveModel — openai", () => {
  test("resolves a known OpenAI model from the registry", () => {
    const config = makeConfig({
      provider: "openai",
      default_model: "gpt-4.1",
      keys: { openai: "sk-openai-test" },
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("gpt-4.1");
    expect(model.provider).toBe("openai");
    expect(apiKey).toBe("sk-openai-test");
  });

  test("falls back for unknown OpenAI model id", () => {
    const config = makeConfig({
      provider: "openai",
      default_model: "gpt-99-turbo",
      keys: { openai: "sk-test" },
    });
    const { model } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("gpt-99-turbo");
    expect(model.api).toBe("openai-completions");
  });
});

// ─── OpenRouter ─────────────────────────────────────────────────────────────

describe("resolveModel — openrouter", () => {
  test("resolves a known OpenRouter model", () => {
    const config = makeConfig({
      provider: "openrouter",
      default_model: "anthropic/claude-sonnet-4",
      keys: { openrouter: "sk-or-test" },
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toContain("claude-sonnet-4");
    expect(apiKey).toBe("sk-or-test");
  });

  test("constructs model for custom openrouter model id", () => {
    const config = makeConfig({
      provider: "openrouter",
      default_model: "custom-vendor/custom-model",
      keys: { openrouter: "sk-or-test" },
    });
    const { model } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("custom-vendor/custom-model");
    expect(model.api).toBe("openai-completions");
  });
});

// ─── Google ─────────────────────────────────────────────────────────────────

describe("resolveModel — google", () => {
  test("resolves a known Google model", () => {
    const config = makeConfig({
      provider: "google",
      default_model: "gemini-2.5-pro",
      keys: { google: "google-key-test" },
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toContain("gemini");
    expect(apiKey).toBe("google-key-test");
  });

  test("constructs model for unknown Google model id", () => {
    const config = makeConfig({
      provider: "google",
      default_model: "gemini-99-ultra",
      keys: { google: "gk" },
    });
    const { model } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("gemini-99-ultra");
    expect(model.api).toBe("google-generative-ai");
  });
});

// ─── Local models ───────────────────────────────────────────────────────────

describe("resolveModel — local", () => {
  test("creates model with default Ollama base URL", () => {
    const config = makeConfig({
      provider: "local",
      default_model: "llama3.1:8b",
      base_url: "",
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("llama3.1:8b");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
    expect(model.provider).toBe("local");
    expect(apiKey).toBe("ollama");
  });

  test("uses custom base URL for LM Studio", () => {
    const config = makeConfig({
      provider: "local",
      default_model: "mistral",
      base_url: LOCAL_BASE_URLS.lmstudio,
    });
    const { model } = resolveModel(config);
    expect(model.baseUrl).toBe("http://localhost:1234/v1");
  });

  test("uses custom base URL for llama.cpp", () => {
    const config = makeConfig({
      provider: "local",
      default_model: "my-model",
      base_url: LOCAL_BASE_URLS.llamacpp,
    });
    const { model } = resolveModel(config);
    expect(model.baseUrl).toBe("http://localhost:8080/v1");
  });

  test("passes API key when provided for local", () => {
    const config = makeConfig({
      provider: "local",
      default_model: "custom-local",
      base_url: "http://localhost:9000/v1",
      api_key: "local-key",
    });
    const { apiKey } = resolveModel(config);
    expect(apiKey).toBe("local-key");
  });

  test("model has reasonable defaults for context and tokens", () => {
    const config = makeConfig({
      provider: "local",
      default_model: "test",
    });
    const { model } = resolveModel(config);
    expect(model.contextWindow).toBeGreaterThan(0);
    expect(model.maxTokens).toBeGreaterThan(0);
    expect(model.cost.input).toBe(0);
    expect(model.cost.output).toBe(0);
  });
});

// ─── Custom endpoint ────────────────────────────────────────────────────────

describe("resolveModel — custom", () => {
  test("creates model with provided base URL and API key", () => {
    const config = makeConfig({
      provider: "custom",
      default_model: "my-custom-model",
      base_url: "https://api.example.com/v1",
      api_key: "custom-key-123",
    });
    const { model, apiKey } = resolveModel(config);
    expect(model).toBeDefined();
    expect(model.id).toBe("my-custom-model");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://api.example.com/v1");
    expect(model.provider).toBe("custom");
    expect(apiKey).toBe("custom-key-123");
  });

  test("works without API key for custom endpoint", () => {
    const config = makeConfig({
      provider: "custom",
      default_model: "open-model",
      base_url: "http://internal-api:8080/v1",
      api_key: "",
    });
    const { model, apiKey } = resolveModel(config);
    expect(model.id).toBe("open-model");
    expect(apiKey).toBeUndefined();
  });

  test("throws when custom provider has no base_url", () => {
    const config = makeConfig({
      provider: "custom",
      default_model: "some-model",
      base_url: "",
    });
    expect(() => resolveModel(config)).toThrow("base_url");
  });
});

// ─── Unknown provider ───────────────────────────────────────────────────────

describe("resolveModel — unknown provider", () => {
  test("throws for unrecognized provider", () => {
    const config = makeConfig({
      provider: "nonexistent" as any,
      default_model: "model",
    });
    expect(() => resolveModel(config)).toThrow("Unknown model provider");
  });
});

// ─── validateProviderConfig ─────────────────────────────────────────────────

describe("validateProviderConfig", () => {
  test("anthropic valid with key", () => {
    const config = makeConfig({ provider: "anthropic", keys: { anthropic: "sk-ant-key" } });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("anthropic invalid without key", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const config = makeConfig({ provider: "anthropic", keys: { anthropic: "" } });
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Anthropic API key");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("openai valid with key", () => {
    const config = makeConfig({ provider: "openai", keys: { openai: "sk-openai" } });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("openai invalid without key", () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const config = makeConfig({ provider: "openai", keys: { openai: "" } });
      expect(validateProviderConfig(config).valid).toBe(false);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });

  test("openrouter valid with key", () => {
    const config = makeConfig({ provider: "openrouter", keys: { openrouter: "sk-or" } });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("openrouter invalid without key", () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const config = makeConfig({ provider: "openrouter", keys: { openrouter: "" } });
      expect(validateProviderConfig(config).valid).toBe(false);
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });

  test("google valid with key", () => {
    const config = makeConfig({ provider: "google", keys: { google: "google-key" } });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("google invalid without key", () => {
    const saved = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const config = makeConfig({ provider: "google", keys: { google: "" } });
      expect(validateProviderConfig(config).valid).toBe(false);
    } finally {
      if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
    }
  });

  test("local always valid (no key required)", () => {
    const config = makeConfig({ provider: "local" });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("custom valid with base_url", () => {
    const config = makeConfig({ provider: "custom", base_url: "http://localhost:8080/v1" });
    expect(validateProviderConfig(config).valid).toBe(true);
  });

  test("custom invalid without base_url", () => {
    const config = makeConfig({ provider: "custom", base_url: "" });
    const result = validateProviderConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("base URL");
  });

  test("unknown provider is invalid", () => {
    const config = makeConfig({ provider: "unknown" as any });
    expect(validateProviderConfig(config).valid).toBe(false);
  });
});

// ─── SUGGESTED_MODELS ───────────────────────────────────────────────────────

describe("SUGGESTED_MODELS", () => {
  test("has entries for all providers", () => {
    const providers: string[] = ["anthropic", "openai", "openrouter", "google", "local", "custom"];
    for (const p of providers) {
      expect(SUGGESTED_MODELS).toHaveProperty(p);
      expect(Array.isArray(SUGGESTED_MODELS[p as keyof typeof SUGGESTED_MODELS])).toBe(true);
    }
  });

  test("each suggested model has id and label", () => {
    for (const [provider, models] of Object.entries(SUGGESTED_MODELS)) {
      for (const model of models) {
        expect(model.id).toBeString();
        expect(model.id.length).toBeGreaterThan(0);
        expect(model.label).toBeString();
        expect(model.label.length).toBeGreaterThan(0);
      }
    }
  });

  test("anthropic has at least one suggested model", () => {
    expect(SUGGESTED_MODELS.anthropic.length).toBeGreaterThan(0);
  });

  test("openai has at least one suggested model", () => {
    expect(SUGGESTED_MODELS.openai.length).toBeGreaterThan(0);
  });

  test("openrouter has at least one suggested model", () => {
    expect(SUGGESTED_MODELS.openrouter.length).toBeGreaterThan(0);
  });

  test("google has at least one suggested model", () => {
    expect(SUGGESTED_MODELS.google.length).toBeGreaterThan(0);
  });

  test("local has at least one suggested model", () => {
    expect(SUGGESTED_MODELS.local.length).toBeGreaterThan(0);
  });

  test("custom has empty suggestions (user provides their own)", () => {
    expect(SUGGESTED_MODELS.custom.length).toBe(0);
  });
});

// ─── LOCAL_BASE_URLS ────────────────────────────────────────────────────────

describe("LOCAL_BASE_URLS", () => {
  test("has ollama, lmstudio, llamacpp entries", () => {
    expect(LOCAL_BASE_URLS.ollama).toContain("11434");
    expect(LOCAL_BASE_URLS.lmstudio).toContain("1234");
    expect(LOCAL_BASE_URLS.llamacpp).toContain("8080");
  });

  test("all URLs end with /v1", () => {
    for (const url of Object.values(LOCAL_BASE_URLS)) {
      expect(url).toEndWith("/v1");
    }
  });

  test("DEFAULT_LOCAL_BASE_URL equals ollama URL", () => {
    expect(DEFAULT_LOCAL_BASE_URL).toBe(LOCAL_BASE_URLS.ollama);
  });
});

// ─── Config backwards compatibility ─────────────────────────────────────────

describe("resolveModel — config defaults", () => {
  test("DEFAULT_CONFIG resolves to anthropic with claude-sonnet-4-6", () => {
    const config = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, anthropic: "test-key" },
    };
    const { model } = resolveModel(config);
    expect(model.id).toBe("claude-sonnet-4-6");
    expect(model.provider).toBe("anthropic");
  });
});
