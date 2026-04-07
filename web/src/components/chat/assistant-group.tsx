import { useState } from "react";
import { motion } from "motion/react";
import { Copy, Check, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import kentIcon from "@/assets/icon.png";
import { ToolCallBlock } from "./tool-call-block";
import { StreamingMarkdown } from "./streaming-markdown";
import { formatMessageTime } from "./format-time";
import type { Message } from "./types";

function getModelLabel(items: Message[]): string | null {
  const first = items.find((m) => m.role === "assistant" && m.metadata);
  if (!first?.metadata) return null;
  try {
    const meta = JSON.parse(first.metadata);
    return meta.model || null;
  } catch { return null; }
}

export function AssistantGroup({ items, streaming }: { items: Message[]; streaming: boolean }) {
  const lastItem = items[items.length - 1]!;
  const hasRunningTool = items.some((m) => m.role === "tool" && m.content.startsWith("Calling "));
  const showLoading = streaming && lastItem.role === "assistant" && !lastItem.content && !hasRunningTool;
  const modelLabel = getModelLabel(items);

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = items
      .filter((m) => m.role === "assistant" && m.content.trim())
      .map((m) => m.content.trim())
      .join("\n\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <motion.div
      key={items[0]!.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group/assistant flex gap-3 py-3"
    >
      <div className="shrink-0 mt-0.5">
        <img src={kentIcon} alt="Kent" className="w-6 h-6 rounded-md" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider" title={modelLabel || undefined}>
            Kent
          </span>
          {items[0]!.created_at > 0 && (
            <span className="text-[10px] text-muted-foreground/30 font-mono tabular-nums">
              {formatMessageTime(items[0]!.created_at)}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover/assistant:opacity-100 transition-opacity duration-150 p-0.5 rounded hover:bg-foreground/[0.06] text-muted-foreground/40 hover:text-muted-foreground/70 cursor-pointer"
            title="Copy message"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
        <div className="mt-1 space-y-1">
          {items.map((msg) => {
            if (msg.role === "tool") {
              let meta: any = null;
              if (msg.metadata) { try { meta = JSON.parse(msg.metadata); } catch {} }
              return <ToolCallBlock key={msg.id} content={msg.content} metadata={meta} />;
            }
            if (!msg.content && msg !== lastItem) return null;
            if (!msg.content && showLoading) return null;
            if (!msg.content) return null;
            const isStreamingThis = streaming && msg === lastItem;
            return (
              <div key={msg.id} className="prose-chat">
                {isStreamingThis ? (
                  <StreamingMarkdown content={msg.content} />
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                )}
              </div>
            );
          })}
          {showLoading && (
            <div className="flex items-center gap-2 py-1">
              <Loader2 size={12} className="animate-spin text-muted-foreground/40" />
              <span className="text-[12px] text-muted-foreground/40">Thinking...</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
