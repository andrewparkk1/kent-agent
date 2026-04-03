import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Activity } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { WorkflowRunRow, type WorkflowRun } from "@/components/workflow-run-row";

export function ActivityPage({ openChat, onSeen }: { openChat?: (threadId: string) => void; onSeen?: () => void }) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [markedSeen, setMarkedSeen] = useState(false);

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

  // Mark all as seen once the page is opened and data has loaded
  useEffect(() => {
    if (!loading && !markedSeen && runs.length > 0) {
      setMarkedSeen(true);
      fetch("/api/activity/seen", { method: "POST" }).then(() => onSeen?.()).catch(() => {});
    }
  }, [loading, markedSeen, runs.length]);

  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
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
              <WorkflowRunRow run={run} showName onClick={() => openChat?.(run.id)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
