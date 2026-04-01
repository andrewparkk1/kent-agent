import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Activity, Clock, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { timeAgo } from "@/lib/types";

interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
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

export function ActivityPage() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/activity");
        const data = await res.json();
        setRuns(data.runs);
      } catch {}
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-[680px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-7"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        Activity
      </motion.h1>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-lg animate-shimmer" />)}
        </div>
      ) : runs.length === 0 ? (
        <motion.div
          className="text-center py-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <Activity size={32} className="mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-[13px] text-muted-foreground/50">No workflow runs yet</p>
          <p className="text-[12px] text-muted-foreground/30 mt-1">Runs will appear here when workflows execute</p>
        </motion.div>
      ) : (
        <Stagger className="flex flex-col gap-1">
          {runs.map((run) => (
            <StaggerItem key={run.id}>
              <motion.div
                whileHover={{ x: 2 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
              >
                {statusIcon(run.status)}
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-foreground truncate block">{run.workflow_name}</span>
                  {run.error && <span className="text-[11px] text-red-400/70 truncate block mt-0.5">{run.error}</span>}
                  {run.output && !run.error && <span className="text-[11px] text-muted-foreground/50 truncate block mt-0.5">{run.output.slice(0, 120)}</span>}
                </div>
                <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums shrink-0">{timeAgo(run.started_at)}</span>
              </motion.div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
