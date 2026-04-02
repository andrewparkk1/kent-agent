import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Sidebar } from "@/components/sidebar";
import { PageTransition } from "@/components/stagger";
import { HomePage } from "@/pages/home";
import { WorkflowsPage } from "@/pages/workflows";
import { ActivityPage } from "@/pages/activity";
import { SourcesPage } from "@/pages/sources";
import { ChatPage } from "@/pages/chat";
import { IdentityPage } from "@/pages/identity";
import { MemoriesPage } from "@/pages/memories";
import { WorkflowDetailPage } from "@/pages/workflow-detail";
import { SettingsPage } from "@/pages/settings";
import type { Page, Item, Workflow, SourceInfo, DaemonInfo } from "@/lib/types";

// ─── Placeholder ────────────────────────────────────────────────────────────

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {title}
      </motion.h1>
      <motion.p
        className="text-[13px] text-muted-foreground/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        {description}
      </motion.p>
    </div>
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
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [daemon, setDaemon] = useState<DaemonInfo>({ status: "stopped", currentSource: null, intervalSeconds: 300, lastSyncAt: null, nextSyncAt: null });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const openChat = useCallback((threadId?: string) => {
    setSelectedThreadId(threadId ?? null);
    setPage("chat");
  }, []);

  const [itemsPage, setItemsPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 50;

  const fetchItems = useCallback(async (page = 0) => {
    const params = new URLSearchParams();
    if (filter) params.set("source", filter);
    if (query) params.set("q", query);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    try {
      const res = await fetch(`/api/items?${params}`);
      const data = await res.json();
      setItems(data.items);
      setHasMore(data.hasMore ?? false);
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

  // Reset page when filter/query changes
  useEffect(() => { setItemsPage(0); }, [filter, query]);

  useEffect(() => {
    fetchCounts();
    fetchItems(itemsPage);
    fetchWorkflows();
    fetchSources();
    const interval = setInterval(() => {
      fetchItems(itemsPage);
      fetchCounts();
      fetchSources();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchItems, fetchCounts, fetchWorkflows, fetchSources, itemsPage]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        page={page}
        setPage={setPage}
        openChat={openChat}
        selectedThreadId={selectedThreadId}
        workflowCount={workflows.length}
        runCount={totalRuns}
      />

      {/* Spacer for fixed sidebar */}
      <div className="w-[220px] shrink-0" />

      <PageTransition pageKey={page === "workflow-detail" ? `workflow-${selectedWorkflowId}` : page}>
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
        {page === "activity" && <ActivityPage />}
        {page === "chat" && <ChatPage threadId={selectedThreadId} onThreadCreated={setSelectedThreadId} />}
        {page === "sources" && (
          <SourcesPage items={items} loading={loading} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} counts={counts} sources={sources} daemon={daemon} onRefresh={() => { fetchItems(itemsPage); fetchCounts(); fetchSources(); }} page={itemsPage} hasMore={hasMore} onPageChange={setItemsPage} />
        )}
        {page === "identity" && <IdentityPage />}
        {page === "memories" && <MemoriesPage />}
        {page === "settings" && <SettingsPage />}
      </PageTransition>

    </div>
  );
}
