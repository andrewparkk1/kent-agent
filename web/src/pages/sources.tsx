import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Globe, ChevronDown, RefreshCw, Calendar, Loader2 } from "lucide-react";
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
  return `Running · every ${daemon.intervalMinutes}m`;
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
    <div className="relative flex items-center gap-0.5">
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
            className="absolute right-0 top-full mt-1 z-20 bg-card border border-border/60 rounded-lg p-3 shadow-lg min-w-[200px]"
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
            <div className="mx-3 mb-2 px-4 py-3 rounded-lg bg-foreground/[0.02] border border-border/30">
              {/* Metadata chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {item.metadata.folder && (
                  <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">{item.metadata.folder}</span>
                )}
                {item.metadata.from && (
                  <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">{item.metadata.from.replace(/<.*>/, "").trim()}</span>
                )}
                {item.metadata.to && (
                  <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">To: {item.metadata.to.replace(/<.*>/, "").trim()}</span>
                )}
                {item.metadata.repo && (
                  <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">{item.metadata.repo}</span>
                )}
                {item.metadata.labels?.length > 0 && item.metadata.labels.map((l: string) => (
                  <span key={l} className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/60">{l}</span>
                ))}
                {item.metadata.url && (
                  <a href={item.metadata.url} target="_blank" rel="noopener" className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-blue-500/70 hover:text-blue-500 truncate max-w-[300px]">
                    {(() => { try { return new URL(item.metadata.url).hostname; } catch { return item.metadata.url; } })()}
                  </a>
                )}
                {item.metadata.wordCount && (
                  <span className="text-[10px] px-1.5 py-[2px] rounded bg-foreground/[0.05] text-muted-foreground/40">{item.metadata.wordCount} words</span>
                )}
              </div>
              {/* Content */}
              <div className="prose-chat text-[13px] leading-relaxed max-h-[400px] overflow-y-auto">
                <Markdown>{item.content}</Markdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SourcesPage({ items, loading, filter, setFilter, query, setQuery, counts, sources, daemon, onRefresh }: {
  items: Item[]; loading: boolean; filter: string | null; setFilter: (f: string | null) => void;
  query: string; setQuery: (q: string) => void; counts: Record<string, number>;
  sources: SourceInfo[]; daemon: DaemonInfo; onRefresh: () => void;
}) {
  const sortedSources = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const now = useTick(1000);

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        Sources
      </motion.h1>
      <motion.div
        className="flex items-center gap-2 mb-7"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${daemon.status === "syncing" ? "bg-emerald-500 animate-pulse-dot" : daemon.status === "stopped" ? "bg-muted-foreground/30" : "bg-emerald-500"}`} />
        <span className="text-[13px] text-muted-foreground/60 tabular-nums">
          {daemonStatusText(daemon, now)}
        </span>
      </motion.div>

      {/* Source cards with sync buttons */}
      <motion.div
        className="grid grid-cols-2 gap-2 mb-6"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.3 }}
      >
        {sources.filter((s) => s.enabled).map((s) => {
          const meta = SOURCE_META[s.id] || { icon: Globe, label: s.id, color: "text-neutral-400", bg: "bg-neutral-500/8" };
          const Icon = meta.icon;
          return (
            <div
              key={s.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border/40 bg-card/50"
            >
              <div className={`shrink-0 w-7 h-7 rounded-md ${meta.bg} flex items-center justify-center`}>
                <Icon size={14} className={meta.color} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-medium text-foreground block">{meta.label}</span>
                <span className="text-[11px] text-muted-foreground/50 font-mono">{s.itemCount} items</span>
              </div>
              <SyncButton sourceId={s.id} onSynced={onRefresh} />
            </div>
          );
        })}
      </motion.div>

      <motion.div
        className="relative mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.3 }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" size={14} />
        <input
          className="w-full pl-9 pr-3 h-9 text-[13px] bg-foreground/[0.03] border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:bg-card transition-all duration-200"
          placeholder="Search everything... ⌘K"
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
      )}
    </div>
  );
}
