import { useState, useEffect, useCallback } from "react";
import {
  Home,
  Zap,
  Activity,
  MessageCircle,
  Plus,
  Database,
  UserCircle,
  Settings,
  BookOpen,
  Brain,
  Mail,
  Calendar,
  ListTodo,
  GitBranch,
  Globe,
  StickyNote,
  Signal,
  Mic,
  HardDrive,
  Search,
  Play,
  ChevronRight,
  Pause,
  Trash2,
  X,
  ArrowUp,
} from "lucide-react";
import heroImg from "@/assets/hero.png";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Item {
  id: number;
  source: string;
  content: string;
  metadata: Record<string, any>;
  created_at: number;
}

// ─── Source metadata ────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { icon: typeof Mail; label: string; color: string }> = {
  gmail:         { icon: Mail,          label: "Gmail",       color: "text-red-400" },
  gcal:          { icon: Calendar,      label: "Calendar",    color: "text-blue-400" },
  gtasks:        { icon: ListTodo,      label: "Tasks",       color: "text-violet-400" },
  gdrive:        { icon: HardDrive,     label: "Drive",       color: "text-yellow-400" },
  github:        { icon: GitBranch,     label: "GitHub",      color: "text-gray-300" },
  chrome:        { icon: Globe,         label: "Chrome",      color: "text-amber-400" },
  "apple-notes": { icon: StickyNote,    label: "Notes",       color: "text-orange-400" },
  imessage:      { icon: MessageCircle, label: "iMessage",    color: "text-green-400" },
  signal:        { icon: Signal,        label: "Signal",      color: "text-blue-400" },
  granola:       { icon: Mic,           label: "Granola",     color: "text-purple-400" },
};

// ─── Workflows (static for now — maps to daemon scheduled sources + agent tasks) ─

interface Workflow {
  id: string;
  name: string;
  description: string;
  schedule: string;
  lastRun: string;
  enabled: boolean;
  type: "system" | "user";
}

