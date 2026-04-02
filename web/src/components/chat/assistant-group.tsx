import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import kentIcon from "@/assets/icon.png";
import { ToolCallBlock } from "./tool-call-block";
import { StreamingMarkdown } from "./streaming-markdown";
import type { Message } from "./types";

export function AssistantGroup({ items, streaming }: { items: Message[]; streaming: boolean }) {
  const lastItem = items[items.length - 1]!;
  const showLoading = streaming && lastItem.role === "assistant" && !lastItem.content;
  const hasRunningTool = items.some((m) => m.role === "tool" && m.content.startsWith("Calling "));

  return (
    <motion.div
      key={items[0]!.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex gap-3 py-3"
    >
      <div className="shrink-0 mt-0.5">
        <img src={kentIcon} alt="Kent" className="w-6 h-6 rounded-md" />
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
          Kent
        </span>
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
                  <Markdown>{msg.content}</Markdown>
                )}
              </div>
            );
          })}
          {showLoading && (
            <div className="flex items-center gap-1.5 py-1">
              {hasRunningTool ? (
                <span className="text-[11px] text-muted-foreground/30 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                </span>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "300ms" }} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
