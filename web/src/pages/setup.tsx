import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  Check,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

type ModelProvider = "anthropic" | "openai" | "openrouter" | "google" | "local" | "custom";

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
    { id: "qwen3.5:27b", label: "Qwen 3.5 27B (coding + tools, ~17GB)" },
    { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B (best coding, ~20GB)" },
    { id: "gemma4:12b", label: "Gemma 4 12B (multimodal + tools, ~9.6GB)" },
    { id: "qwen3:4b", label: "Qwen 3 4B (lightweight, ~2.5GB)" },
  ],
  custom: [],
};

const PROVIDER_OPTIONS: { value: ModelProvider; label: string; icon: string }[] = [
  { value: "anthropic", label: "Anthropic", icon: "A" },
  { value: "openai", label: "OpenAI", icon: "O" },
  { value: "openrouter", label: "OpenRouter", icon: "R" },
  { value: "google", label: "Google", icon: "G" },
  { value: "local", label: "Local (Ollama)", icon: "L" },
  { value: "custom", label: "Custom", icon: "C" },
];

const SOURCE_LIST = [
  { key: "gmail", label: "Gmail", oauth: true },
  { key: "gcal", label: "Google Calendar", oauth: false, linkedTo: "gmail" },
  { key: "gtasks", label: "Google Tasks", oauth: false, linkedTo: "gmail" },
  { key: "gdrive", label: "Google Drive", oauth: false, linkedTo: "gmail" },
  { key: "github", label: "GitHub", oauth: true },
  { key: "chrome", label: "Chrome History", oauth: false },
  { key: "apple_notes", label: "Apple Notes", oauth: false },
  { key: "imessage", label: "iMessage", oauth: false },
];

const STEP_LABELS = ["Welcome", "AI Provider", "Sources", "Sync", "Done"];

interface InitResult {
  deviceToken?: string;
  promptsInstalled?: boolean;
  hasFullDiskAccess?: boolean;
}

interface HardwareInfo {
  ram?: string;
  gpu?: string;
  recommendedModels?: { id: string; label: string }[];
}

interface SourceStatus {
  key: string;
  available: boolean;
  connected: boolean;
}

interface SyncResult {
  workflowsCreated?: number;
  syncStatus?: string;
  error?: string;
}

// ─── Step Components ────────────────────────────────────────────────────────