const WORKFLOWS: Workflow[] = [
  {
    id: "evening-recap",
    name: "Evening recap",
    description: "End-of-day summary of what happened and what's next",
    schedule: "Daily at 7:00 PM",
    lastRun: "20h ago",
    enabled: true,
    type: "system",
  },
  {
    id: "morning-briefing",
    name: "Morning briefing",
    description: "Daily overview of your schedule, emails, and to-dos",
    schedule: "Daily at 8:00 AM",
    lastRun: "7h ago",
    enabled: true,
    type: "system",
  },
  {
    id: "workflow-suggester",
    name: "Workflow suggester",
    description: "Analyzes your activity and suggests new automations",
    schedule: "Daily at 9:30 AM",
    lastRun: "4m ago",
    enabled: true,
    type: "system",
  },
  {
    id: "memory-curator",
    name: "Memory curator",
    description: "Maintains a knowledge base of your people, projects, and topics",
    schedule: "Daily at 10:00 AM",
    lastRun: "5h ago",
    enabled: true,
    type: "system",
  },
  {
    id: "meeting-briefs",
    name: "Meeting Briefs",
    description: "Pre-meeting context from your emails, notes, and past conversations",
    schedule: "Monday, Tuesday, Wednesday, Thursday, Friday at 7:00 AM",
    lastRun: "8h ago",
    enabled: true,
    type: "user",
  },
  {
    id: "weekly-planner",
    name: "Sunday Trip Planner",
    description: "Plans upcoming trips with flight, hotel, and activity suggestions",
    schedule: "Thursdays at 5:00 PM",
    lastRun: "6d ago",
    enabled: true,
    type: "user",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getTitle(item: Item): string {
  return (
    item.metadata.subject ||
    item.metadata.summary ||
    item.metadata.title ||
    item.metadata.name ||
    item.content.split("\n")[0]?.slice(0, 120) ||
    "(untitled)"
  );
}

function getSubtitle(item: Item): string | null {
  const m = item.metadata;
  if (m.from) return m.from.replace(/<.*>/, "").trim();
  if (m.location) return m.location;
  if (m.repo) return m.repo;
  if (m.folder && m.folder !== "Notes") return m.folder;
  if (m.url) {
    try { return new URL(m.url).hostname; } catch { return null; }
  }
  return null;
}

// ─── Nav items ──────────────────────────────────────────────────────────────

type Page = "home" | "workflows" | "activity" | "identity" | "sources" | "memories" | "settings";

const NAV_ITEMS: { id: Page; icon: typeof Home; label: string; section?: string }[] = [
  { id: "home",      icon: Home,          label: "Home" },
  { id: "workflows",  icon: Zap,           label: "Workflows" },
  { id: "activity",   icon: Activity,      label: "Activity" },
  { id: "identity",   icon: UserCircle,    label: "Identity",   section: "DATA" },
  { id: "sources",    icon: Database,       label: "Sources" },
  { id: "memories",   icon: Brain,          label: "Memories" },
  { id: "settings",   icon: Settings,       label: "Settings" },
];

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  page,
  setPage,
  activityCount,
}: {
  page: Page;
  setPage: (p: Page) => void;
  activityCount: number;
}) {
  let lastSection: string | undefined;

  return (
    <aside className="w-56 shrink-0 border-r border-border/50 flex flex-col bg-card/30 h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
        <img src={heroImg} alt="Kent" className="h-7 w-7" />
        <span className="text-base font-semibold tracking-tight">Kent</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;
          const Icon = item.icon;
          const isActive = page === item.id;

          return (
            <div key={item.id}>
              {showSection && (
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-3 pt-5 pb-1.5">
                  {item.section}
                </div>
              )}
              <button
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  isActive
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === "activity" && activityCount > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">{activityCount}</span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Bottom: new chat */}
      <div className="p-2 border-t border-border/50">
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <span>New chat</span>
        </button>
      </div>
    </aside>
  );
}

// ─── Workflow Card ───────────────────────────────────────────────────────────

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return (
    <div className="group border border-border/50 rounded-xl px-5 py-4 hover:bg-card/80 hover:border-border transition-all cursor-pointer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-foreground">{workflow.name}</span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{workflow.description}</p>
          <p className="text-xs text-muted-foreground/60 mt-1.5">
            {workflow.schedule} · {workflow.lastRun}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {workflow.type === "user" && (
            <>
              <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
                <Pause size={14} />
              </button>
              <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
                <Play size={14} />
              </button>
              <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
            <Play size={14} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Workflows Page ─────────────────────────────────────────────────────────

function WorkflowsPage() {
  const [tab, setTab] = useState<"yours" | "suggested" | "templates" | "deleted">("yours");

  const tabs = [
    { id: "yours" as const, label: "Your Workflows", count: WORKFLOWS.length },
    { id: "suggested" as const, label: "Suggested", count: 4 },
    { id: "templates" as const, label: "Templates", count: 20 },
    { id: "deleted" as const, label: "Deleted", count: 0 },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-serif font-normal tracking-tight mb-6">Workflows</h1>

        {/* Tabs */}
        <div className="flex items-center gap-6 border-b border-border/50 mb-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
                tab === t.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-muted-foreground/60">{t.count}</span>
            </button>
          ))}
        </div>

        {/* Workflow list */}
        <div className="flex flex-col gap-2">
          {tab === "yours" &&
            WORKFLOWS.map((w) => <WorkflowCard key={w.id} workflow={w} />)}
          {tab === "suggested" && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Kent is analyzing your activity to suggest workflows...
            </div>
          )}
          {tab === "templates" && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Browse workflow templates
            </div>
          )}
          {tab === "deleted" && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              No deleted workflows
            </div>
          )}
        </div>
      </div>

      {/* Bottom stats */}
      <div className="max-w-2xl mx-auto px-6 pb-6">
        <p className="text-xs text-muted-foreground/50">
          {WORKFLOWS.length} workflows · {WORKFLOWS.length * 12} runs
        </p>
      </div>
    </div>
  );
}

// ─── Activity Page (former main feed) ───────────────────────────────────────

