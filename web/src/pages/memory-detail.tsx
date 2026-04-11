import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, User, FolderOpen, Hash, CalendarDays, Heart, MapPin, Brain,
  Link2, ArrowRight, List,
} from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/lib/types";

interface Memory {
  id: string;
  type: "person" | "project" | "topic" | "event" | "preference" | "place";
  title: string;
  summary: string;
  body: string;
  sources: string[];
  aliases: string[];
  created_at: number;
  updated_at: number;
}

interface LinkedMemory {
  id: string;
  type: string;
  title: string;
  summary: string;
  link_label: string;
}

interface MemoryIndexEntry {
  id: string;
  type: string;
  title: string;
}

const TYPE_META: Record<string, { icon: typeof Brain; label: string; color: string; bg: string; accent: string }> = {
  person:     { icon: User,         label: "Person",     color: "text-blue-500/80",    bg: "bg-blue-500/8",    accent: "border-blue-500/20" },
  project:    { icon: FolderOpen,   label: "Project",    color: "text-violet-500/80",  bg: "bg-violet-500/8",  accent: "border-violet-500/20" },
  topic:      { icon: Hash,         label: "Topic",      color: "text-amber-500/80",   bg: "bg-amber-500/8",   accent: "border-amber-500/20" },
  event:      { icon: CalendarDays, label: "Event",      color: "text-emerald-500/80", bg: "bg-emerald-500/8", accent: "border-emerald-500/20" },
  preference: { icon: Heart,        label: "Preference", color: "text-red-500/80",     bg: "bg-red-500/8",     accent: "border-red-500/20" },
  place:      { icon: MapPin,       label: "Place",      color: "text-orange-500/80",  bg: "bg-orange-500/8",  accent: "border-orange-500/20" },
};

/** Extract ## headings from markdown body for a table of contents. */
function extractToc(body: string): { level: number; text: string; slug: string }[] {
  const headings: { level: number; text: string; slug: string }[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^(#{2,3})\s+(.+)/);
    if (match) {
      const text = match[2]!;
      const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      headings.push({ level: match[1]!.length, text, slug });
    }
  }
  return headings;
}

/**
 * Pre-process markdown body to convert [[Title]] wiki links into standard markdown links.
 * Resolves against the memory index to create clickable links.
 * Unresolved [[Title]] references are left as styled text.
 */
function resolveWikiLinks(body: string, index: Record<string, MemoryIndexEntry>): string {
  // Handle [[Title]] and [[Title|display text]] wiki link syntax
  let result = body.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split("|");
    const title = parts[0]!.trim();
    const display = parts.length > 1 ? parts[1]!.trim() : title;
    const entry = index[title.toLowerCase()];
    if (entry) {
      return `[${display}](#memory:${encodeURIComponent(entry.id)})`;
    }
    return `**⟦${display}⟧**`;
  });

  // Handle already-rendered ⟦Title⟧ and ⟦Title|alias⟧ from stored outputs (bold or plain)
  result = result.replace(/\*{0,2}⟦([^⟧]+)⟧\*{0,2}/g, (_match, inner: string) => {
    const parts = inner.split("|");
    const title = parts[0]!.trim();
    const display = parts.length > 1 ? parts[1]!.trim() : title;
    const entry = index[title.toLowerCase()];
    if (entry) {
      return `[${display}](#memory:${encodeURIComponent(entry.id)})`;
    }
    return `**⟦${display}⟧**`;
  });

  return result;
}

function LinkedMemoryCard({ memory, label, onNavigate }: { memory: LinkedMemory; label?: string; onNavigate: (id: string) => void }) {
  const meta = TYPE_META[memory.type] || { icon: Brain, label: memory.type, color: "text-neutral-400", bg: "bg-neutral-500/8", accent: "border-neutral-500/20" };
  const Icon = meta.icon;

  return (
    <motion.button
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
      onClick={() => onNavigate(memory.id)}
      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors text-left cursor-pointer"
    >
      <div className={`shrink-0 w-6 h-6 rounded-md ${meta.bg} flex items-center justify-center mt-0.5`}>
        <Icon size={12} className={meta.color} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[13px] text-foreground leading-snug block">{memory.title}</span>
        {label && (
          <span className="text-[11px] text-muted-foreground/50 block mt-0.5">{label}</span>
        )}
        {!label && memory.summary && (
          <span className="text-[11px] text-muted-foreground/40 line-clamp-1 block mt-0.5">{memory.summary}</span>
        )}
      </div>
    </motion.button>
  );
}