function StepWelcome({ onReady }: { onReady: (result: InitResult) => void }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<InitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/setup/init", { method: "POST" });
        const data = await res.json();
        if (!cancelled) {
          setResult(data);
          setLoading(false);
          onReady(data);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to initialize. Is the API server running?");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onReady]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 size={28} className="text-muted-foreground/40 animate-spin" />
        <p className="text-[13px] text-muted-foreground/50">Initializing Kent...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <AlertTriangle size={28} className="text-red-400" />
        <p className="text-[13px] text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Welcome to Kent</h2>
        <p className="text-[13px] text-muted-foreground/60">Your personal AI agent is almost ready. Let's get you set up.</p>
      </div>

      <div className="space-y-3 max-w-md mx-auto">
        <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
          <Check size={16} className="text-emerald-500 shrink-0" />
          <span className="text-[13px]">Device token generated</span>
        </div>
        {result?.promptsInstalled && (
          <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
            <Check size={16} className="text-emerald-500 shrink-0" />
            <span className="text-[13px]">System prompts installed</span>
          </div>
        )}
        {result?.hasFullDiskAccess === false && (
          <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] text-amber-400 font-medium">Full Disk Access not detected</p>
              <p className="text-[12px] text-muted-foreground/50 mt-1">
                Some sources (iMessage, Apple Notes) require Full Disk Access.
                Enable it in System Settings &gt; Privacy &amp; Security.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepProvider({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  model,
  setModel,
  baseUrl,
  setBaseUrl,
  customApiKey,
  setCustomApiKey,
}: {
  provider: ModelProvider;
  setProvider: (p: ModelProvider) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  model: string;
  setModel: (m: string) => void;
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  customApiKey: string;
  setCustomApiKey: (k: string) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [hardwareLoading, setHardwareLoading] = useState(false);

  useEffect(() => {
    if (provider === "local") {
      setHardwareLoading(true);
      fetch("/api/setup/hardware")
        .then((r) => r.json())
        .then((data) => {
          setHardware(data);
          setHardwareLoading(false);
        })
        .catch(() => setHardwareLoading(false));
    }
  }, [provider]);

  const models = provider === "local" && hardware?.recommendedModels?.length
    ? hardware.recommendedModels
    : SUGGESTED_MODELS[provider];

  const needsApiKey = ["anthropic", "openai", "openrouter", "google"].includes(provider);

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Choose your AI provider</h2>
        <p className="text-[13px] text-muted-foreground/60">Select a provider and model for Kent's agent brain.</p>
      </div>

      {/* Provider grid */}
      <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
        {PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setProvider(opt.value);
              const m = SUGGESTED_MODELS[opt.value];
              if (m.length > 0) setModel(m[0].id);
              else setModel("");
            }}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-[13px] transition-colors cursor-pointer ${
              provider === opt.value
                ? "border-foreground/30 bg-foreground/[0.06]"
                : "border-border/50 bg-foreground/[0.02] hover:bg-foreground/[0.04]"
            }`}
          >
            <span className="text-[16px] font-semibold text-foreground/70">{opt.icon}</span>
            <span className="text-muted-foreground">{opt.label}</span>
          </button>
        ))}
      </div>

      <div className="max-w-md mx-auto space-y-4">
        {/* API key for cloud providers */}
        {needsApiKey && (
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "anthropic" ? "sk-ant-..." : provider === "openai" ? "sk-..." : provider === "openrouter" ? "sk-or-..." : "AIza..."}
                className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono pr-10 outline-none focus:border-border"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Custom endpoint */}
        {provider === "custom" && (
          <>
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
              />
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">API Key (optional)</label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="Optional"
                className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
              />
            </div>
          </>
        )}

        {/* Hardware info for local */}
        {provider === "local" && (
          <div className="bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
            {hardwareLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
                <span className="text-[12px] text-muted-foreground/50">Detecting hardware...</span>
              </div>
            ) : hardware ? (
              <div className="space-y-1">
                {hardware.ram && <p className="text-[12px] text-muted-foreground/60">RAM: {hardware.ram}</p>}
                {hardware.gpu && <p className="text-[12px] text-muted-foreground/60">GPU: {hardware.gpu}</p>}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground/50">Could not detect hardware. Showing default models.</p>
            )}
          </div>
        )}

        {/* Model dropdown */}
        {models.length > 0 && (
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Custom model input */}
        {provider === "custom" && (
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">Model name</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-name"
              className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StepSources({
  enabledSources,
  setEnabledSources,
}: {
  enabledSources: Record<string, boolean>;
  setEnabledSources: (s: Record<string, boolean>) => void;
}) {
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/setup/check-sources")
      .then((r) => r.json())
      .then((data) => {
        setStatuses(data.sources || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = (key: string) => {
    const next = { ...enabledSources, [key]: !enabledSources[key] };
    // Gmail auto-enables Calendar/Tasks/Drive
    if (key === "gmail" && next.gmail) {
      next.gcal = true;
      next.gtasks = true;
      next.gdrive = true;
    }
    setEnabledSources(next);
  };

  const handleConnect = (key: string) => {
    // Open OAuth flow in new window
    window.open(`/api/auth/${key}`, "_blank", "width=600,height=700");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 size={28} className="text-muted-foreground/40 animate-spin" />
        <p className="text-[13px] text-muted-foreground/50">Checking available sources...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Connect your data sources</h2>
        <p className="text-[13px] text-muted-foreground/60">Choose which sources Kent should monitor and sync.</p>
      </div>

      <div className="max-w-md mx-auto space-y-2">
        {SOURCE_LIST.map((src) => {
          const status = statuses.find((s) => s.key === src.key);
          const isEnabled = enabledSources[src.key] ?? false;
          const needsOAuth = src.oauth && !status?.connected;

          return (
            <div
              key={src.key}
              className="flex items-center justify-between bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(src.key)}
                  className={`w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                    isEnabled
                      ? "bg-emerald-500 border-emerald-500"
                      : "border-border bg-transparent"
                  }`}
                >
                  {isEnabled && <Check size={12} className="text-white" />}
                </button>
                <span className="text-[13px]">{src.label}</span>
                {status?.connected && (
                  <span className="text-[10px] text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">Connected</span>
                )}
                {status && !status.available && !src.oauth && (
                  <span className="text-[10px] text-muted-foreground/40 bg-foreground/[0.04] rounded px-1.5 py-0.5">Unavailable</span>
                )}
              </div>
              {needsOAuth && (
                <button
                  onClick={() => handleConnect(src.key)}
                  className="flex items-center gap-1 text-[11px] text-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                >
                  Connect <ExternalLink size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepSync({
  provider,
  model,
  apiKey,
  baseUrl,
  customApiKey,
  enabledSources,
}: {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  customApiKey: string;
  enabledSources: Record<string, boolean>;
}) {
  const [syncing, setSyncing] = useState(true);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Save config first
        await fetch("/api/setup/save-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model,
            apiKey,
            baseUrl,
            customApiKey,
            sources: enabledSources,
          }),
        });
        // Then trigger sync
        const res = await fetch("/api/setup/sync", { method: "POST" });
        const data = await res.json();
        if (!cancelled) {
          setResult(data);
          setSyncing(false);
        }
      } catch {
        if (!cancelled) {
          setError("Sync failed. You can retry from Settings later.");
          setSyncing(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [provider, model, apiKey, baseUrl, customApiKey, enabledSources]);

  if (syncing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 size={28} className="text-muted-foreground/40 animate-spin" />
        <p className="text-[13px] text-muted-foreground/50">Saving config and running initial sync...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <AlertTriangle size={28} className="text-amber-400" />
        <p className="text-[13px] text-amber-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Initial sync complete</h2>
        <p className="text-[13px] text-muted-foreground/60">Kent has synced your data and is ready to go.</p>
      </div>

      <div className="max-w-md mx-auto space-y-3">
        {result?.workflowsCreated != null && (
          <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
            <Check size={16} className="text-emerald-500 shrink-0" />
            <span className="text-[13px]">{result.workflowsCreated} workflow{result.workflowsCreated === 1 ? "" : "s"} created</span>
          </div>
        )}
        {result?.syncStatus && (
          <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
            <Check size={16} className="text-emerald-500 shrink-0" />
            <span className="text-[13px]">{result.syncStatus}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDone({ onComplete }: { onComplete: () => void }) {
  const [starting, setStarting] = useState(false);

  const handleOpen = async () => {
    setStarting(true);
    try {
      await fetch("/api/setup/start-services", { method: "POST" });
    } catch {
      // Best-effort
    }
    onComplete();
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-display tracking-tight mb-2">You're all set!</h2>
        <p className="text-[13px] text-muted-foreground/60">Kent is configured and ready to work for you.</p>
      </div>

      <div className="max-w-md mx-auto space-y-3 mb-8">
        <div className="bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
          <p className="text-[13px] text-foreground/80">Kent will automatically:</p>
          <ul className="mt-2 space-y-1.5 text-[12px] text-muted-foreground/60">
            <li>Sync your data sources every 5 minutes</li>
            <li>Run workflows when new data arrives</li>
            <li>Survive reboots via the background daemon</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleOpen}
          disabled={starting}
          className="flex items-center gap-2 bg-foreground text-background px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {starting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Starting...
            </>
          ) : (
            <>
              Open Dashboard
              <ChevronRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main Setup Page ────────────────────────────────────────────────────────

export function SetupPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  // Step 0 state
  const [initReady, setInitReady] = useState(false);
  const handleInitReady = useCallback((_result: InitResult) => {
    setInitReady(true);
  }, []);

  // Step 1 state
  const [provider, setProvider] = useState<ModelProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(SUGGESTED_MODELS.anthropic[0].id);
  const [baseUrl, setBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");

  // Step 2 state
  const [enabledSources, setEnabledSources] = useState<Record<string, boolean>>({
    gmail: true,
    gcal: true,
    gtasks: true,
    gdrive: true,
    github: true,
    chrome: true,
    apple_notes: true,
    imessage: true,
  });

  const canContinue = (): boolean => {
    switch (step) {
      case 0:
        return initReady;
      case 1: {
        if (provider === "custom") return baseUrl.trim().length > 0 && model.trim().length > 0;
        if (provider === "local") return model.trim().length > 0;
        return apiKey.trim().length > 0 && model.trim().length > 0;
      }
      case 2:
        return true;
      case 3:
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Progress bar */}
      <div className="px-8 pt-8 pb-4 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-1">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="w-full h-1 rounded-full overflow-hidden bg-foreground/[0.06]">
                <motion.div
                  className="h-full bg-foreground/40 rounded-full"
                  initial={false}
                  animate={{ width: i <= step ? "100%" : "0%" }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                />
              </div>
              <span className={`text-[10px] ${i <= step ? "text-foreground/60" : "text-muted-foreground/30"}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-8">
        <div className="max-w-2xl mx-auto py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {step === 0 && <StepWelcome onReady={handleInitReady} />}
              {step === 1 && (
                <StepProvider
                  provider={provider}
                  setProvider={setProvider}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  model={model}
                  setModel={setModel}
                  baseUrl={baseUrl}
                  setBaseUrl={setBaseUrl}
                  customApiKey={customApiKey}
                  setCustomApiKey={setCustomApiKey}
                />
              )}
              {step === 2 && (
                <StepSources
                  enabledSources={enabledSources}
                  setEnabledSources={setEnabledSources}
                />
              )}
              {step === 3 && (
                <StepSync
                  provider={provider}
                  model={model}
                  apiKey={apiKey}
                  baseUrl={baseUrl}
                  customApiKey={customApiKey}
                  enabledSources={enabledSources}
                />
              )}
              {step === 4 && <StepDone onComplete={onComplete} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation buttons */}
      {step < 4 && (
        <div className="px-8 py-6 border-t border-border/30 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer disabled:opacity-0 disabled:pointer-events-none"
            >
              <ChevronLeft size={14} />
              Back
            </button>
            <button
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={!canContinue()}
              className="flex items-center gap-1.5 bg-foreground text-background px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Continue
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
