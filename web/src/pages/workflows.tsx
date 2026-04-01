import { useState } from "react";
import { motion } from "motion/react";
import { Zap, Play, ChevronRight, Clock } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { type Workflow, cronToHuman, timeAgo } from "@/lib/types";

export function WorkflowCard({ workflow, onClick }: { workflow: Workflow; onClick?: () => void }) {
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
              {workflow.enabled && <span className="inline-block w-[7px] h-[7px] rounded-full bg-emerald-500 shrink-0 animate-pulse-dot" />}
              {!workflow.enabled && <span className="inline-block w-[7px] h-[7px] rounded-full bg-muted-foreground/30 shrink-0" />}
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
            <button className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-foreground transition-colors">
              <Play size={13} />
            </button>
            <button className="p-1.5 rounded-md hover:bg-foreground/5 text-muted-foreground/50 hover:text-foreground transition-colors">
              <ChevronRight size={13} />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </StaggerItem>
  );
}

export function WorkflowsPage({ workflows, loading, onSelect }: { workflows: Workflow[]; loading: boolean; onSelect?: (id: string) => void }) {
  return (
    <div className="max-w-[680px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-7 text-foreground"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        Workflows
      </motion.h1>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl animate-shimmer" />)}
        </div>
      ) : workflows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-16 text-center"
        >
          <Zap size={24} className="mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-[14px] text-muted-foreground mb-1">No workflows yet</p>
          <p className="text-[12px] text-muted-foreground/50">Create a workflow to automate recurring agent tasks</p>
        </motion.div>
      ) : (
        <Stagger className="flex flex-col gap-2">
          {workflows.map((w) => <WorkflowCard key={w.id} workflow={w} onClick={() => onSelect?.(w.id)} />)}
        </Stagger>
      )}

    </div>
  );
}
