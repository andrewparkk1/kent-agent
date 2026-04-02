import { useState } from "react";
import { motion } from "motion/react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";

export function ToolCallBlock({ content, metadata }: { content: string; metadata?: any }) {
  const [open, setOpen] = useState(false);

  const isRunning = content.startsWith("Calling ");
  const isError = metadata?.error === true;

  let label = "Tool call";
  if (metadata?.name) {
    const argsPreview = metadata.args && Object.keys(metadata.args).length > 0
      ? Object.entries(metadata.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ").slice(0, 60)
      : "";
    label = `${metadata.name}${argsPreview ? `(${argsPreview})` : ""}`;
  } else {
    // No tool name — this is a bare result. Summarize it instead of showing raw content.
    const trimmed = content.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
        label = Array.isArray(parsed) ? `${count} result${count !== 1 ? "s" : ""}` : "result";
      } catch {
        label = "result";
      }
    } else {
      label = content.split("\n")[0]?.slice(0, 80) || "Tool call";
    }
  }

  const statusIcon = isRunning
    ? <Loader2 size={12} className="text-amber-400 animate-spin" />
    : isError
      ? <span className="text-red-400 text-[11px]">✗</span>
      : <span className="text-emerald-500 text-[11px]">✓</span>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-0.5"
    >
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 text-[12px] transition-colors cursor-pointer py-1 ${
          isError ? "text-red-400/70 hover:text-red-400" : "text-muted-foreground/50 hover:text-muted-foreground/70"
        }`}
      >
        {statusIcon}
        <span className="font-mono truncate max-w-[400px]">{label}</span>
        {!isRunning && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </button>
      {open && !isRunning && (
        <pre className={`text-[11px] font-mono whitespace-pre-wrap leading-relaxed mt-1 pl-5 border-l-2 max-h-48 overflow-y-auto ${
          isError ? "text-red-400/50 border-red-500/20" : "text-muted-foreground/40 border-border/30"
        }`}>
          {content}
        </pre>
      )}
    </motion.div>
  );
}
