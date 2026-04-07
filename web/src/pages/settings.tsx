import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import { Loader2, Check, Eye, EyeOff, Send, Download } from "lucide-react";
import { toast } from "sonner";

type ModelProvider = "anthropic" | "openai" | "openrouter" | "google" | "local" | "custom";

interface Config {
  core: { device_token: string };
  keys: { anthropic: string; openai: string; openrouter: string; google: string };
  sources: Record<string, boolean>;
  daemon: { sync_interval_seconds: number };
  agent: { provider: ModelProvider; default_model: string; base_url: string; api_key: string };
}

const SOURCE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  gcal: "Google Calendar",
  gtasks: "Google Tasks",
  gdrive: "Google Drive",
  github: "GitHub",
  chrome: "Chrome History",
  apple_notes: "Apple Notes",
  imessage: "iMessage",
  signal: "Signal",
  granola: "Granola",
  ai_coding: "Claude & Codex",
};

const PROVIDER_OPTIONS: { value: ModelProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "google", label: "Google" },
  { value: "local", label: "Local (Ollama)" },
  { value: "custom", label: "Custom Endpoint" },
];

const SUGGESTED_MODELS: Record<ModelProvider, { id: string; label: string }[]> = {
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {description && <p className="text-[12px] text-muted-foreground/50 mt-0.5">{description}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer ${
        checked ? "bg-emerald-500" : "bg-foreground/20"
      } ${disabled ? "opacity-40 cursor-default" : ""}`}
    >
      <motion.div
        className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm"
        animate={{ left: checked ? 20 : 3 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [rawKeys, setRawKeys] = useState<{ anthropic: string; openai: string; openrouter: string; google: string }>({ anthropic: "", openai: "", openrouter: "", google: "" });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<{ name: string; size: number }[]>([]);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOllamaModels = useCallback(async (baseUrl?: string) => {
    try {
      const params = baseUrl ? `?base_url=${encodeURIComponent(baseUrl.replace(/\/v1$/, ""))}` : "";
      const res = await fetch(`/api/ollama/models${params}`);
      const data = await res.json();
      setOllamaModels(data.models || []);
      setOllamaError(data.error || null);
    } catch {
      setOllamaModels([]);
      setOllamaError("Failed to reach Ollama");
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setConfig(data.config);
      setRawKeys({ anthropic: data.raw.keys.anthropic, openai: data.raw.keys.openai, openrouter: data.raw.keys.openrouter, google: data.raw.keys.google });
    } catch {
      toast.error("Failed to load settings");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  useEffect(() => {
    if (config?.agent.provider === "local") {
      fetchOllamaModels(config.agent.base_url);
    }
  }, [config?.agent.provider, config?.agent.base_url, fetchOllamaModels]);

  const autoSave = useCallback((updatedConfig: Config, updatedKeys: { anthropic: string; openai: string; openrouter: string; google: string }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const toSave = { ...updatedConfig, keys: updatedKeys };
      try {
        await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: toSave }),
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch {
        toast.error("Failed to save settings");
      }
    }, 500);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
      </div>
    );
  }

  if (!config) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[13px] text-muted-foreground/50">Failed to load settings. Check that the API server is running.</p>
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-[32px] font-display tracking-tight">Settings</h1>
          {saved && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[12px] text-emerald-500"
            >
              <Check size={14} />
              Saved
            </motion.div>
          )}
        </div>

        {/* API Keys */}
        <div className="mb-8">
          <SectionHeader title="API Keys" description="Keys are stored locally in ~/.kent/config.json" />
          <div className="space-y-3">
            {([
              { key: "anthropic" as const, label: "Anthropic API Key", placeholder: "sk-ant-...", providers: ["anthropic"] as ModelProvider[] },
              { key: "openai" as const, label: "OpenAI API Key", placeholder: "sk-...", providers: ["openai"] as ModelProvider[] },
              { key: "openrouter" as const, label: "OpenRouter API Key", placeholder: "sk-or-...", providers: ["openrouter"] as ModelProvider[] },
              { key: "google" as const, label: "Google API Key", placeholder: "AIza...", providers: ["google"] as ModelProvider[] },
            ] as const)
              .filter(({ providers }) => providers.includes(config.agent.provider))
              .map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-[12px] text-muted-foreground/60 mb-1 block">{label}</label>
                <div className="relative">
                  <input
                    type={showAnthropicKey ? "text" : "password"}
                    value={rawKeys[key]}
                    onChange={(e) => {
                      const newKeys = { ...rawKeys, [key]: e.target.value };
                      setRawKeys(newKeys);
                      if (config) autoSave(config, newKeys);
                    }}
                    placeholder={placeholder}
                    className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono pr-10 outline-none focus:border-border"
                  />
                  <button
                    onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
                  >
                    {showAnthropicKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent */}
        <div className="mb-8">
          <SectionHeader title="Agent" description="Model provider and behavior settings" />
          <div className="space-y-3">
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Provider</label>
              <select
                value={config.agent.provider}
                onChange={(e) => {
                  const provider = e.target.value as ModelProvider;
                  const models = SUGGESTED_MODELS[provider];
                  const defaultModel = models.length > 0 ? models[0].id : "";
                  const updated = {
                    ...config,
                    agent: { ...config.agent, provider, default_model: defaultModel, base_url: provider === "local" ? "http://localhost:11434/v1" : config.agent.base_url },
                  };
                  setConfig(updated);
                  autoSave(updated, rawKeys);
                }}
                className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border cursor-pointer appearance-none"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Model</label>
              {config.agent.provider === "local" ? (
                <LocalModelSelect
                  value={config.agent.default_model}
                  ollamaModels={ollamaModels}
                  ollamaError={ollamaError}
                  onChange={(model) => {
                    const updated = { ...config, agent: { ...config.agent, default_model: model } };
                    setConfig(updated);
                    autoSave(updated, rawKeys);
                  }}
                />
              ) : SUGGESTED_MODELS[config.agent.provider].length > 0 ? (
                <select
                  value={config.agent.default_model}
                  onChange={(e) => {
                    const updated = { ...config, agent: { ...config.agent, default_model: e.target.value } };
                    setConfig(updated);
                    autoSave(updated, rawKeys);
                  }}
                  className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border cursor-pointer appearance-none"
                >
                  {SUGGESTED_MODELS[config.agent.provider].map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  {!SUGGESTED_MODELS[config.agent.provider].find((m) => m.id === config.agent.default_model) && (
                    <option value={config.agent.default_model}>{config.agent.default_model}</option>
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.agent.default_model}
                  onChange={(e) => {
                    const updated = { ...config, agent: { ...config.agent, default_model: e.target.value } };
                    setConfig(updated);
                    autoSave(updated, rawKeys);
                  }}
                  placeholder="model-name"
                  className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border"
                />
              )}
            </div>
            {(config.agent.provider === "local" || config.agent.provider === "custom") && (
              <div>
                <label className="text-[12px] text-muted-foreground/60 mb-1 block">Base URL</label>
                <input
                  type="text"
                  value={config.agent.base_url}
                  onChange={(e) => {
                    const updated = { ...config, agent: { ...config.agent, base_url: e.target.value } };
                    setConfig(updated);
                    autoSave(updated, rawKeys);
                  }}
                  placeholder={config.agent.provider === "local" ? "http://localhost:11434/v1" : "https://your-endpoint.com/v1"}
                  className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
                />
              </div>
            )}
            {config.agent.provider === "custom" && (
              <div>
                <label className="text-[12px] text-muted-foreground/60 mb-1 block">API Key (optional)</label>
                <input
                  type="password"
                  value={config.agent.api_key}
                  onChange={(e) => {
                    const updated = { ...config, agent: { ...config.agent, api_key: e.target.value } };
                    setConfig(updated);
                    autoSave(updated, rawKeys);
                  }}
                  placeholder="sk-..."
                  className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
                />
              </div>
            )}
          </div>
        </div>

        {/* Sources */}
        <div className="mb-8">
          <SectionHeader title="Sources" description="Enable or disable data sources for syncing" />
          <div className="space-y-1">
            {Object.entries(config.sources)
              .sort(([a], [b]) => (SOURCE_LABELS[a] || a).localeCompare(SOURCE_LABELS[b] || b))
              .map(([key, enabled]) => (
                <div key={key} className="flex items-center justify-between py-2.5 px-1">
                  <span className="text-[13px] text-foreground/80">{SOURCE_LABELS[key] || key}</span>
                  <Toggle
                    checked={enabled}
                    onChange={(v) => {
                      const updated = { ...config, sources: { ...config.sources, [key]: v } };
                      setConfig(updated);
                      autoSave(updated, rawKeys);
                    }}
                  />
                </div>
              ))}
          </div>
        </div>

        {/* Daemon */}
        <div className="mb-8">
          <SectionHeader title="Daemon" description="Background sync settings" />
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">Sync Interval (seconds)</label>
            <input
              type="number"
              min={10}
              max={3600}
              value={config.daemon.sync_interval_seconds}
              onChange={(e) => {
                const updated = { ...config, daemon: { ...config.daemon, sync_interval_seconds: parseInt(e.target.value) || 300 } };
                setConfig(updated);
                autoSave(updated, rawKeys);
              }}
              className="w-24 bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border"
            />
          </div>
        </div>

        {/* Device */}
        <div className="mb-8">
          <SectionHeader title="Device" />
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">Device Token</label>
            <input
              type="text"
              value={config.core.device_token}
              readOnly
              className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono text-muted-foreground/50 outline-none"
            />
          </div>
        </div>

        {/* Feedback */}
        <FeedbackForm />
      </motion.div>
    </div>
  );
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 ** 2)).toFixed(0)}MB`;
}

function LocalModelSelect({
  value,
  ollamaModels,
  ollamaError,
  onChange,
}: {
  value: string;
  ollamaModels: { name: string; size: number }[];
  ollamaError: string | null;
  onChange: (model: string) => void;
}) {
  const installedNames = new Set(ollamaModels.map((m) => m.name));

  // Merge: installed models first, then suggested ones not yet installed
  const installedSection = ollamaModels.map((m) => ({
    id: m.name,
    label: m.name,
    size: formatSize(m.size),
    installed: true,
  }));

  const suggestedSection = SUGGESTED_MODELS.local
    .filter((s) => !installedNames.has(s.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      size: null as string | null,
      installed: false,
    }));

  const allModels = [...installedSection, ...suggestedSection];

  // If current value isn't in any list, add it
  if (value && !allModels.find((m) => m.id === value)) {
    allModels.unshift({ id: value, label: value, size: null, installed: false });
  }

  return (
    <div className="space-y-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border cursor-pointer appearance-none"
      >
        {installedSection.length > 0 && (
          <optgroup label="Installed">
            {installedSection.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.size})
              </option>
            ))}
          </optgroup>
        )}
        {suggestedSection.length > 0 && (
          <optgroup label="Not Installed">
            {suggestedSection.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        )}
        {allModels.length === 0 && (
          <option value={value}>{value || "No models found"}</option>
        )}
      </select>
      {ollamaError && (
        <p className="text-[11px] text-amber-500/70 flex items-center gap-1">
          <span>Ollama not running — install models with:</span>
          <code className="bg-foreground/5 px-1.5 py-0.5 rounded text-[10px]">ollama pull {value || "llama3.3:8b"}</code>
        </p>
      )}
      {!ollamaError && !installedNames.has(value) && value && (
        <p className="text-[11px] text-amber-500/70 flex items-center gap-1">
          <Download size={10} />
          <span>Not installed — run</span>
          <code className="bg-foreground/5 px-1.5 py-0.5 rounded text-[10px]">ollama pull {value}</code>
        </p>
      )}
    </div>
  );
}

