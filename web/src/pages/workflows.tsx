import { useState } from "react";
import { motion } from "motion/react";
import { Zap, Play, ChevronRight, Clock, Sparkles, Archive, Plus, ArchiveRestore, Loader2 } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { type Workflow, cronToHuman, timeAgo } from "@/lib/types";

type Tab = "active" | "suggested" | "archived";

function WorkflowCard({ workflow, onClick, actions }: {
  workflow: Workflow;
  onClick?: () => void;
  actions?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <StaggerItem>
      <motion.div
        onClick={onClick}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.2 }}
        className="relative border border-border/50 rounded-xl px-5 py-4 cursor-pointer overflow-hidden"
        style={{ background: hovered ? "hsl(var(--card))" : "transparent" }}
      >
        <motion.div
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60 rounded-full"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: hovered ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ originY: 0.5 }}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[14px] font-medium text-foreground leading-snug">{workflow.name}</span>
              {workflow.source === "suggested" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500">
                  <Sparkles size={9} />
                  suggested
                </span>
              )}
              {workflow.source !== "suggested" && workflow.enabled && (
                <span className="inline-block w-[7px] h-[7px] rounded-full bg-emerald-500 shrink-0 animate-pulse-dot" />
              )}
              {workflow.source !== "suggested" && !workflow.enabled && (
                <span className="inline-block w-[7px] h-[7px] rounded-full bg-muted-foreground/30 shrink-0" />
              )}
            </div>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              {workflow.description || workflow.prompt.slice(0, 100)}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-muted-foreground/40" />
                <span className="text-[11px] text-muted-foreground/50">{cronToHuman(workflow.cron_schedule)}</span>
              </div>
              {workflow.lastRunAt && (
                <span className="text-[11px] text-muted-foreground/40">· {timeAgo(workflow.lastRunAt)}</span>
              )}
              {workflow.runCount > 0 && (
                <span className="text-[11px] text-muted-foreground/40">· {workflow.runCount} runs</span>
              )}
            </div>
          </div>

          <motion.div
            className="flex items-center gap-0.5 shrink-0 pt-0.5"
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: hovered ? 1 : 0, x: hovered ? 0 : 4 }}
            transition={{ duration: 0.15 }}
          >
            {actions}
            <button className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-foreground transition-colors">
              <ChevronRight size={13} />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </StaggerItem>
  );
}

function SuggestedCard({ workflow, onClick, onEnable }: {
  workflow: Workflow;
  onClick?: () => void;
  onEnable?: () => void;
}) {
  return (
    <WorkflowCard
      workflow={workflow}
      onClick={onClick}
      actions={
        <button
          onClick={(e) => { e.stopPropagation(); onEnable?.(); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-foreground text-background text-[11px] font-medium hover:bg-foreground/90 transition-colors"
        >
          <Plus size={11} />
          Enable
        </button>
      }
    />
  );
}

export function WorkflowsPage({ workflows, loading, onSelect, onRefresh, openChat }: {
  workflows: Workflow[];
  loading: boolean;
  onSelect?: (id: string) => void;
  onRefresh?: () => void;
  openChat?: (threadId?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("active");
  const [runningId, setRunningId] = useState<string | null>(null);

  const archiveWorkflow = async (id: string) => {
    try {
      await fetch("/api/workflow/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      onRefresh?.();
    } catch {}
  };

  const unarchiveWorkflow = async (id: string) => {
    try {
      await fetch("/api/workflow/unarchive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      onRefresh?.();
    } catch {}
  };

  const runWorkflow = async (id: string) => {
    if (runningId) return;
    setRunningId(id);
    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            if (event.threadId) {
              openChat?.(event.threadId);
              return;
            }
          } catch {}
        }
      }
    } catch {} finally {
      setRunningId(null);
    }
  };

  const active = workflows.filter((w) => !w.is_archived && w.source !== "suggested");
  const suggested = workflows.filter((w) => !w.is_archived && w.source === "suggested");
  const archived = workflows.filter((w) => w.is_archived);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "active", label: "My Workflows", count: active.length },
    { id: "suggested", label: "Suggested", count: suggested.length },
    { id: "archived", label: "Archived", count: archived.length },
  ];

  const enableWorkflow = async (id: string) => {
    try {
      await fetch("/api/workflow/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      onRefresh?.();
    } catch {}
  };

  const current = tab === "active" ? active : tab === "suggested" ? suggested : archived;

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-5 text-foreground"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        Workflows
      </motion.h1>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border/40 pb-px">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
              tab === t.id
                ? "text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
          >
            {t.label}
            {t.count > 0 && tab !== t.id && (
              <span className="ml-1.5 text-[10px] text-muted-foreground/30">{t.count}</span>
            )}
            {tab === t.id && (
              <motion.div
                layoutId="workflow-tab"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl animate-shimmer" />)}
        </div>
      ) : current.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-16 text-center"
        >
          {tab === "active" && (
            <>
              <Zap size={24} className="mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-[14px] text-muted-foreground mb-1">No workflows yet</p>
              <p className="text-[12px] text-muted-foreground/50">Create a workflow to automate recurring agent tasks</p>
            </>
          )}
          {tab === "suggested" && (
            <>
              <Sparkles size={24} className="mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-[14px] text-muted-foreground mb-1">No suggestions yet</p>
              <p className="text-[12px] text-muted-foreground/50">The workflow suggestor will analyze your data and propose automations</p>
            </>
          )}
          {tab === "archived" && (
            <>
              <Archive size={24} className="mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-[14px] text-muted-foreground mb-1">No archived workflows</p>
              <p className="text-[12px] text-muted-foreground/50">Archived workflows appear here</p>
            </>
          )}
        </motion.div>
      ) : (
        <Stagger className="flex flex-col gap-2" key={tab}>
          {current.map((w) =>
            tab === "suggested" ? (
              <SuggestedCard
                key={w.id}
                workflow={w}
                onClick={() => onSelect?.(w.id)}
                onEnable={() => enableWorkflow(w.id)}
              />
            ) : tab === "archived" ? (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onClick={() => onSelect?.(w.id)}
                actions={
                  <button
                    onClick={(e) => { e.stopPropagation(); unarchiveWorkflow(w.id); }}
                    className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-foreground transition-colors"
                    title="Unarchive"
                  >
                    <ArchiveRestore size={13} />
                  </button>
                }
              />
            ) : (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onClick={() => onSelect?.(w.id)}
                actions={
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); runWorkflow(w.id); }}
                      disabled={runningId === w.id}
                      className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-emerald-500 transition-colors disabled:opacity-50"
                      title="Run now"
                    >
                      {runningId === w.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); archiveWorkflow(w.id); }}
                      className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-red-400 transition-colors"
                      title="Archive"
                    >
                      <Archive size={13} />
                    </button>
                  </>
                }
              />
            )
          )}
        </Stagger>
      )}
    </div>
  );
}
