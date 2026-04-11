import {
  GmailIcon, ChromeIcon, GitHubIcon, SignalIcon, IMessageIcon,
  AppleNotesIcon, GranolaIcon, CalendarIcon, TasksIcon, DriveIcon,
  AiCodingIcon, SafariIcon, RemindersIcon, ContactsIcon, ObsidianIcon,
  WhatsAppIcon, SlackIcon, NotionIcon, SpotifyIcon, AppleMusicIcon,
  HealthIcon, ScreenTimeIcon, RecentFilesIcon, AppleCalendarIcon,
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
  lastError: string | null;
  lastSyncItemCount: number | null;
}

export interface DaemonInfo {
  status: string;
  currentSource: string | null;
  intervalSeconds: number;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  lastSyncErrors: Record<string, string> | null;
}

export type Page = "home" | "workflows" | "workflow-detail" | "activity" | "chat" | "identity" | "sources" | "memories" | "memory-detail" | "settings" | "setup";

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
  ai_coding:     { icon: AiCodingIcon,  label: "Claude & Codex", color: "text-orange-500/80",  bg: "bg-orange-500/8" },
  safari:        { icon: SafariIcon,     label: "Safari",        color: "text-blue-500/80",     bg: "bg-blue-500/8" },
  "apple-reminders": { icon: RemindersIcon, label: "Reminders",  color: "text-orange-500/80",   bg: "bg-orange-500/8" },
  apple_reminders:   { icon: RemindersIcon, label: "Reminders",  color: "text-orange-500/80",   bg: "bg-orange-500/8" },
  contacts:      { icon: ContactsIcon,   label: "Contacts",      color: "text-neutral-500/80",  bg: "bg-neutral-500/8" },
  obsidian:      { icon: ObsidianIcon,   label: "Obsidian",      color: "text-violet-500/80",   bg: "bg-violet-500/8" },
  whatsapp:      { icon: WhatsAppIcon,   label: "WhatsApp",      color: "text-emerald-500/80",  bg: "bg-emerald-500/8" },
  slack:         { icon: SlackIcon,      label: "Slack",         color: "text-pink-500/80",     bg: "bg-pink-500/8" },
  notion:        { icon: NotionIcon,     label: "Notion",        color: "text-neutral-600/80",  bg: "bg-neutral-500/8" },
  spotify:       { icon: SpotifyIcon,    label: "Spotify",       color: "text-green-500/80",    bg: "bg-green-500/8" },
  "apple-music": { icon: AppleMusicIcon, label: "Apple Music",   color: "text-red-500/80",      bg: "bg-red-500/8" },
  apple_music:   { icon: AppleMusicIcon, label: "Apple Music",   color: "text-red-500/80",      bg: "bg-red-500/8" },
  "apple-health": { icon: HealthIcon,    label: "Apple Health",  color: "text-red-400/80",      bg: "bg-red-400/8" },
  apple_health:  { icon: HealthIcon,     label: "Apple Health",  color: "text-red-400/80",      bg: "bg-red-400/8" },
  "screen-time": { icon: ScreenTimeIcon, label: "Screen Time",   color: "text-indigo-500/80",   bg: "bg-indigo-500/8" },
  screen_time:   { icon: ScreenTimeIcon, label: "Screen Time",   color: "text-indigo-500/80",   bg: "bg-indigo-500/8" },
  "recent-files": { icon: RecentFilesIcon, label: "Recent Files", color: "text-cyan-500/80",    bg: "bg-cyan-500/8" },
  recent_files:  { icon: RecentFilesIcon, label: "Recent Files",  color: "text-cyan-500/80",    bg: "bg-cyan-500/8" },
  "apple-calendar": { icon: AppleCalendarIcon, label: "Calendar (Apple)", color: "text-red-500/80", bg: "bg-red-500/8" },
  apple_calendar:   { icon: AppleCalendarIcon, label: "Calendar (Apple)", color: "text-red-500/80", bg: "bg-red-500/8" },
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

/** Compute next run time from a cron expression (simple subset: min hour * * dow). */
export function nextCronRun(cron: string | null): Date | null {
  if (!cron) return null;
  const parts = cron.split(" ");
  if (parts.length !== 5) return null;
  const [minStr, hourStr, , , dow] = parts;

  const now = new Date();

  // Interval-based: */N * * * * or 0 */N * * *
  if (hourStr === "*" || hourStr?.startsWith("*/")) {
    if (minStr?.startsWith("*/")) {
      const interval = parseInt(minStr.slice(2));
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setMinutes(Math.ceil((now.getMinutes() + 1) / interval) * interval);
      if (next <= now) next.setMinutes(next.getMinutes() + interval);
      return next;
    }
    if (hourStr.startsWith("*/")) {
      const interval = parseInt(hourStr.slice(2));
      const next = new Date(now);
      next.setMinutes(parseInt(minStr!), 0, 0);
      next.setHours(Math.ceil((now.getHours() + 1) / interval) * interval);
      if (next <= now) next.setHours(next.getHours() + interval);
      return next;
    }
    return null;
  }

  const targetMin = parseInt(minStr!);
  const targetHour = parseInt(hourStr!);
  if (isNaN(targetMin) || isNaN(targetHour)) return null;

  // Parse allowed days of week
  let allowedDays: number[] | null = null;
  if (dow && dow !== "*") {
    if (dow.includes("-")) {
      const [start, end] = dow.split("-").map(Number);
      allowedDays = [];
      for (let d = start!; d <= end!; d++) allowedDays.push(d);
    } else {
      allowedDays = dow.split(",").map(Number);
    }
  }

  // Find next matching time
  const next = new Date(now);
  next.setHours(targetHour, targetMin, 0, 0);

  for (let i = 0; i < 8; i++) {
    if (next > now && (!allowedDays || allowedDays.includes(next.getDay()))) {
      return next;
    }
    next.setDate(next.getDate() + 1);
    next.setHours(targetHour, targetMin, 0, 0);
  }
  return null;
}

/** Format a countdown like "2d 5h" or "45m 30s". */
export function formatCountdown(target: Date): string {
  const diff = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