function FeedbackForm() {
  const [type, setType] = useState<"bug" | "feature" | "general">("general");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
      setMessage("");
      setTimeout(() => setSent(false), 3000);
    } catch {
      toast.error("Failed to send feedback");
    }
    setSending(false);
  };

  const types = [
    { value: "general" as const, label: "General" },
    { value: "bug" as const, label: "Bug" },
    { value: "feature" as const, label: "Feature Request" },
  ];

  return (
    <div className="mb-8">
      <SectionHeader title="Feedback" description="Send us a bug report, feature request, or general feedback" />
      <div className="space-y-3">
        <div className="flex gap-2">
          {types.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer border ${
                type === t.value
                  ? "bg-foreground text-background border-foreground"
                  : "bg-foreground/[0.03] text-muted-foreground/50 border-transparent hover:text-muted-foreground/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            type === "bug"
              ? "Describe the bug and how to reproduce it..."
              : type === "feature"
              ? "Describe the feature you'd like to see..."
              : "Tell us what's on your mind..."
          }
          rows={4}
          className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border resize-none"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={!message.trim() || sending}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
              !message.trim() || sending
                ? "bg-foreground/5 text-muted-foreground/30 cursor-default"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          >
            {sending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            {sending ? "Sending..." : "Send Feedback"}
          </button>
          {sent && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 text-[12px] text-emerald-500"
            >
              <Check size={14} />
              Sent! Thanks for your feedback.
            </motion.span>
          )}
        </div>
      </div>
    </div>
  );
}
