import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp, User, Loader2, StopCircle, Terminal, ChevronDown, ChevronRight } from "lucide-react";
import Markdown from "react-markdown";
import kentIcon from "@/assets/icon.png";

// ─── Tool Call Block ────────────────────────────────────────────────────────

function ToolCallBlock({ content, metadata }: { content: string; metadata?: any }) {
  const [open, setOpen] = useState(false);

  let label = "Tool call";
  if (metadata?.name) {
    const argsPreview = metadata.args
      ? Object.entries(metadata.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ").slice(0, 60)
      : "";
    label = `${metadata.name}${argsPreview ? `(${argsPreview})` : ""}`;
  } else {
    label = content.split("\n")[0]?.slice(0, 80) || "Tool call";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-1.5 ml-9"
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors cursor-pointer py-1"
      >
        <Terminal size={12} />
        <span className="font-mono truncate max-w-[400px]">{label}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <pre className="text-[11px] text-muted-foreground/40 font-mono whitespace-pre-wrap leading-relaxed mt-1 pl-5 border-l-2 border-border/30 max-h-48 overflow-y-auto">
          {content}
        </pre>
      )}
    </motion.div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: string | null;
  created_at: number;
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage({ threadId: initialThreadId, onThreadCreated }: {
  threadId: string | null;
  onThreadCreated: (id: string) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextIdRef = useRef(Date.now());

  const genId = () => nextIdRef.current++;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load existing thread messages — but skip if we're actively streaming
  // (the thread ID changes mid-stream when a new thread is created)
  useEffect(() => {
    if (streaming) {
      // Just update the thread ID without reloading
      if (initialThreadId) setThreadId(initialThreadId);
      return;
    }
    setThreadId(initialThreadId);
    if (initialThreadId) {
      setLoadingHistory(true);
      fetch(`/api/threads/${initialThreadId}/messages`)
        .then((r) => r.json())
        .then((data) => setMessages(data.messages || []))
        .catch(() => {})
        .finally(() => setLoadingHistory(false));
    } else {
      setMessages([]);
    }
  }, [initialThreadId, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);

    // Add user message immediately
    const userMsg: Message = { id: genId(), role: "user", content: text, created_at: Math.floor(Date.now() / 1000) };
    setMessages((prev) => [...prev, userMsg]);

    // Track the current assistant message ID so we can split on tool calls
    let currentAssistantId = genId();
    let currentText = "";

    // Add initial empty assistant message
    setMessages((prev) => [...prev, { id: currentAssistantId, role: "assistant", content: "", created_at: Math.floor(Date.now() / 1000) }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
      });

      if (!res.ok) throw new Error("Chat request failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.threadId) {
              setThreadId(parsed.threadId);
              onThreadCreated(parsed.threadId);
            }

            if (parsed.tool) {
              // Tool event from stderr — parse it
              try {
                const toolEvent = JSON.parse(parsed.tool);
                if (toolEvent.event === "tool_start") {
                  // Finalize current assistant text (if any) and start fresh after tool
                  if (currentText.trim()) {
                    const finalText = currentText;
                    const finalId = currentAssistantId;
                    setMessages((prev) => prev.map((m) => m.id === finalId ? { ...m, content: finalText } : m));
                  } else {
                    // Remove empty assistant message
                    const emptyId = currentAssistantId;
                    setMessages((prev) => prev.filter((m) => m.id !== emptyId));
                  }

                  // Insert tool call message
                  const toolMsg: Message = {
                    id: genId(),
                    role: "tool",
                    content: `Calling ${toolEvent.name}...`,
                    metadata: JSON.stringify({ name: toolEvent.name, args: toolEvent.args }),
                    created_at: Math.floor(Date.now() / 1000),
                  };
                  setMessages((prev) => [...prev, toolMsg]);

                  // Start new assistant message for post-tool text
                  currentText = "";
                  currentAssistantId = genId();
                  setMessages((prev) => [...prev, { id: currentAssistantId, role: "assistant", content: "", created_at: Math.floor(Date.now() / 1000) }]);
                } else if (toolEvent.event === "tool_end") {
                  // Update the tool message with result
                  setMessages((prev) => {
                    const updated = [...prev];
                    // Find the most recent tool message
                    for (let i = updated.length - 1; i >= 0; i--) {
                      if (updated[i]!.role === "tool" && updated[i]!.content.startsWith("Calling ")) {
                        const meta = updated[i]!.metadata ? JSON.parse(updated[i]!.metadata!) : {};
                        updated[i] = {
                          ...updated[i]!,
                          content: toolEvent.result || "(no output)",
                          metadata: JSON.stringify({ ...meta, error: toolEvent.error }),
                        };
                        break;
                      }
                    }
                    return updated;
                  });
                }
              } catch {
                // Non-JSON stderr, ignore
              }
            }

            if (parsed.delta) {
              currentText += parsed.delta;
              const textNow = currentText;
              const idNow = currentAssistantId;
              setMessages((prev) => prev.map((m) => m.id === idNow ? { ...m, content: textNow } : m));
            }
          } catch {}
        }
      }

      // Clean up trailing empty assistant message
      if (!currentText.trim()) {
        const emptyId = currentAssistantId;
        setMessages((prev) => prev.filter((m) => m.id !== emptyId));
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: "Something went wrong. Please try again." };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0 && !loadingHistory;

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 overflow-y-auto">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-center max-w-md"
            >
              <motion.img
                src={kentIcon}
                alt="Kent"
                className="w-12 h-12 rounded-xl mx-auto mb-6"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, duration: 0.4, type: "spring", stiffness: 200 }}
              />
              <h2 className="text-[20px] font-display text-foreground mb-2">What can I help with?</h2>
              <p className="text-[13px] text-muted-foreground/50 leading-relaxed">
                Ask about your emails, meetings, notes, or anything from your synced sources.
              </p>
            </motion.div>
          </div>
        ) : (
          <div className="max-w-[900px] mx-auto px-6 py-8 space-y-1">
            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                // Tool messages — collapsible block
                if (msg.role === "tool" || msg.role === "system") {
                  let meta: any = null;
                  if (msg.metadata) {
                    try { meta = JSON.parse(msg.metadata); } catch {}
                  }
                  return <ToolCallBlock key={msg.id} content={msg.content} metadata={meta} />;
                }

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="flex gap-3 py-3"
                  >
                    <div className="shrink-0 mt-0.5">
                      {msg.role === "assistant" ? (
                        <img src={kentIcon} alt="Kent" className="w-6 h-6 rounded-md" />
                      ) : (
                        <div className="w-6 h-6 rounded-md bg-foreground/[0.08] flex items-center justify-center">
                          <User size={12} className="text-muted-foreground/60" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                        {msg.role === "assistant" ? "Kent" : "You"}
                      </span>
                      <div className="mt-1">
                        {msg.role === "assistant" && !msg.content && streaming ? (
                          <div className="flex items-center gap-1.5 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "300ms" }} />
                          </div>
                        ) : msg.role === "assistant" ? (
                          <div className="prose-chat">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                        ) : (
                          <p className="text-[14px] leading-[1.7] text-foreground/90 whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className={`w-full ${isEmpty ? "pb-[30vh]" : "pb-6"}`}>
        <div className="max-w-[900px] mx-auto px-6">
          <div
            className="relative bg-background border border-border/70 rounded-2xl shadow-[0_1px_6px_-1px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:border-border/90 transition-shadow duration-300"
          >
            <textarea
              ref={inputRef}
              className="w-full bg-transparent text-[14px] outline-none! ring-0! border-none! shadow-none! placeholder:text-muted-foreground/30 resize-none leading-relaxed max-h-[160px] px-5 pt-4 pb-12 focus:outline-none! focus-visible:outline-none! focus-visible:ring-0!"
              placeholder="Message Kent..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
            />

            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3 pt-1">
              <div />
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={sendMessage}
                disabled={!input.trim() && !streaming}
                className={`h-8 w-8 flex items-center justify-center rounded-lg shrink-0 transition-all duration-200 cursor-pointer ${
                  streaming
                    ? "bg-foreground text-background"
                    : input.trim()
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-foreground/[0.06] text-muted-foreground/30"
                }`}
              >
                {streaming ? <StopCircle size={14} /> : <ArrowUp size={14} strokeWidth={2.5} />}
              </motion.button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/25 text-center mt-3">
            Kent can search your synced data and run workflows
          </p>
        </div>
      </div>
    </div>
  );
}
