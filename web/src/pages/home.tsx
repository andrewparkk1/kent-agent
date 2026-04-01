import { motion } from "motion/react";
import { Globe, Zap } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/stagger";
import { SOURCE_META, type Workflow } from "@/lib/types";
import { WorkflowCard } from "./workflows";

export function HomePage({ counts, workflows }: { counts: Record<string, number>; workflows: Workflow[] }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="max-w-[680px] mx-auto px-8 py-10">
      <motion.h1
        className="text-[32px] font-display tracking-tight mb-1"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {greeting}
      </motion.h1>
      <motion.p
        className="text-[13px] text-muted-foreground/60 mb-9"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        {total} items synced across {Object.keys(counts).length} sources
      </motion.p>

      <Stagger className="grid grid-cols-3 gap-2.5 mb-10">
        {Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([source, count]) => {
            const meta = SOURCE_META[source] || { icon: Globe, label: source, color: "text-neutral-400", bg: "bg-neutral-500/8" };
            const Icon = meta.icon;
            return (
              <StaggerItem key={source}>
                <motion.div
                  whileHover={{ y: -2, scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  className="border border-border/40 rounded-xl px-4 py-3.5 cursor-pointer hover:border-border/70 hover:bg-card transition-colors"
                >
                  <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center mb-3`}>
                    <Icon size={16} className={meta.color} />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-light tabular-nums tracking-tight">{count}</span>
                    <span className="text-[11px] text-muted-foreground/50">{meta.label}</span>
                  </div>
                </motion.div>
              </StaggerItem>
            );
          })}
      </Stagger>

      {workflows.length > 0 && (
        <>
          <motion.h2
            className="text-[15px] font-medium mb-3.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.3 }}
          >
            Recent workflows
          </motion.h2>
          <Stagger className="flex flex-col gap-2">
            {workflows.slice(0, 3).map((w) => <WorkflowCard key={w.id} workflow={w} />)}
          </Stagger>
        </>
      )}
    </div>
  );
}
