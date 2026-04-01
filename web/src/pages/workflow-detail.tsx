import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Clock } from "lucide-react";
import { type Workflow, cronToHuman, timeAgo } from "@/lib/types";
import { WorkflowRunRow, type WorkflowRun } from "@/components/workflow-run-row";

interface WorkflowDetail {
  workflow: Workflow;
  runs: WorkflowRun[];
}

export function WorkflowDetailPage({
  workflowId,
  onBack,
}: {
  workflowId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<WorkflowDetail | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflow?id=${encodeURIComponent(workflowId)}`);
      if (res.ok) setData(await res.json());
    } catch {}
  }, [workflowId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (!data) {
    return (
      <div className="max-w-[720px] mx-auto px-8 py-10">
        <div className="h-8 w-48 rounded animate-shimmer mb-4" />
        <div className="h-4 w-96 rounded animate-shimmer" />
      </div>
    );
  }

  const { workflow: wf, runs } = data;

  return (
    <div className="max-w-[720px] mx-auto px-8 py-10">
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
            {wf.enabled ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-500">
                <span className="w-[6px] h-[6px] rounded-full bg-emerald-500 animate-pulse-dot" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted-foreground/10 text-muted-foreground/50">
                Disabled
              </span>
            )}
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
          <div className="bg-foreground/[0.03] border border-border/40 rounded-lg p-4 text-[13px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {wf.prompt}
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
            No runs yet.
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
