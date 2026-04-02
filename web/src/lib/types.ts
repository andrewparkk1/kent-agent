import { Globe } from "lucide-react";
import {
  GmailIcon, ChromeIcon, GitHubIcon, SignalIcon, IMessageIcon,
  AppleNotesIcon, GranolaIcon, CalendarIcon, TasksIcon, DriveIcon,
} from "./icons";

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
  type: string;
  source: "default" | "user" | "suggested";
  enabled: boolean;
  is_archived: number;
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
  intervalSeconds: number;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
}

export type Page = "home" | "workflows" | "workflow-detail" | "activity" | "chat" | "identity" | "sources" | "memories" | "settings";

// ─── Source metadata ────────────────────────────────────────────────────────

export const SOURCE_META: Record<string, { icon: any; label: string; color: string; bg: string }> = {
  gmail:         { icon: GmailIcon,      label: "Gmail",       color: "text-red-500/80",     bg: "bg-red-500/8" },
  gcal:          { icon: CalendarIcon,   label: "Calendar",    color: "text-blue-500/80",    bg: "bg-blue-500/8" },
  gtasks:        { icon: TasksIcon,      label: "Tasks",       color: "text-violet-500/80",  bg: "bg-violet-500/8" },
  gdrive:        { icon: DriveIcon,      label: "Drive",       color: "text-amber-500/80",   bg: "bg-amber-500/8" },
  github:        { icon: GitHubIcon,     label: "GitHub",      color: "text-neutral-500/80", bg: "bg-neutral-500/8" },
  chrome:        { icon: ChromeIcon,     label: "Chrome",      color: "text-amber-600/80",   bg: "bg-amber-600/8" },
  "apple-notes": { icon: AppleNotesIcon, label: "Notes",       color: "text-yellow-600/80",  bg: "bg-yellow-500/8" },
  apple_notes:   { icon: AppleNotesIcon, label: "Notes",       color: "text-yellow-600/80",  bg: "bg-yellow-500/8" },
  imessage:      { icon: IMessageIcon,   label: "iMessage",    color: "text-emerald-500/80", bg: "bg-emerald-500/8" },
  signal:        { icon: SignalIcon,     label: "Signal",      color: "text-blue-500/80",    bg: "bg-blue-500/8" },
  granola:       { icon: GranolaIcon,    label: "Granola",     color: "text-purple-500/80",  bg: "bg-purple-500/8" },
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
  // Calendar/tasks — show formatted date
  if (m.when || m.start || m.dtstart || m.due) {
    const raw = m.when || m.start || m.dtstart || m.due;
    try {
      const d = new Date(raw);
      const parts = [d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })];
      if (!/T00:00/.test(raw) && raw.includes("T")) parts.push("·", d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      if (m.location) parts.push("·", m.location);
      return parts.join(" ");
    } catch {}
  }
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
  const days: Record<string, string> = { "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat" };

  // Handle interval-based crons like */30 * * * * or 0 */2 * * *
  if (hour === "*" || hour?.startsWith("*/")) {
    if (min?.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
    if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
    return "Every minute";
  }

  const h = parseInt(hour!);
  if (isNaN(h)) return cron;
  const time = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${min!.padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  if (dow === "*") return `Daily at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  const dowParts = dow!.split(",").map((d) => days[d] || d).join(", ");
  return `${dowParts} at ${time}`;
}
