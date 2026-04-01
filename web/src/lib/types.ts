import {
  Mail, Calendar, ListTodo, GitBranch, Globe, StickyNote,
  MessageCircle, Signal, Mic, HardDrive,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Item {
  id: number;
  source: string;
  content: string;
  metadata: Record<string, any>;
  created_at: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cron_schedule: string | null;
  enabled: boolean;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
  runCount: number;
  lastRunAt: number | null;
}

export interface SourceInfo {
  id: string;
  enabled: boolean;
  itemCount: number;
  syncing: boolean;
}

export interface DaemonInfo {
  status: string;
  currentSource: string | null;
  intervalMinutes: number;
}

export type Page = "home" | "workflows" | "activity" | "identity" | "sources" | "memories" | "settings";

// ─── Source metadata ────────────────────────────────────────────────────────

export const SOURCE_META: Record<string, { icon: typeof Mail; label: string; color: string; bg: string }> = {
  gmail:         { icon: Mail,          label: "Gmail",       color: "text-red-500/80",     bg: "bg-red-500/8" },
  gcal:          { icon: Calendar,      label: "Calendar",    color: "text-blue-500/80",    bg: "bg-blue-500/8" },
  gtasks:        { icon: ListTodo,      label: "Tasks",       color: "text-violet-500/80",  bg: "bg-violet-500/8" },
  gdrive:        { icon: HardDrive,     label: "Drive",       color: "text-amber-500/80",   bg: "bg-amber-500/8" },
  github:        { icon: GitBranch,     label: "GitHub",      color: "text-neutral-500/80", bg: "bg-neutral-500/8" },
  chrome:        { icon: Globe,         label: "Chrome",      color: "text-amber-600/80",   bg: "bg-amber-600/8" },
  "apple-notes": { icon: StickyNote,    label: "Notes",       color: "text-orange-500/80",  bg: "bg-orange-500/8" },
  apple_notes:   { icon: StickyNote,    label: "Notes",       color: "text-orange-500/80",  bg: "bg-orange-500/8" },
  imessage:      { icon: MessageCircle, label: "iMessage",    color: "text-emerald-500/80", bg: "bg-emerald-500/8" },
  signal:        { icon: Signal,        label: "Signal",      color: "text-blue-500/80",    bg: "bg-blue-500/8" },
  granola:       { icon: Mic,           label: "Granola",     color: "text-purple-500/80",  bg: "bg-purple-500/8" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function getTitle(item: Item): string {
  return item.metadata.subject || item.metadata.summary || item.metadata.title || item.metadata.name || item.content.split("\n")[0]?.slice(0, 120) || "(untitled)";
}

export function getSubtitle(item: Item): string | null {
  const m = item.metadata;
  if (m.from) return m.from.replace(/<.*>/, "").trim();
  if (m.location) return m.location;
  if (m.repo) return m.repo;
  if (m.folder && m.folder !== "Notes") return m.folder;
  if (m.url) { try { return new URL(m.url).hostname; } catch { return null; } }
  return null;
}

export function cronToHuman(cron: string | null): string {
  if (!cron) return "Manual trigger";
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  const h = parseInt(hour);
  const time = `${h > 12 ? h - 12 : h}:${min.padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  const days: Record<string, string> = { "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat" };
  if (dow === "*") return `Daily at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  return `${days[dow] || dow} at ${time}`;
}
