/**
 * Kent onboarding wizard.
 *
 * Steps (0-indexed, left-to-right in the progress bar):
 *
 *   0. Welcome      — friendly intro. Calls POST /api/setup/init in the background
 *                     which creates ~/.kent, generates a device token, and installs
 *                     bundled system prompts into ~/.kent/prompts/.
 *
 *   1. Permissions  — three checklist items:
 *                       ✓ Data directory (~/.kent) — created by init above
 *                       ✓ System prompts — installed by init above
 *                       [ ] Full Disk Access — required for iMessage, Notes,
 *                           Contacts, Health. User clicks "Open System Settings",
 *                           we open the FDA pane, and we poll /api/setup/init
 *                           every 2s until FDA is granted. NON-SKIPPABLE.
 *
 *   2. AI Provider  — choose Anthropic / OpenAI / OpenRouter / Google / Ollama /
 *                     Custom. Enter an API key (or pull a local Ollama model).
 *                     Model list comes from shared/models.ts.
 *
 *   3. Sources      — SSE stream from /api/setup/check-sources auto-detects what's
 *                     available on this machine (iMessage DB, Gmail via gws CLI,
 *                     GitHub via gh CLI, Signal via sqlcipher, etc.). Anything
 *                     detected is auto-enabled. User can toggle individual sources
 *                     and click "Connect" for OAuth-based ones (opens Terminal.app
 *                     with the right `gws auth login` / `gh auth login` command).
 *
 *   4. Channels     — optional notification channels: iMessage, Telegram, Slack.
 *                     This step is skippable.
 *
 *   5. Sync         — saves the wizard config via POST /api/setup/save-config,
 *                     then POST /api/setup/sync which (a) tops up missing default
 *                     workflows and (b) kicks off a fire-and-forget background
 *                     sync for every enabled source. Returns immediately.
 *
 *   6. Done         — success screen. "All set" — data will trickle in as sources
 *                     finish syncing in the background.
 *
 * State lives in SetupPage (bottom of file). Each step is a child component that
 * reads/writes fields via props. The Continue button at the bottom runs
 * `canContinue(step)` to gate advancement (e.g. step 1 requires hasFDA === true).
 */
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const PROVIDER_OPTIONS: { value: ModelProvider; label: string; desc: string }[] = [
  { value: "anthropic", label: "Anthropic", desc: "Claude models" },
  { value: "openai", label: "OpenAI", desc: "GPT & reasoning" },
  { value: "openrouter", label: "OpenRouter", desc: "100+ models" },
  { value: "google", label: "Google", desc: "Gemini models" },
  { value: "local", label: "Ollama", desc: "Local inference" },
  { value: "custom", label: "Custom", desc: "Any OpenAI-compat API" },
];

const SOURCE_LIST = [
  // Google
  { key: "gmail", label: "Gmail", oauth: true, group: "Google" },
  { key: "gcal", label: "Google Calendar", oauth: false, linkedTo: "gmail", group: "Google" },
  { key: "gtasks", label: "Google Tasks", oauth: false, linkedTo: "gmail", group: "Google" },
  { key: "gdrive", label: "Google Drive", oauth: false, linkedTo: "gmail", group: "Google" },
  // Development
  { key: "github", label: "GitHub", oauth: true, group: "Development" },
  { key: "ai_coding", label: "Claude Code & Codex", oauth: false, group: "Development" },
  // Communication
  { key: "imessage", label: "iMessage", oauth: false, group: "Communication" },
  { key: "signal", label: "Signal", oauth: false, group: "Communication" },
  { key: "whatsapp", label: "WhatsApp", oauth: false, group: "Communication" },
  { key: "slack", label: "Slack", oauth: false, group: "Communication" },
  // Browsing
  { key: "chrome", label: "Chrome", oauth: false, group: "Browsing" },
  { key: "safari", label: "Safari", oauth: false, group: "Browsing" },
  // Productivity
  { key: "apple_notes", label: "Apple Notes", oauth: false, group: "Productivity" },
  { key: "apple_reminders", label: "Apple Reminders", oauth: false, group: "Productivity" },
  { key: "apple_calendar", label: "Apple Calendar", oauth: false, group: "Productivity" },
  { key: "notion", label: "Notion", oauth: false, group: "Productivity" },
  { key: "obsidian", label: "Obsidian", oauth: false, group: "Productivity" },
  { key: "granola", label: "Granola", oauth: false, group: "Productivity" },
  // Email
  { key: "outlook", label: "Microsoft Outlook", oauth: false, group: "Email" },
  // Media
  { key: "spotify", label: "Spotify", oauth: false, group: "Media" },
  { key: "apple_music", label: "Apple Music", oauth: false, group: "Media" },
  // System
  { key: "contacts", label: "Contacts", oauth: false, group: "System" },
  { key: "screen_time", label: "Screen Time", oauth: false, group: "System" },
  { key: "apple_health", label: "Apple Health", oauth: false, group: "System" },
  { key: "recent_files", label: "Recent Files", oauth: false, group: "System" },
];

