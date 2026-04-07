import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Sidebar } from "@/components/sidebar";
import { PageTransition } from "@/components/stagger";
import { HomePage } from "@/pages/home";
import { WorkflowsPage } from "@/pages/workflows";
import { ActivityPage } from "@/pages/activity";
import { SourcesPage } from "@/pages/sources";
import { ChatPage } from "@/pages/chat";
import { IdentityPage } from "@/pages/identity";
import { MemoriesPage } from "@/pages/memories";
import { MemoryDetailPage } from "@/pages/memory-detail";
import { WorkflowDetailPage } from "@/pages/workflow-detail";
import { SettingsPage } from "@/pages/settings";
import type { Page, Item, Workflow, SourceInfo, DaemonInfo } from "@/lib/types";

// ─── Hash-based routing ─────────────────────────────────────────────────────

const VALID_PAGES = new Set<Page>(["home", "workflows", "workflow-detail", "activity", "chat", "identity", "sources", "memories", "memory-detail", "settings"]);

function parseHash(): { page: Page; threadId: string | null; workflowId: string | null; memoryId: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  const base = parts[0] || "workflows";
  const id = parts[1] || null;

  switch (base) {
    case "chat":
      return { page: "chat", threadId: id, workflowId: null, memoryId: null };
    case "workflow":
      if (id) return { page: "workflow-detail", threadId: null, workflowId: id, memoryId: null };
      return { page: "workflows", threadId: null, workflowId: null, memoryId: null };
    case "memory":
      if (id) return { page: "memory-detail", threadId: null, workflowId: null, memoryId: id };
      return { page: "memories", threadId: null, workflowId: null, memoryId: null };
    default:
      if (VALID_PAGES.has(base as Page)) return { page: base as Page, threadId: null, workflowId: null, memoryId: null };
      return { page: "workflows", threadId: null, workflowId: null, memoryId: null };
  }
}

