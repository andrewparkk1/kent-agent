import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Brain, User, FolderOpen, Hash, CalendarDays, Heart, MapPin, Search } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { timeAgo } from "@/lib/types";

interface Memory {
  id: string;
  type: "person" | "project" | "topic" | "event" | "preference" | "place";
  title: string;
  body: string;
  sources: string[];
  aliases: string[];
  created_at: number;
  updated_at: number;
}

const TYPE_META: Record<string, { icon: typeof Brain; label: string; color: string; bg: string }> = {
  person:     { icon: User,         label: "Person",     color: "text-blue-500/80",    bg: "bg-blue-500/8" },
  project:    { icon: FolderOpen,   label: "Project",    color: "text-violet-500/80",  bg: "bg-violet-500/8" },
  topic:      { icon: Hash,         label: "Topic",      color: "text-amber-500/80",   bg: "bg-amber-500/8" },
  event:      { icon: CalendarDays, label: "Event",      color: "text-emerald-500/80", bg: "bg-emerald-500/8" },
  preference: { icon: Heart,        label: "Preference", color: "text-red-500/80",     bg: "bg-red-500/8" },
  place:      { icon: MapPin,       label: "Place",      color: "text-orange-500/80",  bg: "bg-orange-500/8" },
};

export function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchMemories = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (filter) params.set("type", filter);
      const res = await fetch(`/api/memories?${params}`);
      const data = await res.json();
      setMemories(data.memories);
    } catch {}
    setLoading(false);
  }, [query, filter]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const types = [...new Set(memories.map((m) => m.type))];
  const filtered = filter ? memories.filter((m) => m.type === filter) : memories;

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        Memories
      </motion.h1>
      <motion.p
        className="text-[13px] text-muted-foreground/60 mb-7"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        Knowledge base of people, projects, and topics Kent has learned.
      </motion.p>

      <motion.div
        className="relative mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.3 }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" size={14} />
        <input
          className="w-full pl-9 pr-3 h-9 text-[13px] bg-foreground/[0.03] border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:bg-card transition-all duration-200"
          placeholder="Search memories..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </motion.div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg animate-shimmer" />)}
        </div>
      ) : memories.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-16 text-center"
        >
          <Brain size={24} className="mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-[14px] text-muted-foreground mb-1">No memories yet</p>
          <p className="text-[12px] text-muted-foreground/50">Kent will build memories as it learns about people, projects, and topics from your data</p>
        </motion.div>
      ) : (
        <>
          {types.length > 1 && (
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
              {types.map((type) => {
                const meta = TYPE_META[type] || { icon: Brain, label: type, color: "text-neutral-400", bg: "bg-neutral-500/8" };
                return (
                  <button
                    key={type}
                    onClick={() => setFilter(filter === type ? null : type)}
                    className={`shrink-0 text-[12px] px-2.5 py-[5px] rounded-full transition-all duration-200 cursor-pointer ${
                      filter === type ? "bg-foreground text-background font-medium" : "bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07]"
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </motion.div>
          )}

          <Stagger className="flex flex-col gap-1">
            {filtered.map((memory) => {
              const meta = TYPE_META[memory.type] || { icon: Brain, label: memory.type, color: "text-neutral-400", bg: "bg-neutral-500/8" };
              const Icon = meta.icon;
              return (
                <StaggerItem key={memory.id}>
                  <motion.div
                    whileHover={{ x: 2 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                  >
                    <div className={`shrink-0 w-7 h-7 rounded-md ${meta.bg} flex items-center justify-center mt-0.5`}>
                      <Icon size={14} className={meta.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] text-foreground leading-snug">{memory.title}</span>
                      {memory.body && (
                        <span className="text-[12px] text-muted-foreground/50 line-clamp-2 block mt-0.5 leading-relaxed whitespace-pre-line">{memory.body}</span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-medium px-1.5 py-[2px] rounded bg-foreground/[0.04] text-muted-foreground/60">{meta.label}</span>
                      <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">{timeAgo(memory.updated_at)}</span>
                    </div>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </Stagger>

        </>
      )}
    </div>
  );
}
