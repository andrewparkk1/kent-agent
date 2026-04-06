import { useState, useEffect, useCallback } from "react";
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



// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const [page, setPage] = useState<Page>("workflows");
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
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);

  const [initialInput, setInitialInput] = useState("");
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);

  const openChat = useCallback((threadId?: string, prefill?: string) => {
    setSelectedThreadId(threadId ?? null);
    setInitialInput(prefill ?? "");
    setPage("chat");
  }, []);

  const [itemsPage, setItemsPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  const CONVERSATION_SOURCES = ["imessage", "signal"];
  const PAGE_SIZE = 50;
  const CONVO_PAGE_SIZE = 500;

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
    } catch {}
    setLoading(false);
  }, [filter, query]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/counts");
      setCounts(await res.json());
    } catch {}
  }, []);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setWorkflows(data.workflows);
      setTotalRuns(data.totalRuns || 0);
    } catch {}
    setWorkflowsLoading(false);
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      setSources(data.sources);
      setDaemon(data.daemon);
    } catch {}
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/activity/unread");
      const data = await res.json();
      setUnreadActivityCount(data.count);
    } catch {}
  }, []);

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

      {/* Spacer for fixed sidebar */}
      <div className="w-[220px] shrink-0" />

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