function buildHash(page: Page, ids: { threadId?: string | null; workflowId?: string | null; memoryId?: string | null } = {}): string {
  switch (page) {
    case "chat":
      return ids.threadId ? `#/chat/${ids.threadId}` : "#/chat";
    case "workflow-detail":
      return ids.workflowId ? `#/workflow/${ids.workflowId}` : "#/workflows";
    case "memory-detail":
      return ids.memoryId ? `#/memory/${ids.memoryId}` : "#/memories";
    default:
      return `#/${page}`;
  }
}

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const initial = parseHash();
  const [page, setPageState] = useState<Page>(initial.page);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [daemon, setDaemon] = useState<DaemonInfo>({ status: "stopped", currentSource: null, intervalSeconds: 300, lastSyncAt: null, nextSyncAt: null });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initial.threadId);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(initial.workflowId);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(initial.memoryId);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);

  const [initialInput, setInitialInput] = useState("");
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);

  const isPopstateRef = useRef(false);

  const setPage = useCallback((p: Page) => {
    setPageState(p);
  }, []);

  // Sync hash to URL when page/ids change (skip if caused by popstate)
  useEffect(() => {
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      return;
    }
    const hash = buildHash(page, { threadId: selectedThreadId, workflowId: selectedWorkflowId, memoryId: selectedMemoryId });
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", hash);
    }
  }, [page, selectedThreadId, selectedWorkflowId, selectedMemoryId]);

  // Listen for browser back/forward
  useEffect(() => {
    const onPopState = () => {
      isPopstateRef.current = true;
      const parsed = parseHash();
      setPageState(parsed.page);
      setSelectedThreadId(parsed.threadId);
      setSelectedWorkflowId(parsed.workflowId);
      setSelectedMemoryId(parsed.memoryId);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openChat = useCallback((threadId?: string, prefill?: string) => {
    setSelectedThreadId(threadId ?? null);
    setInitialInput(prefill ?? "");
    setPage("chat");
  }, [setPage]);

  const [itemsPage, setItemsPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  const CONVERSATION_SOURCES = ["imessage", "signal"];
  const PAGE_SIZE = 50;
  const CONVO_PAGE_SIZE = 500;

  const fetchErrorShown = useRef(false);
  const showFetchError = useCallback((msg: string) => {
    if (!fetchErrorShown.current) {
      fetchErrorShown.current = true;
      toast.error(msg);
      setTimeout(() => { fetchErrorShown.current = false; }, 30_000);
    }
  }, []);

  const fetchItems = useCallback(async (page = 0) => {
    const isConvo = filter ? CONVERSATION_SOURCES.includes(filter) : false;
    const pageSize = isConvo ? CONVO_PAGE_SIZE : PAGE_SIZE;
    const params = new URLSearchParams();
    if (filter) params.set("source", filter);
    if (query) params.set("q", query);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    try {
      const res = await fetch(`/api/items?${params}`);
      const data = await res.json();
      setItems(data.items);
      setHasMore(data.hasMore ?? false);
      setTotalItems(data.total ?? 0);
    } catch {
      showFetchError("Failed to fetch data. Is the API server running?");
    }
    setLoading(false);
  }, [filter, query, showFetchError]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/counts");
      setCounts(await res.json());
    } catch {
      showFetchError("Failed to fetch data. Is the API server running?");
    }
  }, [showFetchError]);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setWorkflows(data.workflows);
      setTotalRuns(data.totalRuns || 0);
    } catch {
      showFetchError("Failed to fetch data. Is the API server running?");
    }
    setWorkflowsLoading(false);
  }, [showFetchError]);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      setSources(data.sources);
      setDaemon(data.daemon);
    } catch {
      showFetchError("Failed to fetch data. Is the API server running?");
    }
  }, [showFetchError]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/activity/unread");
      const data = await res.json();
      setUnreadActivityCount(data.count);
    } catch {
      showFetchError("Failed to fetch data. Is the API server running?");
    }
  }, [showFetchError]);

  // Reset page when filter/query changes
  useEffect(() => { setItemsPage(0); }, [filter, query]);

  useEffect(() => {
    fetchCounts();
    fetchItems(itemsPage);
    fetchWorkflows();
    fetchSources();
    fetchUnreadCount();
    const interval = setInterval(() => {
      fetchItems(itemsPage);
      fetchCounts();
      fetchSources();
      fetchUnreadCount();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchItems, fetchCounts, fetchWorkflows, fetchSources, fetchUnreadCount, itemsPage]);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        page={page}
        setPage={setPage}
        openChat={openChat}
        selectedThreadId={selectedThreadId}
        workflowCount={workflows.length}
        runCount={totalRuns}
        refreshKey={threadRefreshKey}
        unreadActivityCount={unreadActivityCount}
      />

      {/* Spacer for fixed sidebar (hidden on mobile where sidebar is an overlay) */}
      <div className="hidden md:block w-[220px] shrink-0" />

      <PageTransition pageKey={page === "workflow-detail" ? `workflow-${selectedWorkflowId}` : page === "memory-detail" ? `memory-${selectedMemoryId}` : page}>
        {page === "home" && <HomePage />}
        {page === "workflows" && (
          <WorkflowsPage
            workflows={workflows}
            loading={workflowsLoading}
            onSelect={(id) => { setSelectedWorkflowId(id); setPage("workflow-detail"); }}
            onRefresh={fetchWorkflows}
            openChat={openChat}
          />
        )}
        {page === "workflow-detail" && selectedWorkflowId && (
          <WorkflowDetailPage
            workflowId={selectedWorkflowId}
            onBack={() => setPage("workflows")}
            openChat={openChat}
          />
        )}
        {page === "activity" && <ActivityPage openChat={openChat} onSeen={fetchUnreadCount} />}
        {page === "chat" && <ChatPage threadId={selectedThreadId} initialInput={initialInput} onThreadCreated={(id) => { setSelectedThreadId(id); setThreadRefreshKey((k) => k + 1); }} />}
        {page === "sources" && (
          <SourcesPage items={items} loading={loading} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} counts={counts} sources={sources} daemon={daemon} onRefresh={() => { fetchItems(itemsPage); fetchCounts(); fetchSources(); }} page={itemsPage} hasMore={hasMore} totalPages={totalItems > 0 ? Math.ceil(totalItems / (filter && ["imessage", "signal"].includes(filter) ? CONVO_PAGE_SIZE : PAGE_SIZE)) : undefined} onPageChange={setItemsPage} />
        )}
        {page === "identity" && <IdentityPage />}
        {page === "memories" && <MemoriesPage onSelect={(id) => { setSelectedMemoryId(id); setPage("memory-detail"); }} />}
        {page === "memory-detail" && selectedMemoryId && (
          <MemoryDetailPage
            memoryId={selectedMemoryId}
            onBack={() => setPage("memories")}
            onNavigate={(id) => { setSelectedMemoryId(id); }}
          />
        )}
        {page === "settings" && <SettingsPage />}
      </PageTransition>

    </div>
  );
}
