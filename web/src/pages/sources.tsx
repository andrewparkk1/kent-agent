import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Globe, ChevronDown, ChevronRight, RefreshCw, Calendar, Loader2, Settings2, X, MessageCircle, Users, Download, Bookmark, History, SearchIcon, Terminal } from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import { Stagger, StaggerItem } from "@/components/stagger";
import { SOURCE_META, type Item, type SourceInfo, type DaemonInfo, getTitle, getSubtitle, timeAgo } from "@/lib/types";

function daemonStatusText(daemon: DaemonInfo, now: number): string {
  if (daemon.status === "stopped") return "Daemon stopped";
  if (daemon.status === "syncing") {
    const label = daemon.currentSource ? SOURCE_META[daemon.currentSource]?.label || daemon.currentSource : null;
    return label ? `Syncing ${label}...` : "Syncing...";
  }
  // running/waiting — show time until next sync
  if (daemon.nextSyncAt) {
    const remaining = daemon.nextSyncAt - now;
    if (remaining <= 0) return "Syncing soon...";
    const sec = Math.ceil(remaining / 1000);
    if (sec < 60) return `Next sync in ${sec}s`;
    return `Next sync in ${Math.ceil(sec / 60)}m`;
  }
  return `Running · every ${daemon.intervalSeconds}s`;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SyncButton({ sourceId, onSynced }: { sourceId: string; onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sinceDate, setSinceDate] = useState("");
  const meta = SOURCE_META[sourceId];
  const label = meta?.label || sourceId;

  const doSync = async (since?: number) => {
    setSyncing(true);
    setShowDatePicker(false);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceId, since }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`${label} sync failed`, { description: data.error });
      } else if (data.itemCount > 0) {
        toast.success(`${label}`, { description: `Synced ${data.itemCount} items` });
        onSynced();
      } else {
        toast.info(`${label}`, { description: "No new items found" });
      }
    } catch (e) {
      toast.error(`${label} sync failed`, { description: String(e) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="relative z-30 flex items-center gap-0.5">
      <button
        onClick={() => doSync()}
        disabled={syncing}
        className="p-1.5 rounded-md hover:bg-foreground/[0.06] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer disabled:opacity-30"
        title={`Sync ${label}`}
      >
        {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      </button>
      <button
        onClick={() => setShowDatePicker(!showDatePicker)}
        disabled={syncing}
        className="p-1.5 rounded-md hover:bg-foreground/[0.06] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer disabled:opacity-30"
        title="Sync from date..."
      >
        <Calendar size={13} />
      </button>

      <AnimatePresence>
        {showDatePicker && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-50 border border-border rounded-lg p-3 shadow-xl ring-1 ring-black/5 min-w-[200px]"
            style={{ backgroundColor: "hsl(40 24% 97%)" }}
          >
            <p className="text-[11px] text-muted-foreground/60 mb-2">Sync {label} from:</p>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              className="w-full h-8 px-2 text-[12px] bg-foreground/[0.03] border border-border/50 rounded-md outline-none focus:border-foreground/15 transition-colors"
            />
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={() => {
                  if (!sinceDate) return;
                  const ts = Math.floor(new Date(sinceDate).getTime() / 1000);
                  doSync(ts);
                }}
                disabled={!sinceDate}
                className="flex-1 h-7 text-[11px] font-medium bg-foreground text-background rounded-md disabled:opacity-30 cursor-pointer"
              >
                Sync
              </button>
              <button
                onClick={() => setShowDatePicker(false)}
                className="h-7 px-2.5 text-[11px] text-muted-foreground border border-border/50 rounded-md hover:bg-foreground/[0.04] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[12px] leading-relaxed">
      <span className="shrink-0 text-muted-foreground/40 w-16 text-right">{label}</span>
      <span className="text-foreground/80 min-w-0">{value}</span>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">{children}</span>;
}

function formatDateTime(raw: string): string {
  try {
    const d = new Date(raw);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
      " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch { return raw; }
}

/** Body text that isn't markdown — render \n as line breaks */
function PlainBody({ text }: { text: string }) {
  // Strip the structured prefix lines (Event:, When:, From:, etc.) since we show those as MetaFields
  const lines = text.split("\n").filter((l) => !/^(Event|When|Where|From|To|Subject|Task|Due|Notes|Modified|Owner|Link|Type):/.test(l.trim()));
  const body = lines.join("\n").trim();
  if (!body) return null;
  return (
    <div className="text-[12px] text-foreground/70 leading-relaxed whitespace-pre-wrap">{body}</div>
  );
}

/** Speaker color assignments for transcript view */
const SPEAKER_COLORS = [
  { bg: "bg-blue-500", text: "text-white", label: "text-blue-500/70" },
  { bg: "bg-emerald-500", text: "text-white", label: "text-emerald-500/70" },
  { bg: "bg-violet-500", text: "text-white", label: "text-violet-500/70" },
  { bg: "bg-amber-500", text: "text-white", label: "text-amber-500/70" },
  { bg: "bg-rose-500", text: "text-white", label: "text-rose-500/70" },
];

/** Parse transcript markdown into speaker segments */
function parseTranscript(text: string): { speaker: string; text: string }[] {
  const segments: { speaker: string; text: string }[] = [];
  // Match **Speaker X:** pattern
  const parts = text.split(/\n?\*\*Speaker ([A-Z]):\*\*\s*/);
  // parts[0] is before first speaker, then alternating: speaker letter, text
  for (let i = 1; i < parts.length; i += 2) {
    const speaker = `Speaker ${parts[i]}`;
    const content = (parts[i + 1] || "").trim();
    if (content) segments.push({ speaker, text: content });
  }
  // If no speaker pattern found, return empty (fall back to plain rendering)
  return segments;
}

function TranscriptView({ text }: { text: string }) {
  const segments = parseTranscript(text);
  if (segments.length === 0) return null;

  const speakerMap = new Map<string, number>();
  segments.forEach((s) => {
    if (!speakerMap.has(s.speaker)) speakerMap.set(s.speaker, speakerMap.size);
  });

  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        const colorIdx = speakerMap.get(seg.speaker)! % SPEAKER_COLORS.length;
        const color = SPEAKER_COLORS[colorIdx];
        const isLeft = colorIdx % 2 === 1;
        return (
          <div key={i} className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
            <div className="max-w-[80%]">
              <div className={`text-[10px] font-medium mb-0.5 ${color.label}`}>{seg.speaker}</div>
              <div className={`px-3 py-1.5 rounded-2xl text-[12px] leading-relaxed ${
                isLeft
                  ? "bg-foreground/[0.06] text-foreground/80 rounded-bl-md"
                  : `${color.bg} ${color.text} rounded-br-md`
              }`}>
                {seg.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ItemDetail({ item }: { item: Item }) {
  const m = item.metadata;

  // Structured metadata fields
  const fields: { label: string; value: string }[] = [];
  if (m.when || m.start || m.dtstart) fields.push({ label: "When", value: formatDateTime(m.when || m.start || m.dtstart) });
  if (m.due) fields.push({ label: "Due", value: formatDateTime(m.due) });
  if (m.location) fields.push({ label: "Where", value: m.location });
  if (m.from) fields.push({ label: "From", value: m.from.replace(/<.*>/, "").trim() });
  if (m.to) fields.push({ label: "To", value: m.to.replace(/<.*>/, "").trim() });
  if (m.repo) fields.push({ label: "Repo", value: m.repo });
  if (m.folder && m.folder !== "Notes") fields.push({ label: "Folder", value: m.folder });

  // Chips for tags/labels
  const chips: string[] = [];
  if (m.labels?.length > 0) chips.push(...m.labels);

  // Description or body content
  const description = m.description || m.notes;

  // For content-heavy sources (notes, chrome, messages), show the full content
  const isContentSource = ["apple-notes", "apple_notes", "chrome", "imessage", "signal", "granola", "ai_coding"].includes(item.source);

  // For Granola: split content into summary and transcript sections
  const isGranola = item.source === "granola";
  let granolaBody = "";
  let granolaTranscript = "";
  if (isGranola) {
    const transcriptIdx = item.content.indexOf("## Transcript\n");
    if (transcriptIdx >= 0) {
      granolaBody = item.content.slice(0, transcriptIdx).trim();
      granolaTranscript = item.content.slice(transcriptIdx + "## Transcript\n".length).trim();
    } else {
      granolaBody = item.content;
    }
  }

  return (
    <div className="mx-3 mb-2 px-4 py-3 rounded-lg bg-foreground/[0.02] border border-border/30 space-y-3">
      {/* Structured fields */}
      {fields.length > 0 && (
        <div className="space-y-1.5">
          {fields.map((f) => <MetaField key={f.label} label={f.label} value={f.value} />)}
        </div>
      )}

      {/* Chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => <MetaChip key={c}>{c}</MetaChip>)}
        </div>
      )}

      {/* Description */}
      {description && (
        <div className="text-[12px] text-foreground/60 leading-relaxed whitespace-pre-wrap border-t border-border/20 pt-2.5">{description}</div>
      )}

      {/* Granola: summary + chat-style transcript */}
      {isGranola && granolaBody && (
        <div className="max-h-[300px] overflow-y-auto">
          <div className="prose-chat text-[13px] leading-relaxed">
            <Markdown>{granolaBody}</Markdown>
          </div>
        </div>
      )}
      {isGranola && granolaTranscript && (
        <div className="border-t border-border/20 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/40 mb-2">Transcript</div>
          <div className="max-h-[400px] overflow-y-auto">
            {parseTranscript(granolaTranscript).length > 0 ? (
              <TranscriptView text={granolaTranscript} />
            ) : (
              <div className="text-[12px] text-foreground/70 leading-relaxed whitespace-pre-wrap">{granolaTranscript}</div>
            )}
          </div>
        </div>
      )}

      {/* Full content for other content-heavy sources */}
      {isContentSource && !isGranola && (
        <div className="max-h-[400px] overflow-y-auto">
          <div className="prose-chat text-[13px] leading-relaxed">
            <Markdown>{item.content}</Markdown>
          </div>
        </div>
      )}

      {/* For non-content sources without description, show plain body */}
      {!isContentSource && !description && (
        <PlainBody text={item.content} />
      )}

      {/* URL link */}
      {m.url && (
        <a href={m.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] text-blue-500/70 hover:text-blue-500 transition-colors">
          {(() => { try { return new URL(m.url).hostname; } catch { return "Open link"; } })()}
          <span className="text-[9px]">↗</span>
        </a>
      )}

      {/* Word count */}
      {m.wordCount && (
        <span className="block text-[10px] text-muted-foreground/30 font-mono">{m.wordCount} words</span>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const meta = SOURCE_META[item.source] || { icon: Globe, label: item.source, color: "text-neutral-400", bg: "bg-neutral-500/8" };
  const Icon = meta.icon;
  const title = getTitle(item);
  const subtitle = getSubtitle(item);

  return (
    <div>
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 min-w-0 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-7 h-7 rounded-md ${meta.bg} flex items-center justify-center`}>
          <Icon size={14} className={meta.color} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] text-foreground truncate block leading-snug">{title}</span>
          {subtitle && <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">{subtitle}</span>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] font-medium px-1.5 py-[2px] rounded bg-foreground/[0.04] text-muted-foreground/60">{meta.label}</span>
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(item.created_at)}</span>
          <ChevronDown size={12} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <ItemDetail item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Conversation grouped view (iMessage / Signal) ────────────────────────

interface Conversation {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessage: Item;
  messages: Item[];
}

function groupByConversation(items: Item[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const item of items) {
    const convId = item.metadata.conversationId || item.metadata.handle || "unknown";
    const existing = map.get(convId);
    if (existing) {
      existing.messages.push(item);
      if (item.created_at > existing.lastMessage.created_at) {
        existing.lastMessage = item;
      }
    } else {
      map.set(convId, {
        id: convId,
        name: item.metadata.conversationName || item.metadata.contactName || convId,
        isGroup: !!item.metadata.isGroup,
        lastMessage: item,
        messages: [item],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at);
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const [open, setOpen] = useState(false);
  const preview = conv.lastMessage.content.slice(0, 80);
  const isFromMe = conv.lastMessage.metadata.isFromMe;

  return (
    <div>
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 min-w-0 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${conv.isGroup ? "bg-blue-500/10" : "bg-emerald-500/10"}`}>
          {conv.isGroup ? <Users size={16} className="text-blue-500/70" /> : <MessageCircle size={16} className="text-emerald-500/70" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground truncate">{conv.name}</span>
            {conv.isGroup && <span className="text-[10px] px-1.5 py-[1px] rounded bg-blue-500/8 text-blue-500/60">group</span>}
          </div>
          <span className="text-[12px] text-muted-foreground/50 truncate block mt-0.5">
            {isFromMe ? "You: " : ""}{preview}
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/30 bg-foreground/[0.04] px-1.5 py-[2px] rounded tabular-nums">{conv.messages.length}</span>
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(conv.lastMessage.created_at)}</span>
          <ChevronRight size={12} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-2 px-4 py-3 rounded-lg bg-foreground/[0.02] border border-border/30 space-y-1 max-h-[400px] overflow-y-auto">
              {conv.messages
                .sort((a, b) => a.created_at - b.created_at)
                .slice(-30)
                .map((msg) => {
                  const fromMe = msg.metadata.isFromMe;
                  return (
                    <div key={msg.id} className={`flex ${fromMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] px-3 py-1.5 rounded-2xl text-[12px] leading-relaxed ${
                        fromMe
                          ? "bg-blue-500 text-white rounded-br-md"
                          : "bg-foreground/[0.06] text-foreground/80 rounded-bl-md"
                      }`}>
                        {!fromMe && conv.isGroup && (
                          <div className="text-[10px] font-medium mb-0.5 opacity-60">
                            {msg.metadata.senderName || msg.metadata.contactName || msg.metadata.handle}
                          </div>
                        )}
                        {msg.content}
                        <div className={`text-[9px] mt-0.5 ${fromMe ? "text-white/50" : "text-muted-foreground/30"}`}>
                          {new Date(msg.created_at * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConversationList({ items }: { items: Item[] }) {
  const conversations = groupByConversation(items);
  return (
    <Stagger className="flex flex-col gap-0.5">
      {conversations.map((conv) => (
        <StaggerItem key={conv.id}>
          <ConversationRow conv={conv} />
        </StaggerItem>
      ))}
      {conversations.length === 0 && (
        <StaggerItem>
          <div className="text-center text-muted-foreground/50 py-20 text-[13px]">No conversations found</div>
        </StaggerItem>
      )}
    </Stagger>
  );
}

// ─── AI Coding session-grouped view ───────────────────────────────────────

interface CodingSession {
  id: string;
  name: string;
  tool: "claude_code" | "codex" | string;
  lastItem: Item;
  items: Item[];
}

function groupByCodingSession(items: Item[]): CodingSession[] {
  const map = new Map<string, CodingSession>();
  for (const item of items) {
    const sessionId = item.metadata.sessionId || "unknown";
    const existing = map.get(sessionId);
    if (existing) {
      existing.items.push(item);
      if (item.created_at > existing.lastItem.created_at) {
        existing.lastItem = item;
      }
    } else {
      map.set(sessionId, {
        id: sessionId,
        name: item.metadata.sessionName || item.metadata.cwd?.split("/").pop() || sessionId.slice(0, 8),
        tool: item.metadata.tool || "unknown",
        lastItem: item,
        items: [item],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastItem.created_at - a.lastItem.created_at);
}

function CodingSessionRow({ session }: { session: CodingSession }) {
  const [open, setOpen] = useState(false);
  const queries = session.items.filter((i) => i.metadata.type === "prompt");
  const lastQuery = queries.sort((a, b) => b.created_at - a.created_at)[0];
  const preview = lastQuery
    ? lastQuery.content.replace(/^\[.*?\]\s*/, "").slice(0, 90)
    : session.lastItem.content.replace(/^\[.*?\]\s*/, "").slice(0, 90);
  const isClaudeCode = session.tool === "claude_code";

  return (
    <div>
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 min-w-0 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${isClaudeCode ? "bg-orange-500/10" : "bg-emerald-500/10"}`}>
          <Terminal size={16} className={isClaudeCode ? "text-orange-500/70" : "text-emerald-500/70"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground truncate">{session.name}</span>
            <span className={`text-[10px] px-1.5 py-[1px] rounded ${isClaudeCode ? "bg-orange-500/8 text-orange-500/60" : "bg-emerald-500/8 text-emerald-500/60"}`}>
              {isClaudeCode ? "Claude Code" : "Codex"}
            </span>
          </div>
          <span className="text-[12px] text-muted-foreground/50 truncate block mt-0.5">{preview}</span>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/30 bg-foreground/[0.04] px-1.5 py-[2px] rounded tabular-nums">{session.items.length}</span>
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(session.lastItem.created_at)}</span>
          <ChevronRight size={12} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-2 px-4 py-3 rounded-lg bg-foreground/[0.02] border border-border/30 space-y-1 max-h-[400px] overflow-y-auto">
              {session.items
                .sort((a, b) => a.created_at - b.created_at)
                .slice(-40)
                .map((msg) => {
                  const isQuery = msg.metadata.type === "prompt";
                  const text = msg.content.replace(/^\[.*?\]\s*/, "");
                  return (
                    <div key={msg.id} className={`flex ${isQuery ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-[12px] leading-relaxed ${
                        isQuery
                          ? "bg-orange-500 text-white rounded-br-md"
                          : "bg-foreground/[0.06] text-foreground/80 rounded-bl-md"
                      }`}>
                        <div className="whitespace-pre-wrap break-words">{text}</div>
                        <div className={`text-[9px] mt-0.5 ${isQuery ? "text-white/50" : "text-muted-foreground/30"}`}>
                          {new Date(msg.created_at * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CodingSessionList({ items }: { items: Item[] }) {
  const sessions = groupByCodingSession(items);
  return (
    <Stagger className="flex flex-col gap-0.5">
      {sessions.map((session) => (
        <StaggerItem key={session.id}>
          <CodingSessionRow session={session} />
        </StaggerItem>
      ))}
      {sessions.length === 0 && (
        <StaggerItem>
          <div className="text-center text-muted-foreground/50 py-20 text-[13px]">No coding sessions found</div>
        </StaggerItem>
      )}
    </Stagger>
  );
}

// ─── Chrome grouped view ───────────────────────────────────────────────────

const CHROME_TYPE_META: Record<string, { icon: any; label: string; color: string; bg: string }> = {
  history:  { icon: History,    label: "History",   color: "text-amber-600/70",  bg: "bg-amber-500/8" },
  search:   { icon: SearchIcon, label: "Search",    color: "text-blue-500/70",   bg: "bg-blue-500/8" },
  bookmark: { icon: Bookmark,   label: "Bookmark",  color: "text-violet-500/70", bg: "bg-violet-500/8" },
  download: { icon: Download,   label: "Download",  color: "text-emerald-500/70", bg: "bg-emerald-500/8" },
};

function ChromeItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const typeMeta = CHROME_TYPE_META[item.metadata.type] || CHROME_TYPE_META.history;
  const TypeIcon = typeMeta.icon;
  const title = item.metadata.title || item.metadata.term || item.metadata.name || item.content.split("\n")[0]?.slice(0, 120);
  const category = item.metadata.category;

  let subtitle = "";
  if (item.metadata.type === "search") {
    subtitle = item.metadata.url ? (() => { try { return new URL(item.metadata.url).hostname; } catch { return ""; } })() : "";
  } else if (item.metadata.type === "download") {
    const path = item.metadata.targetPath || "";
    subtitle = path.split("/").pop() || "";
    if (item.metadata.totalBytes) {
      const mb = (item.metadata.totalBytes / (1024 * 1024)).toFixed(1);
      subtitle += ` · ${mb} MB`;
    }
  } else if (item.metadata.url) {
    try { subtitle = new URL(item.metadata.url).hostname; } catch {}
  }

  return (
    <div>
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 min-w-0 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-7 h-7 rounded-md ${typeMeta.bg} flex items-center justify-center`}>
          <TypeIcon size={14} className={typeMeta.color} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] text-foreground truncate block leading-snug">{title}</span>
          {subtitle && <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">{subtitle}</span>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-[10px] font-medium px-1.5 py-[2px] rounded ${typeMeta.bg} ${typeMeta.color}`}>{typeMeta.label}</span>
          {category && category !== "other" && (
            <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.04] text-muted-foreground/50">{category}</span>
          )}
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(item.created_at)}</span>
          <ChevronDown size={12} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <ItemDetail item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChromeTypeAccordion({ type, items }: { type: string; items: Item[] }) {
  const [open, setOpen] = useState(type === "history");
  const meta = CHROME_TYPE_META[type] || CHROME_TYPE_META.history;
  const Icon = meta.icon;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-7 h-7 rounded-md ${meta.bg} flex items-center justify-center`}>
          <Icon size={14} className={meta.color} />
        </div>
        <span className="text-[13px] font-medium text-foreground">{meta.label}</span>
        <span className="text-[11px] font-mono text-muted-foreground/40">{items.length}</span>
        <div className="flex-1" />
        <ChevronDown size={13} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="ml-3 border-l border-border/30 pl-2">
              {items.map((item) => (
                <ChromeItemRow key={item.id} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChromeList({ items }: { items: Item[] }) {
  const grouped: Record<string, Item[]> = {};
  for (const item of items) {
    const type = item.metadata.type || "history";
    (grouped[type] ||= []).push(item);
  }
  const typeOrder = ["history", "search", "bookmark", "download"];
  const sortedTypes = typeOrder.filter((t) => grouped[t]?.length);
  // Add any types not in typeOrder
  for (const t of Object.keys(grouped)) {
    if (!sortedTypes.includes(t)) sortedTypes.push(t);
  }

  if (sortedTypes.length === 0) {
    return <div className="text-center text-muted-foreground/50 py-20 text-[13px]">No items found</div>;
  }

  return (
    <div className="flex flex-col">
      {sortedTypes.map((type) => (
        <ChromeTypeAccordion key={type} type={type} items={grouped[type]!} />
      ))}
    </div>
  );
}

// ─── Calendar grouped view (gcal events + gtasks tasks) ────────────────────

function CalendarItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const isTask = item.source === "gtasks";
  const title = item.metadata.summary || item.metadata.title || getTitle(item);
  const meta = SOURCE_META[item.source] || { icon: Globe, label: item.source, color: "text-neutral-400", bg: "bg-neutral-500/8" };

  let subtitle = "";
  if (isTask) {
    subtitle = item.metadata.listName || "";
    if (item.metadata.due) {
      try {
        const d = new Date(item.metadata.due);
        subtitle += (subtitle ? " · " : "") + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } catch {}
    }
    if (item.metadata.status === "completed") subtitle += " · Done";
  } else {
    const start = item.metadata.start || item.metadata.when || item.metadata.dtstart;
    if (start) {
      try {
        const d = new Date(start);
        subtitle = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        if (start.includes("T")) subtitle += " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      } catch {}
    }
    if (item.metadata.location) subtitle += (subtitle ? " · " : "") + item.metadata.location;
  }

  return (
    <div>
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 min-w-0 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
      >
        <div className={`shrink-0 w-7 h-7 rounded-md ${meta.bg} flex items-center justify-center`}>
          <meta.icon size={14} className={meta.color} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] text-foreground truncate block leading-snug">{title}</span>
          {subtitle && <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">{subtitle}</span>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-[10px] font-medium px-1.5 py-[2px] rounded ${isTask ? "bg-violet-500/8 text-violet-500/70" : "bg-blue-500/8 text-blue-500/70"}`}>
            {isTask ? "Task" : "Event"}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(item.created_at)}</span>
          <ChevronDown size={12} className={`text-muted-foreground/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <ItemDetail item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CalendarList({ items }: { items: Item[] }) {
  return (
    <Stagger className="flex flex-col gap-0.5">
      {items.map((item) => (
        <StaggerItem key={item.id}>
          <CalendarItemRow item={item} />
        </StaggerItem>
      ))}
      {items.length === 0 && (
        <StaggerItem>
          <div className="text-center text-muted-foreground/50 py-20 text-[13px]">No items found</div>
        </StaggerItem>
      )}
    </Stagger>
  );
}

// ─── Source-aware item list renderer ───────────────────────────────────────

const CONVERSATION_SOURCES = ["imessage", "signal"];
const CALENDAR_SOURCES = ["gcal", "gtasks"];
const AI_CODING_SOURCES = ["ai_coding"];

function SourceAwareList({ items, filter }: { items: Item[]; filter: string | null }) {
  if (filter && CONVERSATION_SOURCES.includes(filter)) {
    return <ConversationList items={items} />;
  }
  if (filter && AI_CODING_SOURCES.includes(filter)) {
    return <CodingSessionList items={items} />;
  }
  if (filter === "chrome") {
    return <ChromeList items={items} />;
  }
  if (filter && CALENDAR_SOURCES.includes(filter)) {
    return <CalendarList items={items} />;
  }
  // Default flat list
  return (
    <Stagger className="flex flex-col gap-1">
      {items.map((item) => (
        <StaggerItem key={item.id}>
          <ItemRow item={item} />
        </StaggerItem>
      ))}
      {items.length === 0 && (
        <StaggerItem>
          <div className="text-center text-muted-foreground/50 py-20 text-[13px]">No items found</div>
        </StaggerItem>
      )}
    </Stagger>
  );
}

function Pagination({ page, hasMore, totalPages, onPageChange }: { page: number; hasMore: boolean; totalPages?: number; onPageChange: (p: number) => void }) {
  if (page === 0 && !hasMore) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6 mb-2">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="text-[12px] px-3 py-1.5 rounded-lg bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
      >
        Previous
      </button>
      <span className="text-[11px] font-mono text-muted-foreground/50 tabular-nums">
        Page {page + 1}{totalPages ? ` of ${totalPages}` : ""}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasMore}
        className="text-[12px] px-3 py-1.5 rounded-lg bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
      >
        Next
      </button>
    </div>
  );
}

export function SourcesPage({ items, loading, filter, setFilter, query, setQuery, counts, sources, daemon, onRefresh, page, hasMore, totalPages, onPageChange }: {
  items: Item[]; loading: boolean; filter: string | null; setFilter: (f: string | null) => void;
  query: string; setQuery: (q: string) => void; counts: Record<string, number>;
  sources: SourceInfo[]; daemon: DaemonInfo; onRefresh: () => void;
  page: number; hasMore: boolean; totalPages?: number; onPageChange: (p: number) => void;
}) {
  const sortedSources = Object.entries(counts).sort((a, b) => {
    // ai_coding always last
    if (a[0] === "ai_coding") return 1;
    if (b[0] === "ai_coding") return -1;
    return b[1] - a[1];
  });
  const now = useTick(1000);

  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const enabledSources = sources.filter((s) => s.enabled);

  useEffect(() => {
    if (!syncPanelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setSyncPanelOpen(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [syncPanelOpen]);

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-7">
        <div>
          <motion.h1
            className="text-[32px] font-display tracking-tight mb-1"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            Sources
          </motion.h1>
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${daemon.status === "syncing" ? "bg-emerald-500 animate-pulse-dot" : daemon.status === "stopped" ? "bg-muted-foreground/30" : "bg-emerald-500"}`} />
            <span className="text-[13px] text-muted-foreground/60 tabular-nums">
              {daemonStatusText(daemon, now)}
            </span>
          </motion.div>
        </div>

        {/* Sync panel trigger */}
        <motion.div
          className="relative"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <button
            onClick={() => setSyncPanelOpen(!syncPanelOpen)}
            className="p-2 rounded-lg hover:bg-foreground/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
            title="Manage sources"
          >
            <Settings2 size={16} />
          </button>

          <AnimatePresence>
            {syncPanelOpen && (
              <>
                <div className="fixed inset-0 z-[998] bg-background/60 backdrop-blur-[2px]" onClick={() => setSyncPanelOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="fixed right-8 top-16 z-[999] border border-border rounded-xl shadow-2xl ring-1 ring-black/5 p-2 w-[280px]"
                  style={{ backgroundColor: "hsl(40 24% 97%)" }}
                >
                  <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">Sources</span>
                    <button onClick={() => setSyncPanelOpen(false)} className="p-0.5 rounded hover:bg-foreground/[0.05] text-muted-foreground/30 hover:text-muted-foreground cursor-pointer">
                      <X size={12} />
                    </button>
                  </div>
                  {enabledSources.map((s) => {
                    const meta = SOURCE_META[s.id] || { icon: Globe, label: s.id, color: "text-neutral-400", bg: "bg-neutral-500/8" };
                    const Icon = meta.icon;
                    return (
                      <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-foreground/[0.02]">
                        <div className={`shrink-0 w-5 h-5 rounded ${meta.bg} flex items-center justify-center`}>
                          <Icon size={11} className={meta.color} />
                        </div>
                        <span className="text-[12px] text-foreground flex-1">{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground/40 font-mono mr-1">{s.itemCount}</span>
                        <SyncButton sourceId={s.id} onSynced={onRefresh} />
                      </div>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <motion.div
        className="relative mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.3 }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" size={14} />
        <input
          className="w-full pl-9 pr-3 h-9 text-[13px] bg-foreground/[0.03] border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:bg-card transition-all duration-200"
          placeholder="Search everything..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </motion.div>

      <motion.div
        className="flex gap-1.5 mb-6 overflow-x-auto pb-1 no-scrollbar"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.14, duration: 0.3 }}
      >
        <button
          onClick={() => setFilter(null)}
          className={`shrink-0 text-[12px] px-2.5 py-[5px] rounded-full transition-all duration-200 cursor-pointer ${
            filter === null ? "bg-foreground text-background font-medium" : "bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07]"
          }`}
        >
          All
        </button>
        {sortedSources.map(([source, count]) => {
          const meta = SOURCE_META[source];
          const Icon = meta?.icon || Globe;
          return (
            <button
              key={source}
              onClick={() => setFilter(filter === source ? null : source)}
              className={`shrink-0 flex items-center gap-1.5 text-[12px] px-2.5 py-[5px] rounded-full transition-all duration-200 cursor-pointer ${
                filter === source ? "bg-foreground text-background font-medium" : "bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07]"
              }`}
            >
              <Icon size={11} />
              <span>{meta?.label || source}</span>
              <span className="opacity-40 font-mono text-[11px]">{count}</span>
            </button>
          );
        })}
      </motion.div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-lg animate-shimmer" />)}
        </div>
      ) : (
        <>
          <SourceAwareList items={items} filter={filter} />
          <Pagination page={page} hasMore={hasMore} totalPages={totalPages} onPageChange={onPageChange} />
        </>
      )}
    </div>
  );
}