function ActivityPage({
  items,
  loading,
  filter,
  setFilter,
  query,
  setQuery,
  counts,
}: {
  items: Item[];
  loading: boolean;
  filter: string | null;
  setFilter: (f: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
  counts: Record<string, number>;
}) {
  const sortedSources = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-serif font-normal tracking-tight mb-6">Activity</h1>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <input
            className="w-full pl-9 pr-3 h-9 text-sm bg-secondary/50 border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground focus:border-border focus:ring-1 focus:ring-ring/30 transition-colors"
            placeholder="Search... (⌘K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Source filters */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          <button
            onClick={() => setFilter(null)}
            className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
              filter === null
                ? "bg-foreground text-background"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground"
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
                className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                  filter === source
                    ? "bg-foreground text-background"
                    : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={12} />
                <span>{meta?.label || source}</span>
                <span className="opacity-50">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Items */}
        {loading ? (
          <div className="text-center text-muted-foreground py-20 text-sm">Loading...</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => {
              const meta = SOURCE_META[item.source] || { icon: Globe, label: item.source, color: "text-gray-400" };
              const Icon = meta.icon;
              const title = getTitle(item);
              const subtitle = getSubtitle(item);

              return (
                <div
                  key={item.id}
                  className="group border border-border/50 rounded-lg px-3 py-2.5 hover:bg-card/80 hover:border-border transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`shrink-0 ${meta.color}`}>
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-foreground truncate block">{title}</span>
                      {subtitle && (
                        <span className="text-xs text-muted-foreground truncate block">{subtitle}</span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{timeAgo(item.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="text-center text-muted-foreground py-20 text-sm">No items found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Home Page ──────────────────────────────────────────────────────────────

function HomePage({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-serif font-normal tracking-tight mb-2">Good morning</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {total} items synced across {Object.keys(counts).length} sources
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([source, count]) => {
              const meta = SOURCE_META[source] || { icon: Globe, label: source, color: "text-gray-400" };
              const Icon = meta.icon;
              return (
                <div key={source} className="border border-border/50 rounded-xl px-4 py-3 hover:bg-card/80 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2.5 mb-1">
                    <Icon size={16} className={meta.color} />
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                  <span className="text-2xl font-light tabular-nums">{count}</span>
                  <span className="text-xs text-muted-foreground ml-1.5">items</span>
                </div>
              );
            })}
        </div>

        <h2 className="text-lg font-medium mb-3">Recent workflows</h2>
        <div className="flex flex-col gap-2">
          {WORKFLOWS.slice(0, 3).map((w) => (
            <WorkflowCard key={w.id} workflow={w} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Placeholder pages ──────────────────────────────────────────────────────

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-serif font-normal tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ─── Chat Panel ─────────────────────────────────────────────────────────────

function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [message, setMessage] = useState("");

  if (!open) return null;

  return (
    <aside className="w-80 shrink-0 border-l border-border/50 flex flex-col bg-card/20 h-screen sticky top-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">CHAT</span>
          <span className="text-sm text-muted-foreground">KE</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-sm text-muted-foreground text-center">
          What workflows would you like to schedule?
        </p>
      </div>

      {/* Chat input */}
      <div className="p-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <input
            className="flex-1 h-9 px-3 text-sm bg-secondary/50 border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground focus:border-border focus:ring-1 focus:ring-ring/30 transition-colors"
            placeholder="What workflows would you like to..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button className="h-9 w-9 flex items-center justify-center rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors shrink-0 cursor-pointer">
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const [page, setPage] = useState<Page>("workflows");
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter) params.set("source", filter);
    if (query) params.set("q", query);
    try {
      const res = await fetch(`/api/items?${params}`);
      const data = await res.json();
      setItems(data.items);
    } catch {
      // API not available
    }
    setLoading(false);
  }, [filter, query]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/counts");
      setCounts(await res.json());
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    fetchItems();
    const interval = setInterval(() => {
      fetchItems();
      fetchCounts();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchItems, fetchCounts]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  function renderPage() {
    switch (page) {
      case "home":
        return <HomePage counts={counts} />;
      case "workflows":
        return <WorkflowsPage />;
      case "activity":
        return (
          <ActivityPage
            items={items}
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            query={query}
            setQuery={setQuery}
            counts={counts}
          />
        );
      case "identity":
        return <PlaceholderPage title="Identity" description="Your profile, preferences, and context that Kent uses to personalize responses." />;
      case "sources":
        return <PlaceholderPage title="Sources" description="Connected data sources — Gmail, Calendar, GitHub, Notes, and more." />;
      case "memories":
        return <PlaceholderPage title="Memories" description="Knowledge base of people, projects, and topics Kent has learned." />;
      case "settings":
        return <PlaceholderPage title="Settings" description="Configure Kent's behavior, sync intervals, and API keys." />;
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar page={page} setPage={setPage} activityCount={total} />
      {renderPage()}
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
