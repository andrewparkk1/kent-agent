import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Home, Zap, Activity, MessageCircle, Plus, X, Menu,
  Database, UserCircle, Settings, Brain,
} from "lucide-react";
import { toast } from "sonner";
import kentIcon from "@/assets/icon.png";
import type { Page } from "@/lib/types";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

interface Thread {
  id: string;
  title: string;
  type: "chat" | "workflow";
  workflow_name: string | null;
  created_at: number;
  last_message_at: number;
}

const NAV_MAIN = [
  { id: "home" as Page, icon: Home, label: "Home" },
  { id: "workflows" as Page, icon: Zap, label: "Workflows" },
  { id: "activity" as Page, icon: Activity, label: "Activity" },
];

const NAV_DATA = [
  { id: "identity" as Page, icon: UserCircle, label: "Identity" },
  { id: "sources" as Page, icon: Database, label: "Sources" },
  { id: "memories" as Page, icon: Brain, label: "Memories" },
  { id: "settings" as Page, icon: Settings, label: "Settings" },
];

function NavButton({ item, active, onClick, badge }: { item: { id: Page; icon: typeof Home; label: string }; active: boolean; onClick: () => void; badge?: React.ReactNode }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all duration-200 cursor-pointer ${active ? "bg-foreground/[0.06] text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
        }`}
    >
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-foreground/70"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <Icon size={15} strokeWidth={active ? 2 : 1.5} />
      <span className="flex-1 text-left">{item.label}</span>
      {badge}
    </button>
  );
}

export function Sidebar({ page, setPage, openChat, selectedThreadId, workflowCount, runCount, refreshKey, unreadActivityCount }: {
  page: Page;
  setPage: (p: Page) => void;
  openChat: (threadId?: string) => void;
  selectedThreadId: string | null;
  workflowCount?: number;
  runCount?: number;
  refreshKey?: number;
  unreadActivityCount?: number;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const COLLAPSED_COUNT = 5;

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/threads");
        const data = await res.json();
        setThreads(data.threads.filter((t: Thread) => t.type !== "workflow"));
      } catch {
        toast.error("Failed to load chat threads");
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [refreshKey]);

  // Close sidebar on navigation in mobile
  const navigate = useCallback((action: () => void) => {
    action();
    if (isMobile) setMobileOpen(false);
  }, [isMobile]);

  const deleteThread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/threads/${id}`, { method: "DELETE" });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (selectedThreadId === id) {
        openChat();
      }
    } catch {
      toast.error("Failed to delete thread");
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <img src={kentIcon} alt="Kent" className="h-7 w-7 rounded-md" />
        <span className="text-[17px] font-display tracking-tight">Kent</span>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-1 rounded-lg hover:bg-foreground/5 text-muted-foreground cursor-pointer">
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 overflow-y-auto no-scrollbar">
        <div className="space-y-0.5">
          {NAV_MAIN.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => navigate(() => setPage(item.id))}
              badge={item.id === "activity" && unreadActivityCount ? (
                <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-medium px-1 tabular-nums">
                  {unreadActivityCount > 99 ? "99+" : unreadActivityCount}
                </span>
              ) : undefined}
            />
          ))}
        </div>

        <div className="mt-6 mb-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50 px-3">Chats</span>
            <button onClick={() => navigate(() => openChat())} className="p-0.5 mr-1.5 rounded hover:bg-foreground/5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer">
              <Plus size={12} />
            </button>
          </div>
          {threads.length === 0 && (
            <button
              onClick={() => navigate(() => openChat())}
              className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03] transition-all duration-200 cursor-pointer"
            >
              <MessageCircle size={15} strokeWidth={1.5} />
              <span>New chat</span>
            </button>
          )}
          {threads.length > 0 && (
            <div className="mt-1">
              <motion.div
                className="space-y-0.5 overflow-hidden"
                initial={false}
                animate={{ height: "auto" }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <AnimatePresence initial={false}>
                  {(showAllThreads ? threads : threads.slice(0, COLLAPSED_COUNT)).map((thread) => (
                    <motion.div
                      key={thread.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className="group/thread relative"
                    >
                      <button
                        onClick={() => navigate(() => openChat(thread.id))}
                        className={`w-full text-left px-3 py-[6px] pr-7 rounded-lg text-[12px] truncate transition-colors duration-200 cursor-pointer block ${page === "chat" && selectedThreadId === thread.id
                          ? "bg-foreground/[0.06] text-foreground font-medium"
                          : "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03]"
                          }`}
                        title={thread.title || "Untitled"}
                      >
                        {thread.title || "Untitled"}
                      </button>
                      <button
                        onClick={(e) => deleteThread(thread.id, e)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover/thread:opacity-100 hover:bg-foreground/10 text-muted-foreground/40 hover:text-red-400 transition-all cursor-pointer"
                        title="Delete thread"
                      >
                        <X size={11} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
              {threads.length > COLLAPSED_COUNT && (
                <button
                  onClick={() => setShowAllThreads(!showAllThreads)}
                  className="w-full px-3 py-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer text-left"
                >
                  {showAllThreads ? "Show less" : `Show ${threads.length - COLLAPSED_COUNT} more`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="px-3 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">Data</span>
          </div>
          <div className="space-y-0.5">
            {NAV_DATA.map((item) => (
              <NavButton key={item.id} item={item} active={page === item.id} onClick={() => navigate(() => setPage(item.id))} />
            ))}
          </div>
        </div>
      </nav>

      {(workflowCount != null || runCount != null) && (
        <div className="px-5 py-3 border-t border-border/40">
          <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums">
            {workflowCount ?? 0} workflow{workflowCount !== 1 ? "s" : ""} · {runCount ?? 0} run{runCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </>
  );

  // Mobile: hamburger button + overlay drawer
  if (isMobile) {
    return (
      <>
        <AnimatePresence>
          {!mobileOpen && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileOpen(true)}
              className="fixed top-4 left-4 z-40 p-2 rounded-lg border border-border/60 shadow-sm hover:bg-foreground/5 transition-colors cursor-pointer"
              style={{ background: "hsl(var(--background))" }}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.8 }}
                className="w-[280px] shrink-0 border-r border-border/60 flex flex-col h-screen fixed top-0 left-0 z-50 shadow-2xl"
                style={{ background: "hsl(var(--background))" }}
              >
                {sidebarContent}
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Desktop: fixed sidebar
  return (
    <aside className="w-[220px] shrink-0 border-r border-border/30 flex flex-col h-screen fixed top-0 left-0 z-30 bg-background">
      {sidebarContent}
    </aside>
  );
}
