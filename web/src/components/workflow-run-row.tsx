import { motion } from "motion/react";
import { Clock, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { timeAgo } from "@/lib/types";

function stripMd(s: string): string {
  return s
    .replace(/^---+$/gm, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name?: string;
  status: "pending" | "running" | "done" | "error";
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  is_new?: boolean;
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
  onClick,
}: {
  run: WorkflowRun;
  showName?: boolean;
  onClick?: () => void;
}) {
  const duration = run.finished_at ? run.finished_at - run.started_at : null;

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
      className={`flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="relative">
        {statusIcon(run.status)}
        {run.is_new && (
          <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-blue-500 ring-2 ring-background" />
        )}
      </div>
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
          <span className="text-[12px] text-muted-foreground/50 truncate block mt-0.5">
            {stripMd(run.output).slice(0, 200)}
          </span>
        )}
      </div>
      <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums shrink-0">
        {timeAgo(run.started_at)}{duration !== null ? ` · ${duration}s` : ""}
      </span>
    </motion.div>
  );
}
