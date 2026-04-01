import { motion } from "motion/react";
import { Search, Globe } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { SOURCE_META, type Item, type SourceInfo, type DaemonInfo, getTitle, getSubtitle, timeAgo } from "@/lib/types";

export function SourcesPage({ items, loading, filter, setFilter, query, setQuery, counts, sources, daemon }: {
  items: Item[]; loading: boolean; filter: string | null; setFilter: (f: string | null) => void;
  query: string; setQuery: (q: string) => void; counts: Record<string, number>;
  sources: SourceInfo[]; daemon: DaemonInfo;
}) {
  const sortedSources = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-[680px] mx-auto px-8 py-10">
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
        <span className={`inline-block w-2 h-2 rounded-full ${daemon.status === "syncing" ? "bg-emerald-500 animate-pulse-dot" : daemon.status === "waiting" ? "bg-amber-400" : "bg-muted-foreground/30"}`} />
        <span className="text-[13px] text-muted-foreground/60">
          Daemon {daemon.status}
          {daemon.currentSource && ` · syncing ${SOURCE_META[daemon.currentSource]?.label || daemon.currentSource}`}
          {daemon.intervalMinutes && ` · every ${daemon.intervalMinutes < 1 ? `${daemon.intervalMinutes * 60}s` : `${daemon.intervalMinutes}m`}`}
        </span>
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
          {items.map((item) => {
            const meta = SOURCE_META[item.source] || { icon: Globe, label: item.source, color: "text-neutral-400", bg: "bg-neutral-500/8" };
            const Icon = meta.icon;
            const title = getTitle(item);
            const subtitle = getSubtitle(item);

            return (
              <StaggerItem key={item.id}>
                <motion.div
                  whileHover={{ x: 2 }}
                  transition={{ duration: 0.15 }}
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
                  </div>
                </motion.div>
              </StaggerItem>
            );
          })}
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
