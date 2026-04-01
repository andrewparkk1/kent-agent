import { useState } from "react";
import { motion } from "motion/react";
import { Clock, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import Markdown from "react-markdown";
import { timeAgo } from "@/lib/types";

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name?: string;
  status: "pending" | "running" | "done" | "error";
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

function statusIcon(s: WorkflowRun["status"]) {
  switch (s) {
    case "running": return <Loader2 size={14} className="text-amber-400 animate-spin" />;
    case "done": return <CheckCircle2 size={14} className="text-emerald-500/70" />;
    case "error": return <AlertCircle size={14} className="text-red-400" />;
    default: return <Clock size={14} className="text-muted-foreground/40" />;
  }
}

export function WorkflowRunRow({
  run,
  showName = true,
  expandable = false,
}: {
  run: WorkflowRun;
  showName?: boolean;
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = run.finished_at ? run.finished_at - run.started_at : null;

  return (
    <div>
      <motion.div
        onClick={expandable ? () => setExpanded(!expanded) : undefined}
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        className={`flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors ${expandable ? "cursor-pointer" : ""}`}
      >
        {statusIcon(run.status)}
        <div className="flex-1 min-w-0">
          {showName && run.workflow_name && (
            <span className="text-[13px] text-foreground truncate block">{run.workflow_name}</span>
          )}
          {!showName && (
            <span className="text-[13px] text-muted-foreground truncate block">
              {new Date(run.started_at * 1000).toLocaleString()}
            </span>
          )}
          {run.error && <span className="text-[11px] text-red-400/70 truncate block mt-0.5">{run.error}</span>}
          {run.output && !run.error && (
            <span className="text-[11px] text-muted-foreground/50 truncate block mt-0.5">
              {run.output.slice(0, 120)}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums shrink-0">
          {timeAgo(run.started_at)}{duration !== null ? ` · ${duration}s` : ""}
        </span>
      </motion.div>

      {expandable && expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mx-3 mt-1 mb-2"
        >
          {run.error && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-2 text-[12px] text-red-400 font-mono">
              {run.error}
            </div>
          )}
          {run.output ? (
            <div className="bg-foreground/[0.03] border border-border/30 rounded-lg p-5 prose prose-sm prose-neutral max-w-none max-h-[500px] overflow-y-auto prose-headings:text-foreground prose-headings:font-medium prose-headings:text-[14px] prose-headings:mt-4 prose-headings:mb-1 prose-p:text-[13px] prose-p:text-foreground/80 prose-p:leading-relaxed prose-p:my-1.5 prose-li:text-[13px] prose-li:text-foreground/80 prose-ul:my-2 prose-ol:my-2 prose-strong:text-foreground prose-code:text-[12px] prose-code:bg-foreground/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono">
              <Markdown breaks>{run.output}</Markdown>
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground/30 py-2">No output captured.</div>
          )}
        </motion.div>
      )}
    </div>
  );
}