export function MemoryDetailPage({ memoryId, onBack, onNavigate }: {
  memoryId: string;
  onBack: () => void;
  onNavigate: (id: string) => void;
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [links, setLinks] = useState<{ outgoing: LinkedMemory[]; incoming: LinkedMemory[] }>({ outgoing: [], incoming: [] });
  const [memoryIndex, setMemoryIndex] = useState<Record<string, MemoryIndexEntry>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/memories/${memoryId}`)
      .then((res) => res.json())
      .then((data) => {
        setMemory(data.memory);
        setLinks(data.links);
        setMemoryIndex(data.memoryIndex ?? {});
      })
      .catch(() => toast.error("Failed to load memory"))
      .finally(() => setLoading(false));
  }, [memoryId]);

  const toc = useMemo(() => (memory ? extractToc(memory.body) : []), [memory?.body]);

  // Pre-process body to resolve [[Title]] links
  const processedBody = useMemo(() => {
    if (!memory?.body) return "";
    return resolveWikiLinks(memory.body, memoryIndex);
  }, [memory?.body, memoryIndex]);

  // Pre-process summary too (it might have [[Title]] refs)
  const processedSummary = useMemo(() => {
    if (!memory?.summary) return "";
    return resolveWikiLinks(memory.summary, memoryIndex);
  }, [memory?.summary, memoryIndex]);

  // Handle clicks on #memory: links
  const handleLinkClick = useCallback((e: React.MouseEvent, href: string) => {
    if (href.startsWith("#memory:")) {
      e.preventDefault();
      const id = decodeURIComponent(href.replace("#memory:", ""));
      onNavigate(id);
    }
  }, [onNavigate]);

  const hasLinks = links.outgoing.length > 0 || links.incoming.length > 0;
  const hasSidebar = toc.length > 1 || hasLinks;

  // Custom link renderer that handles #memory: links as inline wiki links
  const linkRenderer = useCallback(({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith("#memory:")) {
      const id = decodeURIComponent(href.replace("#memory:", ""));
      const entry = Object.values(memoryIndex).find((e) => e.id === id);
      return (
        <button
          onClick={(e) => handleLinkClick(e, href)}
          className="text-blue-500/80 hover:text-blue-500 underline underline-offset-2 decoration-blue-500/30 decoration-1 transition-colors cursor-pointer font-medium"
        >
          {children}
        </button>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  }, [memoryIndex, handleLinkClick]);

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto px-8 py-10">
        <div className="h-8 w-48 rounded-lg animate-shimmer mb-4" />
        <div className="h-4 w-96 rounded animate-shimmer mb-8" />
        <div className="h-64 rounded-lg animate-shimmer" />
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="max-w-[900px] mx-auto px-8 py-10">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer">
          <ArrowLeft size={14} /> Back to memories
        </button>
        <p className="text-[14px] text-muted-foreground">Memory not found.</p>
      </div>
    );
  }

  const meta = TYPE_META[memory.type] || { icon: Brain, label: memory.type, color: "text-neutral-400", bg: "bg-neutral-500/8", accent: "border-neutral-500/20" };
  const Icon = meta.icon;

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-10">
      {/* Back button */}
      <motion.button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <ArrowLeft size={14} /> Back to memories
      </motion.button>

      <div className="flex gap-8">
        {/* Main content */}
        <div className={`min-w-0 ${hasSidebar ? "flex-1" : "max-w-[900px]"}`}>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`shrink-0 w-10 h-10 rounded-lg ${meta.bg} flex items-center justify-center`}>
                <Icon size={20} className={meta.color} />
              </div>
              <div>
                <h1 className="text-[28px] font-display tracking-tight leading-tight">{memory.title}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] font-medium px-2 py-[2px] rounded-full bg-foreground/[0.05] text-muted-foreground/60">{meta.label}</span>
                  <span className="text-[11px] text-muted-foreground/40">Updated {timeAgo(memory.updated_at)}</span>
                  {memory.aliases.length > 0 && (
                    <span className="text-[11px] text-muted-foreground/30">
                      Also known as: {memory.aliases.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Summary — the Wikipedia opening paragraph, with inline wiki links */}
            {processedSummary && (
              <motion.div
                className={`mt-4 px-4 py-3 rounded-lg border ${meta.accent} bg-foreground/[0.015]`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <div className="text-[13px] text-foreground/80 leading-relaxed prose-brief">
                  <Markdown remarkPlugins={[remarkGfm]} components={{ a: linkRenderer }}>{processedSummary}</Markdown>
                </div>
              </motion.div>
            )}
          </motion.div>

          {/* Body — rich markdown content with inline [[wiki links]] */}
          {processedBody && (
            <motion.div
              className="prose-brief text-[13px] leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.3 }}
            >
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => {
                    const text = String(children);
                    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    return <h2 id={slug}>{children}</h2>;
                  },
                  h3: ({ children }) => {
                    const text = String(children);
                    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    return <h3 id={slug}>{children}</h3>;
                  },
                  a: linkRenderer,
                }}
              >
                {processedBody}
              </Markdown>
            </motion.div>
          )}

          {/* Sources */}
          {memory.sources.length > 0 && (
            <motion.div
              className="mt-8 pt-4 border-t border-border/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <h3 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">Sources</h3>
              <div className="flex flex-wrap gap-1.5">
                {memory.sources.map((s, i) => (
                  <span key={i} className="text-[11px] px-2 py-1 rounded-md bg-foreground/[0.03] text-muted-foreground/60">{s}</span>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Sidebar — Table of contents + Linked pages */}
        {hasSidebar && (
          <motion.aside
            className="w-[240px] shrink-0 hidden lg:block"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          >
            <div className="sticky top-10 space-y-6">
              {/* Table of Contents */}
              {toc.length > 1 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <List size={12} className="text-muted-foreground/40" />
                    <h3 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">Contents</h3>
                  </div>
                  <nav className="space-y-0.5">
                    {toc.map((h) => (
                      <a
                        key={h.slug}
                        href={`#${h.slug}`}
                        className={`block text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors py-0.5 ${h.level === 3 ? "pl-3" : ""}`}
                      >
                        {h.text}
                      </a>
                    ))}
                  </nav>
                </div>
              )}

              {/* Linked pages (outgoing) */}
              {links.outgoing.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <ArrowRight size={12} className="text-muted-foreground/40" />
                    <h3 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">See Also</h3>
                  </div>
                  <div className="space-y-0.5">
                    {links.outgoing.map((m) => (
                      <LinkedMemoryCard key={m.id} memory={m} label={m.link_label || undefined} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              )}

              {/* Backlinks (incoming) */}
              {links.incoming.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Link2 size={12} className="text-muted-foreground/40" />
                    <h3 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">Linked From</h3>
                  </div>
                  <div className="space-y-0.5">
                    {links.incoming.map((m) => (
                      <LinkedMemoryCard key={m.id} memory={m} label={m.link_label || undefined} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </div>
    </div>
  );
}
