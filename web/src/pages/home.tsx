import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Sunrise, Moon, RefreshCw, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import { timeAgo } from "@/lib/types";

interface BriefRun {
  id: string;
  workflow_name: string;
  workflow_description: string;
  output: string;
  started_at: number;
  finished_at: number | null;
}

function formatBriefDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function BriefLabel({ name }: { name: string }) {
  const isMorning = name.includes("morning");
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isMorning ? "bg-amber-500/10" : "bg-indigo-500/10"}`}>
        {isMorning
          ? <Sunrise size={14} className="text-amber-500/80" />
          : <Moon size={14} className="text-indigo-400/80" />
        }
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
        {isMorning ? "Morning Brief" : "Evening Recap"}
      </span>
    </div>
  );
}

export function HomePage() {
  const [brief, setBrief] = useState<BriefRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchBrief = async () => {
    try {
      const res = await fetch("/api/brief");
      const data = await res.json();
      setBrief(data.run);
      setError(false);
    } catch {
      setError(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBrief();
    const interval = setInterval(fetchBrief, 30000);
    return () => clearInterval(interval);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ─── Loading ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
      </div>
    );
  }

  // ─── Empty state ─────────────────────────────────────────────
  if (!brief) {
    return (
      <div className="max-w-[900px] mx-auto px-8 py-10">
        <motion.h1
          className="text-[36px] font-display tracking-tight mb-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {greeting}
        </motion.h1>
        <motion.p
          className="text-[14px] text-muted-foreground/50 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          No briefings yet. Your morning brief or evening recap will appear here once a workflow runs.
        </motion.p>
      </div>
    );
  }

  // ─── Brief content ──────────────────────────────────────────
  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <BriefLabel name={brief.workflow_name} />

        <h1 className="text-[36px] font-display tracking-tight mt-4 mb-1">
          {greeting}
        </h1>

        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/40 mb-8">
          <span>{formatBriefDate(brief.started_at)}</span>
          <span className="text-muted-foreground/20">·</span>
          <span>{timeAgo(brief.started_at)}</span>
        </div>
      </motion.div>

      {/* Divider */}
      <motion.div
        className="h-px bg-border/60 mb-8"
        initial={{ scaleX: 0, originX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.2, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      />

      {/* Brief body */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="prose-brief"
      >
        <Markdown>{brief.output}</Markdown>
      </motion.div>
    </div>
  );
}
