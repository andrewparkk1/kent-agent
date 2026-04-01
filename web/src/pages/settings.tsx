import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Loader2, Check, Eye, EyeOff } from "lucide-react";

interface Config {
  core: { device_token: string };
  keys: { anthropic: string; openai: string };
  sources: Record<string, boolean>;
  daemon: { sync_interval_minutes: number };
  agent: { default_model: string; max_turns: number };
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
};

const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "claude-haiku-3-5-20241022", label: "Claude Haiku 3.5" },
];

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
  const [rawKeys, setRawKeys] = useState<{ anthropic: string; openai: string }>({ anthropic: "", openai: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [keyEdited, setKeyEdited] = useState<{ anthropic: boolean; openai: boolean }>({ anthropic: false, openai: false });

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setConfig(data.config);
      setRawKeys({ anthropic: data.raw.keys.anthropic, openai: data.raw.keys.openai });
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const save = async () => {
    if (!config) return;
    setSaving(true);

    const toSave = {
      ...config,
      keys: {
        anthropic: keyEdited.anthropic ? rawKeys.anthropic : undefined,
        openai: keyEdited.openai ? rawKeys.openai : undefined,
      },
    };
    // Remove undefined keys so they don't overwrite
    if (!keyEdited.anthropic) delete (toSave.keys as any).anthropic;
    if (!keyEdited.openai) delete (toSave.keys as any).openai;

    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: toSave }),
      });
      setSaved(true);
      setKeyEdited({ anthropic: false, openai: false });
      setTimeout(() => setSaved(false), 2000);
      // Re-fetch to get fresh masked keys
      fetchConfig();
    } catch {}
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-[32px] font-display tracking-tight">Settings</h1>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? "Saved" : "Save changes"}
          </button>
        </div>

        {/* API Keys */}
        <div className="mb-8">
          <SectionHeader title="API Keys" description="Keys are stored locally in ~/.kent/config.json" />
          <div className="space-y-3">
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Anthropic API Key</label>
              <div className="relative">
                <input
                  type={showAnthropicKey ? "text" : "password"}
                  value={keyEdited.anthropic ? rawKeys.anthropic : config.keys.anthropic}
                  onChange={(e) => {
                    setRawKeys((k) => ({ ...k, anthropic: e.target.value }));
                    setKeyEdited((k) => ({ ...k, anthropic: true }));
                  }}
                  placeholder="sk-ant-..."
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
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">OpenAI API Key</label>
              <div className="relative">
                <input
                  type={showOpenaiKey ? "text" : "password"}
                  value={keyEdited.openai ? rawKeys.openai : config.keys.openai}
                  onChange={(e) => {
                    setRawKeys((k) => ({ ...k, openai: e.target.value }));
                    setKeyEdited((k) => ({ ...k, openai: true }));
                  }}
                  placeholder="sk-..."
                  className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] font-mono pr-10 outline-none focus:border-border"
                />
                <button
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
                >
                  {showOpenaiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Agent */}
        <div className="mb-8">
          <SectionHeader title="Agent" description="Model and behavior settings" />
          <div className="space-y-3">
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Default Model</label>
              <select
                value={config.agent.default_model}
                onChange={(e) => setConfig({ ...config, agent: { ...config.agent, default_model: e.target.value } })}
                className="w-full bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border cursor-pointer appearance-none"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                {/* Show current if not in list */}
                {!MODEL_OPTIONS.find((m) => m.value === config.agent.default_model) && (
                  <option value={config.agent.default_model}>{config.agent.default_model}</option>
                )}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground/60 mb-1 block">Max Turns</label>
              <input
                type="number"
                min={1}
                max={50}
                value={config.agent.max_turns}
                onChange={(e) => setConfig({ ...config, agent: { ...config.agent, max_turns: parseInt(e.target.value) || 10 } })}
                className="w-24 bg-foreground/[0.03] border border-border/50 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-border"
              />
            </div>
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
                    onChange={(v) => setConfig({ ...config, sources: { ...config.sources, [key]: v } })}
                  />
                </div>
              ))}
          </div>
        </div>

        {/* Daemon */}
        <div className="mb-8">
          <SectionHeader title="Daemon" description="Background sync settings" />
          <div>
            <label className="text-[12px] text-muted-foreground/60 mb-1 block">Sync Interval (minutes)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={config.daemon.sync_interval_minutes}
              onChange={(e) => setConfig({ ...config, daemon: { ...config.daemon, sync_interval_minutes: parseInt(e.target.value) || 5 } })}
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
      </motion.div>
    </div>
  );
}