const STEP_LABELS = ["Welcome", "Permissions", "AI Provider", "Sources", "Channels", "Sync", "Done"];

interface InitResult {
  deviceToken?: string;
  promptsInstalled?: boolean;
  hasFullDiskAccess?: boolean;
  kentDir?: string;
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
  message?: string;
}

interface SyncResult {
  workflowsCreated?: number;
  workflowsTotal?: number;
  syncStarted?: boolean;
  error?: string;
}

// ─── Step Components ────────────────────────────────────────────────────────

// Welcome step — pure presentation. No API calls, no side effects. Nothing
// gets created on disk until the user grants Full Disk Access in step 1.
function StepWelcome() {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Welcome to Kent</h2>
        <p className="text-[13px] text-muted-foreground/60">Your personal AI agent. A few steps to get you set up.</p>
      </div>
    </div>
  );
}

// Permissions step — the gate. Nothing touches disk until FDA is granted.
//
// Lifecycle:
//   1. On mount: poll GET /api/setup/check-fda every 2s (read-only, no side effects)
//   2. When FDA flips to true: call POST /api/setup/init ONCE, which creates
//      ~/.kent, generates the device token, and installs bundled prompts
//   3. UI animates each checklist item as it completes: FDA → Data dir → Prompts
//   4. Parent is notified via onReady(initResult) so the rest of the wizard
//      has access to kentDir / deviceToken / etc.
function StepPermissions({
  onReady,
}: {
  onReady: (result: InitResult) => void;
}) {
  const [hasFDA, setHasFDA] = useState(false);
  const [initResult, setInitResult] = useState<InitResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Poll FDA status until granted. Read-only — no disk writes.
  useEffect(() => {
    if (hasFDA) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/setup/check-fda");
        const data = await res.json();
        if (!cancelled && data.hasFullDiskAccess) setHasFDA(true);
      } catch {}
    };
    check();
    const interval = setInterval(check, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hasFDA]);

  // Once FDA is granted, run init exactly once to create ~/.kent + prompts.
  useEffect(() => {
    if (!hasFDA || initResult) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/setup/init", { method: "POST" });
        if (!res.ok) throw new Error(`init failed: ${res.status}`);
        const data: InitResult = await res.json();
        if (!cancelled) {
          setInitResult(data);
          onReady(data);
        }
      } catch (e) {
        if (!cancelled) setInitError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [hasFDA, initResult, onReady]);

  const openSettings = async () => {
    setOpening(true);
    try {
      await fetch("/api/setup/open-permissions", { method: "POST" });
    } catch {}
    setTimeout(() => setOpening(false), 1500);
  };

  const kentDirReady = !!initResult?.kentDir;
  const promptsInstalled = !!initResult?.promptsInstalled;

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Permissions</h2>
        <p className="text-[13px] text-muted-foreground/60">
          Kent needs access to your system to read local data sources.
        </p>
      </div>

      <div className="max-w-md mx-auto space-y-3">
        {/* 1. Full Disk Access — the gate. Must be granted first. */}
        <div className="flex items-center gap-3 border border-border/40 rounded-lg px-4 py-3">
          {hasFDA ? (
            <Check size={14} className="text-emerald-500 shrink-0" />
          ) : (
            <Loader2 size={14} className="animate-spin text-muted-foreground/30 shrink-0" />
          )}
          <div>
            <p className="text-[13px]">Full Disk Access</p>
            <p className="text-[11px] text-muted-foreground/40">iMessage, Apple Notes, Contacts, Health</p>
          </div>
        </div>

        {/* 2. ~/.kent directory — created by init, only after FDA is granted. */}
        <div className="flex items-center gap-3 border border-border/40 rounded-lg px-4 py-3">
          {kentDirReady ? (
            <Check size={14} className="text-emerald-500 shrink-0" />
          ) : (
            <Loader2 size={14} className={`shrink-0 ${hasFDA ? "animate-spin text-muted-foreground/30" : "text-muted-foreground/15"}`} />
          )}
          <div className="min-w-0">
            <p className={`text-[13px] ${hasFDA ? "" : "text-muted-foreground/40"}`}>Data directory</p>
            <p className="text-[11px] text-muted-foreground/40 font-mono truncate">{initResult?.kentDir ?? "~/.kent"}</p>
          </div>
        </div>

        {/* 3. System prompts — written to ~/.kent/prompts by init. */}
        <div className="flex items-center gap-3 border border-border/40 rounded-lg px-4 py-3">
          {promptsInstalled ? (
            <Check size={14} className="text-emerald-500 shrink-0" />
          ) : (
            <Loader2 size={14} className={`shrink-0 ${hasFDA ? "animate-spin text-muted-foreground/30" : "text-muted-foreground/15"}`} />
          )}
          <div>
            <p className={`text-[13px] ${hasFDA ? "" : "text-muted-foreground/40"}`}>System prompts</p>
            <p className="text-[11px] text-muted-foreground/40">Agent identity, skills, and tools</p>
          </div>
        </div>

        {initError && (
          <div className="flex items-center gap-3 border border-red-500/30 rounded-lg px-4 py-3">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <p className="text-[11px] text-red-400">{initError}</p>
          </div>
        )}

        {!hasFDA && (
          <div className="space-y-3 pt-1">
            <div className="border border-border/40 rounded-lg divide-y divide-border/40">
              {[
                { n: "1", text: "Open System Settings" },
                { n: "2", text: "Privacy & Security → Full Disk Access" },
                { n: "3", text: 'Toggle on "Kent"' },
              ].map(({ n, text }) => (
                <div key={n} className="flex items-center gap-4 px-4 py-3">
                  <span className="text-[11px] font-mono text-muted-foreground/25 w-3 shrink-0">{n}</span>
                  <span className="text-[13px] text-foreground/70">{text}</span>
                </div>
              ))}
            </div>

            <button
              onClick={openSettings}
              disabled={opening}
              className="w-full flex items-center justify-center gap-2 border border-border/50 bg-foreground/[0.02] hover:bg-foreground/[0.04] rounded-lg px-4 py-2.5 text-[13px] transition-colors cursor-pointer disabled:opacity-50"
            >
              {opening ? (
                <Loader2 size={13} className="animate-spin text-muted-foreground/40" />
              ) : (
                <ExternalLink size={13} className="text-muted-foreground/40" />
              )}
              Open System Settings
            </button>
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
      <div className="grid grid-cols-2 gap-1.5 max-w-md mx-auto">
        {PROVIDER_OPTIONS.map((opt) => {
          const selected = provider === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => {
                setProvider(opt.value);
                const m = SUGGESTED_MODELS[opt.value];
                if (m.length > 0) setModel(m[0].id);
                else setModel("");
              }}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors cursor-pointer ${
                selected
                  ? "border-foreground/25 bg-foreground/[0.05]"
                  : "border-border/40 bg-transparent hover:bg-foreground/[0.025]"
              }`}
            >
              <div>
                <p className="text-[13px] font-medium leading-none mb-0.5">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground/50">{opt.desc}</p>
              </div>
              {selected && <Check size={13} className="text-foreground/40 shrink-0" />}
            </button>
          );
        })}
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
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50 px-1">
            {hardwareLoading ? (
              <>
                <Loader2 size={11} className="animate-spin shrink-0" />
                <span>Detecting hardware…</span>
              </>
            ) : hardware ? (
              <>
                {hardware.ram && <span>RAM {hardware.ram}</span>}
                {hardware.ram && hardware.gpu && <span className="text-muted-foreground/20">·</span>}
                {hardware.gpu && <span>GPU {hardware.gpu}</span>}
              </>
            ) : (
              <span>Could not detect hardware — showing default models.</span>
            )}
          </div>
        )}

        {/* Model dropdown */}
        {models.length > 0 && (
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1.5 block">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-full text-[13px]">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-[13px]">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  setEnabledSources: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setStatuses([]);
    const es = new EventSource("/api/setup/check-sources");
    es.onmessage = (e) => {
      try {
        const s: SourceStatus = JSON.parse(e.data);
        setStatuses((prev) => {
          const exists = prev.find((p) => p.key === s.key);
          return exists ? prev.map((p) => (p.key === s.key ? s : p)) : [...prev, s];
        });
        // Auto-enable anything available on this machine
        if (s.available) {
          setEnabledSources((prev) => {
            if (prev[s.key] !== undefined) return prev;
            const next = { ...prev, [s.key]: true };
            if (s.key === "gmail") { next.gcal = true; next.gtasks = true; next.gdrive = true; }
            return next;
          });
        }
      } catch {}
    };
    es.addEventListener("done", () => {
      setLoading(false);
      es.close();
    });
    es.onerror = () => { setLoading(false); es.close(); };
    return () => es.close();
  }, [refreshKey]);

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

  const [connecting, setConnecting] = useState<string | null>(null);
  const handleConnect = async (key: string) => {
    setConnecting(key);
    try {
      await fetch(`/api/setup/oauth/${key}`, { method: "POST" });
    } catch {}
    setConnecting(null);
  };
  const refresh = () => setRefreshKey((k) => k + 1);

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
        <button
          onClick={refresh}
          className="mt-3 text-[11px] text-foreground/60 hover:text-foreground transition-colors cursor-pointer underline underline-offset-2"
        >
          Refresh detection
        </button>
      </div>

      <div className="max-w-md mx-auto space-y-1">
        {(() => {
          let lastGroup = "";
          return SOURCE_LIST.map((src) => {
            const status = statuses.find((s) => s.key === src.key);
            const isEnabled = enabledSources[src.key] ?? false;
            const needsOAuth = src.oauth && !status?.connected;
            const showGroup = (src as any).group && (src as any).group !== lastGroup;
            if (showGroup) lastGroup = (src as any).group;

            return (
              <div key={src.key}>
                {showGroup && (
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/40 pt-3 pb-1 px-1">{(src as any).group}</div>
                )}
                <div className="flex items-center justify-between bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => handleToggle(src.key)}
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                        isEnabled
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-border bg-transparent"
                      }`}
                    >
                      {isEnabled && <Check size={12} className="text-white" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{src.label}</span>
                        {status?.connected && (
                          <span className="text-[10px] text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">Connected</span>
                        )}
                        {status && !status.available && !src.oauth && (
                          <span className="text-[10px] text-muted-foreground/40 bg-foreground/[0.04] rounded px-1.5 py-0.5">Unavailable</span>
                        )}
                      </div>
                      {status?.message && !status.connected && (
                        <div className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{status.message}</div>
                      )}
                    </div>
                  </div>
                  {needsOAuth && (
                    <button
                      onClick={() => handleConnect(src.key)}
                      disabled={connecting === src.key}
                      className="flex items-center gap-1 text-[11px] text-foreground/60 hover:text-foreground transition-colors cursor-pointer disabled:opacity-50 shrink-0 ml-2"
                    >
                      {connecting === src.key ? "Opening…" : <>Connect <ExternalLink size={10} /></>}
                    </button>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

function StepChannels({
  botToken,
  setBotToken,
  chatId,
  setChatId,
}: {
  botToken: string;
  setBotToken: (v: string) => void;
  chatId: string;
  setChatId: (v: string) => void;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);

  const autoDetect = async () => {
    if (!botToken.trim()) return;
    setDetecting(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 10 }),
      });
      const data = await res.json() as { ok: boolean; result: Array<{ message?: { chat: { id: number }; from?: { first_name: string } } }> };
      if (data.ok && data.result.length > 0) {
        const id = String(data.result[0]?.message?.chat.id ?? "");
        if (id) {
          setChatId(id);
          setDetected(true);
        }
      }
    } catch {
      // Silently fail — user can enter manually
    }
    setDetecting(false);
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-display tracking-tight mb-2">Set up channels</h2>
        <p className="text-[13px] text-muted-foreground/60">
          Get workflow notifications and chat with Kent via messaging apps.
        </p>
      </div>

      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
          <p className="text-[13px] text-foreground/80 font-medium mb-2">Telegram</p>
          <p className="text-[12px] text-muted-foreground/50">Optional — you can set this up later in Settings.</p>
        </div>

        <div className="bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3 space-y-1">
          <p className="text-[12px] text-muted-foreground/60">1. Open Telegram and message <span className="font-mono text-foreground/70">@BotFather</span></p>
          <p className="text-[12px] text-muted-foreground/60">2. Send <span className="font-mono text-foreground/70">/newbot</span> and pick a name</p>
          <p className="text-[12px] text-muted-foreground/60">3. Paste the bot token below</p>
          <p className="text-[12px] text-muted-foreground/60">4. Send any message to your new bot, then click detect</p>
        </div>

        <div>
          <label className="text-[12px] text-muted-foreground/60 mb-1 block">Bot Token</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
          />
        </div>

        <div>
          <label className="text-[12px] text-muted-foreground/60 mb-1 block">Chat ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Your chat ID"
              className="flex-1 bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-border"
            />
            <button
              onClick={autoDetect}
              disabled={!botToken.trim() || detecting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors cursor-pointer border border-border/50 bg-foreground/[0.03] hover:bg-foreground/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {detecting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : detected ? (
                <Check size={12} className="text-emerald-500" />
              ) : null}
              Detect
            </button>
          </div>
        </div>

        {botToken && chatId && (
          <div className="flex items-center gap-2 text-[12px] text-emerald-500">
            <Check size={14} />
            Telegram configured
          </div>
        )}
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
  telegramBotToken,
  telegramChatId,
}: {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  customApiKey: string;
  enabledSources: Record<string, boolean>;
  telegramBotToken: string;
  telegramChatId: string;
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
            telegramBotToken,
            telegramChatId,
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
  }, [provider, model, apiKey, baseUrl, customApiKey, enabledSources, telegramBotToken, telegramChatId]);

  if (syncing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 size={28} className="text-muted-foreground/40 animate-spin" />
        <p className="text-[13px] text-muted-foreground/50">Saving config...</p>
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
        <h2 className="text-[24px] font-display tracking-tight mb-2">All set</h2>
        <p className="text-[13px] text-muted-foreground/60">Kent is syncing your sources in the background.</p>
      </div>

      <div className="max-w-md mx-auto space-y-3">
        {result?.workflowsTotal != null && result.workflowsTotal > 0 && (
          <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
            <Check size={16} className="text-emerald-500 shrink-0" />
            <span className="text-[13px]">
              {result.workflowsTotal} workflow{result.workflowsTotal === 1 ? "" : "s"} ready
              {result.workflowsCreated ? ` (${result.workflowsCreated} new)` : ""}
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 bg-foreground/[0.03] border border-border/50 rounded-lg px-4 py-3">
          <Check size={16} className="text-emerald-500 shrink-0" />
          <span className="text-[13px]">Background sync started — data will appear shortly</span>
        </div>
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

  // Step 1 (Permissions) is where init actually runs. Until then, initResult
  // is null and the user hasn't been asked for any permission yet.
  const [initResult, setInitResult] = useState<InitResult | null>(null);
  const handleInitReady = useCallback((result: InitResult) => {
    setInitResult(result);
  }, []);

  // Step 1 state
  const [provider, setProvider] = useState<ModelProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(SUGGESTED_MODELS.anthropic[0].id);
  const [baseUrl, setBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");

  // Step 2 state — starts empty, auto-populated by whatever check-sources detects
  const [enabledSources, setEnabledSources] = useState<Record<string, boolean>>({});

  // Step 3 state (Channels)
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");

  const canContinue = (): boolean => {
    switch (step) {
      case 0: // Welcome — always allowed
        return true;
      case 1: // Permissions — blocked until FDA is granted AND init has run
        return !!initResult && initResult.hasFullDiskAccess === true;
      case 2: {
        if (provider === "custom") return baseUrl.trim().length > 0 && model.trim().length > 0;
        if (provider === "local") return model.trim().length > 0;
        return apiKey.trim().length > 0 && model.trim().length > 0;
      }
      case 3: // Sources
        return true;
      case 4: // Channels (optional)
        return true;
      case 5: // Sync
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
              {step === 0 && <StepWelcome />}
              {step === 1 && <StepPermissions onReady={handleInitReady} />}
              {step === 2 && (
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
              {step === 3 && (
                <StepSources
                  enabledSources={enabledSources}
                  setEnabledSources={setEnabledSources}
                />
              )}
              {step === 4 && (
                <StepChannels
                  botToken={telegramBotToken}
                  setBotToken={setTelegramBotToken}
                  chatId={telegramChatId}
                  setChatId={setTelegramChatId}
                />
              )}
              {step === 5 && (
                <StepSync
                  provider={provider}
                  model={model}
                  apiKey={apiKey}
                  baseUrl={baseUrl}
                  customApiKey={customApiKey}
                  enabledSources={enabledSources}
                  telegramBotToken={telegramBotToken}
                  telegramChatId={telegramChatId}
                />
              )}
              {step === 6 && <StepDone onComplete={onComplete} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation buttons */}
      {step < 6 && (
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
              onClick={() => setStep((s) => Math.min(6, s + 1))}
              disabled={!canContinue()}
              className="flex items-center gap-1.5 bg-foreground text-background px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {step === 4 && !telegramBotToken ? "Skip" : "Continue"}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
