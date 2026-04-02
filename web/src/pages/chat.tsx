import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp, User, Loader2, StopCircle, Terminal, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import Markdown from "react-markdown";
import kentIcon from "@/assets/icon.png";

// ─── System Prompt Block ───────────────────────────────────────────────────

function SystemPromptBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer py-1.5 px-3 rounded-lg bg-foreground/[0.02] border border-border/30 hover:border-border/50 w-full"
      >
        <Settings2 size={12} />
        <span className="font-medium">System Prompt</span>
        <span className="ml-auto">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="mt-2 text-[11px] text-muted-foreground/50 leading-relaxed px-3 py-3 bg-foreground/[0.02] border border-border/20 rounded-lg max-h-[400px] overflow-y-auto prose-chat prose-sm">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  );
}

// ─── Tool Call Block ────────────────────────────────────────────────────────

function ToolCallBlock({ content, metadata }: { content: string; metadata?: any }) {
  const [open, setOpen] = useState(false);

  const isRunning = content.startsWith("Calling ");
  const isError = metadata?.error === true;
  const isDone = !isRunning && !isError;

  let label = "Tool call";
  if (metadata?.name) {
    const argsPreview = metadata.args
      ? Object.entries(metadata.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ").slice(0, 60)
      : "";
    label = `${metadata.name}${argsPreview ? `(${argsPreview})` : ""}`;
  } else {
    label = content.split("\n")[0]?.slice(0, 80) || "Tool call";
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
      className="my-1.5 ml-9"
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

// ─── Streaming Markdown — throttles re-parsing to every 150ms ──────────────

function StreamingMarkdown({ content }: { content: string }) {
  const [rendered, setRendered] = useState(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(content);
  latestRef.current = content;

  useEffect(() => {
    // If no timer is pending, update immediately and start a cooldown
    if (!timerRef.current) {
      setRendered(content);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Flush any content that arrived during the cooldown
        setRendered(latestRef.current);
      }, 150);
    }
    // Cleanup on unmount
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [content]);

  // On stream end (content stabilizes), ensure final flush
  useEffect(() => {
    return () => { setRendered(latestRef.current); };
  }, []);

  return <Markdown>{rendered}</Markdown>;
}

// ─── Message Bubble (memoized to avoid re-parsing Markdown on every delta) ──

const MessageBubble = memo(function MessageBubble({ msg, streaming }: { msg: Message; streaming: boolean }) {
  const isStreamingThis = streaming && msg.role === "assistant";

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
          ) : (
            <div className="prose-chat">
              {isStreamingThis ? (
                <StreamingMarkdown content={msg.content} />
              ) : (
                <Markdown>{msg.content}</Markdown>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

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
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<((prev: Message[]) => Message[]) | null>(null);

  const genId = () => nextIdRef.current++;

  // Batched state update — coalesces rapid setMessages calls into one per frame
  const scheduleUpdate = useCallback((updater: (prev: Message[]) => Message[]) => {
    pendingUpdateRef.current = updater;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingUpdateRef.current) {
          setMessages(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
      });
    }
  }, []);

  const scrollToBottom = useCallback((instant?: boolean) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(streaming); }, [messages, scrollToBottom, streaming]);

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreaming(false);
  }, []);

  // Escape key stops streaming
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && streaming) {
        e.preventDefault();
        stopStreaming();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [streaming, stopStreaming]);

  // Load existing thread messages — abort streaming if thread changes
  const [threadStatus, setThreadStatus] = useState<string | null>(null);

  useEffect(() => {
    // Skip if we're actively streaming on this exact thread (e.g. new thread
    // was just created by the current stream — don't abort ourselves)
    if (streaming && initialThreadId && initialThreadId === threadId) return;

    // User navigated to a different thread — abort current stream
    stopStreaming();
    setThreadId(initialThreadId);
    if (initialThreadId) {
      setLoadingHistory(true);
      fetch(`/api/threads/${initialThreadId}/messages`)
        .then((r) => r.json())
        .then((data) => {
          // Deduplicate consecutive messages with same role+content (agent can double-save)
          const msgs: Message[] = (data.messages || []).filter((m: Message, i: number, arr: Message[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return !(m.role === prev.role && m.content === prev.content);
          });
          setMessages(msgs);
          setThreadStatus(data.thread?.status ?? null);
        })
        .catch(() => {})
        .finally(() => setLoadingHistory(false));
    } else {
      setMessages([]);
      setThreadStatus(null);
    }
    // Focus input whenever thread changes (new chat or switching threads)
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [initialThreadId]);

  // Poll for new messages when viewing a running workflow thread
  useEffect(() => {
    if (!threadId || streaming || threadStatus !== "running") return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/threads/${threadId}/messages`);
        const data = await res.json();
        setMessages(data.messages || []);
        if (data.thread?.status !== "running") {
          setThreadStatus(data.thread?.status ?? null);
          clearInterval(poll);
        }
      } catch {}
    }, 1000);

    return () => clearInterval(poll);
  }, [threadId, streaming, threadStatus]);

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

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
        signal: abort.signal,
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

            if (parsed.error) {
              // Error event from server
              currentText += `\n\n**Error:** ${parsed.error}`;
              const textNow = currentText;
              const idNow = currentAssistantId;
              setMessages((prev) => prev.map((m) => m.id === idNow ? { ...m, content: textNow } : m));
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
                // Non-JSON stderr — likely an agent crash/error message
                const raw = parsed.tool.trim();
                if (raw && (raw.includes("error") || raw.includes("Error") || raw.includes("fatal") || raw.includes("401") || raw.includes("403"))) {
                  currentText += `\n\n**Error:** ${raw.slice(0, 500)}`;
                  const textNow = currentText;
                  const idNow = currentAssistantId;
                  setMessages((prev) => prev.map((m) => m.id === idNow ? { ...m, content: textNow } : m));
                }
              }
            }

            if (parsed.delta) {
              currentText += parsed.delta;
              const textNow = currentText;
              const idNow = currentAssistantId;
              scheduleUpdate((prev) => prev.map((m) => m.id === idNow ? { ...m, content: textNow } : m));
            }
          } catch {}
        }
      }

      // Flush any pending RAF update before final cleanup
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pendingUpdateRef.current) { setMessages(pendingUpdateRef.current); pendingUpdateRef.current = null; }

      // Clean up trailing empty assistant message
      if (!currentText.trim()) {
        const emptyId = currentAssistantId;
        setMessages((prev) => prev.filter((m) => m.id !== emptyId));
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // User cancelled — clean up empty trailing assistant message
        if (!currentText.trim()) {
          const emptyId = currentAssistantId;
          setMessages((prev) => prev.filter((m) => m.id !== emptyId));
        }
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: "Something went wrong. Please try again." };
          }
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);

      // Reload messages from DB to pick up system prompt + any agent-saved messages
      if (threadId) {
        try {
          const res = await fetch(`/api/threads/${threadId}/messages`);
          const data = await res.json();
          const msgs: Message[] = (data.messages || []).filter((m: Message, i: number, arr: Message[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return !(m.role === prev.role && m.content === prev.content);
          });
          if (msgs.length > 0) setMessages(msgs);
        } catch {}
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const busy = streaming || threadStatus === "running";
  const isEmpty = messages.length === 0 && !loadingHistory;

  // Fetch workflow names for suggestions
  const [workflowNames, setWorkflowNames] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data) => {
        const names = (data.workflows || [])
          .filter((w: any) => w.is_active && !w.is_archived)
          .map((w: any) => w.name as string);
        setWorkflowNames(names);
      })
      .catch(() => {});
  }, []);

  const suggestions = [
    "Create a workflow that ",
    ...(workflowNames.length > 0
      ? [`Edit my ${workflowNames[0]} workflow `]
      : []),
    "Update my identity.md ",
    "Summarize my day so far ",
    "What emails need a reply? ",
  ];

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 overflow-y-auto">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-end pb-8 h-full px-6">
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

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="flex flex-wrap justify-center gap-2 mt-6 max-w-lg"
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 text-[12px] text-muted-foreground/60 bg-foreground/[0.03] border border-border/50 rounded-full hover:bg-foreground/[0.06] hover:text-muted-foreground/80 hover:border-border/70 transition-all cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </motion.div>
          </div>
        ) : (
          <div className="max-w-[900px] mx-auto px-6 py-8 space-y-1">
            {/* System prompts always render first */}
            {messages.filter((m) => m.role === "system").map((msg) => (
              <SystemPromptBlock key={msg.id} content={msg.content} />
            ))}
            <AnimatePresence initial={false}>
              {messages.filter((m) => m.role !== "system").map((msg) => {
                if (msg.role === "tool") {
                  let meta: any = null;
                  if (msg.metadata) {
                    try { meta = JSON.parse(msg.metadata); } catch {}
                  }
                  return <ToolCallBlock key={msg.id} content={msg.content} metadata={meta} />;
                }

                return <MessageBubble key={msg.id} msg={msg} streaming={streaming} />;
              })}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className={`w-full ${isEmpty ? "pb-[30vh]" : "pb-6"}`}>
        <div className="max-w-[680px] mx-auto px-6">
          <div
            className="relative bg-background border border-border/70 rounded-2xl shadow-[0_1px_6px_-1px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:border-border/90 transition-shadow duration-300"
          >
            <textarea
              ref={inputRef}
              className="w-full bg-transparent text-[14px] outline-none! ring-0! border-none! shadow-none! placeholder:text-muted-foreground/30 resize-none leading-relaxed max-h-[160px] px-5 pt-4 pb-12 focus:outline-none! focus-visible:outline-none! focus-visible:ring-0!"
              placeholder={busy ? "Kent is working..." : "Message Kent..."}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy}
            />

            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3 pt-1">
              <div />
              {streaming ? (
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={stopStreaming}
                  title="Stop generating (Esc)"
                  className="h-8 w-8 flex items-center justify-center rounded-lg bg-foreground/[0.06] hover:bg-foreground/[0.1] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer"
                >
                  <StopCircle size={14} />
                </motion.button>
              ) : busy ? (
                <div className="h-8 w-8 flex items-center justify-center">
                  <Loader2 size={14} className="text-muted-foreground/40 animate-spin" />
                </div>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg shrink-0 transition-all duration-200 cursor-pointer ${
                    input.trim()
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-foreground/[0.06] text-muted-foreground/30"
                  }`}
                >
                  <ArrowUp size={14} strokeWidth={2.5} />
                </motion.button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/25 text-center mt-3">
            Search your data, run commands, manage workflows, and more
          </p>
        </div>
      </div>
    </div>
  );
}
