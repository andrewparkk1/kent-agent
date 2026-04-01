import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Clock, Play, Loader2, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import { type Workflow, cronToHuman, timeAgo } from "@/lib/types";
import { WorkflowRunRow, type WorkflowRun } from "@/components/workflow-run-row";

interface WorkflowDetail {
  workflow: Workflow;
  runs: WorkflowRun[];
}

export function WorkflowDetailPage({
  workflowId,
  onBack,
  openChat,
}: {
  workflowId: string;
  onBack: () => void;
  openChat: (threadId: string) => void;
}) {
  const [data, setData] = useState<WorkflowDetail | null>(null);
  const [running, setRunning] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflow?id=${encodeURIComponent(workflowId)}`);
      if (res.ok) setData(await res.json());
    } catch {}
  }, [workflowId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const toggleEnabled = async () => {
    try {
      const res = await fetch("/api/workflow/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workflowId }),
      });
      if (res.ok) fetchDetail();
    } catch {}
  };

  const deleteWorkflow = async () => {
    if (!confirm(`Delete "${data?.workflow.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/workflow/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workflowId }),
      });
      if (res.ok) onBack();
    } catch {}
  };

  const triggerRun = async () => {
    if (running) return;
    setRunning(true);

    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workflowId }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      // Read just enough to get the threadId from the first event, then navigate
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            if (event.threadId) {
              // Navigate to chat — the agent is still running in the background
              openChat(event.threadId);
              return;
            }
          } catch {}
        }
      }
    } catch {
      // If we failed to get a threadId, just stay on the page
      setRunning(false);
    }
  };

  if (!data) {
    return (
      <div className="max-w-[900px] mx-auto px-8 py-10">
        <div className="h-8 w-48 rounded animate-shimmer mb-4" />
        <div className="h-4 w-96 rounded animate-shimmer" />
      </div>
    );
  }

  const { workflow: wf, runs } = data;

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors mb-6 cursor-pointer"
      >
        <ArrowLeft size={14} />
        Workflows
      </button>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-display tracking-tight">{wf.name}</h1>
            <button
              onClick={toggleEnabled}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                wf.enabled
                  ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                  : "bg-muted-foreground/10 text-muted-foreground/50 hover:bg-muted-foreground/20"
              }`}
            >
              {wf.enabled && <span className="w-[6px] h-[6px] rounded-full bg-emerald-500 animate-pulse-dot" />}
              {wf.enabled ? "Active" : "Disabled"}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Delete */}
            <button
              onClick={deleteWorkflow}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-border/50 text-muted-foreground/50 hover:text-red-500 hover:border-red-500/30 transition-colors cursor-pointer"
              title="Delete workflow"
            >
              <Trash2 size={13} />
            </button>

            {/* Run button */}
            <button
              onClick={triggerRun}
              disabled={running || !wf.enabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                running || !wf.enabled
                  ? "bg-foreground/5 text-muted-foreground/50 cursor-not-allowed"
                  : "bg-foreground text-background hover:bg-foreground/90 cursor-pointer"
              }`}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? "Running..." : "Run now"}
            </button>
          </div>
        </div>

        {wf.description && (
          <p className="text-[14px] text-muted-foreground mt-1 mb-4">{wf.description}</p>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-[12px] text-muted-foreground/50 mb-6">
          <div className="flex items-center gap-1.5">
            <Clock size={12} />
            {cronToHuman(wf.cron_schedule)}
          </div>
          {wf.source && wf.source !== "user" && (
            <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px]">{wf.source}</span>
          )}
          {wf.lastRunAt && (
            <span>Last run: {timeAgo(wf.lastRunAt)}</span>
          )}
          <span>{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Prompt */}
        <div className="mb-8">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/40 mb-2">Prompt</h2>
          <div className="bg-foreground/[0.03] border border-border/40 rounded-lg p-5 prose-brief">
            <Markdown>{wf.prompt}</Markdown>
          </div>
        </div>
      </motion.div>

      {/* Run history */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/40 mb-3">Run History</h2>

        {runs.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted-foreground/40">
            No runs yet. Click "Run now" to trigger this workflow.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {runs.map((run) => (
              <WorkflowRunRow key={run.id} run={run} showName={false} expandable />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
