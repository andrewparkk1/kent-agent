import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp, Loader2, StopCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import kentIcon from "@/assets/icon.png";
import {
  SystemPromptBlock,
  AssistantGroup,
  MessageBubble,
  type Message,
} from "@/components/chat";

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage({ threadId: initialThreadId, initialInput: initialInputProp, onThreadCreated }: {
  threadId: string | null;
  initialInput?: string;
  onThreadCreated: (id: string) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [queued, setQueued] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextIdRef = useRef(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const genId = () => nextIdRef.current++;

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
  const [workflowName, setWorkflowName] = useState<string | null>(null);

  useEffect(() => {
    if (streaming && initialThreadId && initialThreadId === threadId) return;

    stopStreaming();
    setThreadId(initialThreadId);
    if (initialThreadId) {
      setLoadingHistory(true);
      fetch(`/api/threads/${initialThreadId}/messages`)
        .then((r) => r.json())
        .then((data) => {
          const seenTexts = new Set<string>();
          const msgs: Message[] = (data.messages || []).filter((m: Message, i: number, arr: Message[]) => {
            if (i > 0) {
              const prev = arr[i - 1];
              if (m.role === prev.role && m.content === prev.content) return false;
            }
            if (m.role === "assistant" && m.content.trim()) {
              const text = m.content.trim();
              if (seenTexts.has(text)) return false;
              seenTexts.add(text);
            }
            return true;
          });
          setMessages(msgs);
          setThreadStatus(data.thread?.status ?? null);
          setWorkflowName(data.thread?.workflow_name ?? null);
        })
        .catch(() => { toast.error("Failed to load messages"); })
        .finally(() => setLoadingHistory(false));
    } else {
      setMessages([]);
      setThreadStatus(null);
      setWorkflowName(null);
    }
    if (!initialThreadId && initialInputProp) {
      setInput(initialInputProp);
    }
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

  // ─── Send message + streaming ───────────────────────────────────────

  // Process queued messages after streaming ends
  useEffect(() => {
    if (!streaming && queued.length > 0) {
      const next = queued[0];
      setQueued((q) => q.slice(1));
      // Defer to next tick so streaming state is fully settled
      setTimeout(() => {
        setInput("");
        doSend(next!);
      }, 0);
    }
  }, [streaming, queued]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;

    if (streaming) {
      // Queue the message and show it as a user bubble immediately
      setQueued((q) => [...q, text]);
      setInput("");
      const userMsg: Message = { id: genId(), role: "user", content: text, created_at: Math.floor(Date.now() / 1000) };
      setMessages((prev) => [...prev, userMsg]);
      return;
    }

    setInput("");
    doSend(text);
  };

  const doSend = async (text: string) => {
    setStreaming(true);

    // Only add user bubble if not already added (queued messages add it immediately)
    setMessages((prev) => {
      const alreadyHas = prev.some((m) => m.role === "user" && m.content === text);
      if (alreadyHas) return prev;
      return [...prev, { id: genId(), role: "user", content: text, created_at: Math.floor(Date.now() / 1000) }];
    });

    let currentAssistantId = genId();
    let currentText = "";
    const allFinalizedTexts = new Set<string>();  // Track all finalized text segments to deduplicate

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
              currentText += `\n\n**Error:** ${parsed.error}`;
              const textNow = currentText;
              const idNow = currentAssistantId;
              setMessages((prev) => prev.map((m) => m.id === idNow ? { ...m, content: textNow } : m));
            }

            if (parsed.tool) {
              try {
                const toolEvent = JSON.parse(parsed.tool);
                if (toolEvent.event === "tool_start") {
                  const trimmed = currentText.trim();
                  if (trimmed && !allFinalizedTexts.has(trimmed)) {
                    // New unique text — finalize it
                    allFinalizedTexts.add(trimmed);
                    const finalText = currentText;
                    const finalId = currentAssistantId;
                    setMessages((prev) => prev.map((m) => m.id === finalId ? { ...m, content: finalText } : m));
                  } else {
                    // Empty or duplicate text from parallel tool responses — remove it
                    const emptyId = currentAssistantId;
                    setMessages((prev) => prev.filter((m) => m.id !== emptyId));
                  }

                  const toolMsg: Message = {
                    id: genId(),
                    role: "tool",
                    content: `Calling ${toolEvent.name}...`,
                    metadata: JSON.stringify({ name: toolEvent.name, args: toolEvent.args }),
                    created_at: Math.floor(Date.now() / 1000),
                  };
                  setMessages((prev) => [...prev, toolMsg]);

                  currentText = "";
                  currentAssistantId = genId();
                  setMessages((prev) => [...prev, { id: currentAssistantId, role: "assistant", content: "", created_at: Math.floor(Date.now() / 1000) }]);
                } else if (toolEvent.event === "tool_end") {
                  setMessages((prev) => {
                    const updated = [...prev];
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
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (!currentText.trim()) {
          const emptyId = currentAssistantId;
          setMessages((prev) => prev.filter((m) => m.id !== emptyId));
        }
      } else {
        toast.error("Something went wrong. Please try again.");
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

      // Notify when done (only if tab/window is not focused)
      if (document.hidden) {
        const preview = currentText.trim().slice(0, 80).replace(/\n/g, " ");
        toast(preview || "Done", {
          description: preview ? "Kent finished" : "Kent finished responding",
          duration: 4000,
          icon: <img src={kentIcon} alt="" className="w-5 h-5 rounded-md" />,
        });

        // Native notification in Tauri desktop app
        if ((window as any).__TAURI__) {
          import("@tauri-apps/plugin-notification")
            .then(({ sendNotification }) => sendNotification({ title: "Kent", body: preview || "Finished responding" }))
            .catch(() => {});
        }
      }

      // Reload messages from DB to pick up system prompt + any agent-saved messages
      if (threadId) {
        try {
          const res = await fetch(`/api/threads/${threadId}/messages`);
          const data = await res.json();
          // Deduplicate: remove assistant messages with identical content (even if separated by tool messages)
          const seenAssistantTexts = new Set<string>();
          const msgs: Message[] = (data.messages || []).filter((m: Message, i: number, arr: Message[]) => {
            // Consecutive same-role same-content dedup
            if (i > 0) {
              const prev = arr[i - 1];
              if (m.role === prev.role && m.content === prev.content) return false;
            }
            // Assistant text dedup across entire thread
            if (m.role === "assistant" && m.content.trim()) {
              const text = m.content.trim();
              if (seenAssistantTexts.has(text)) return false;
              seenAssistantTexts.add(text);
            }
            return true;
          });
          if (msgs.length > 0) setMessages(msgs);
        } catch {
          toast.error("Failed to reload messages");
        }
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
    "Create a skill for ",
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
            {workflowName && (
              <div className="flex items-center gap-1.5 mb-3 px-1">
                <Zap size={12} className="text-amber-500/70" />
                <span className="text-[12px] text-muted-foreground/50">
                  from <span className="text-muted-foreground/70 font-medium">{workflowName}</span>
                </span>
              </div>
            )}
            {messages.filter((m) => m.role === "system").map((msg) => (
              <SystemPromptBlock key={msg.id} content={msg.content} />
            ))}
            <AnimatePresence initial={false}>
              {(() => {
                const nonSystem = messages.filter((m) => m.role !== "system");
                const elements: React.ReactNode[] = [];
                let i = 0;
                while (i < nonSystem.length) {
                  const msg = nonSystem[i]!;
                  if (msg.role === "user") {
                    elements.push(<MessageBubble key={msg.id} msg={msg} />);
                    i++;
                  } else if (msg.role === "assistant" || msg.role === "tool") {
                    // Gather consecutive assistant + tool messages into one Kent group
                    const groupItems: Message[] = [msg];
                    let j = i + 1;
                    while (j < nonSystem.length && (nonSystem[j]!.role === "tool" || nonSystem[j]!.role === "assistant")) {
                      groupItems.push(nonSystem[j]!);
                      j++;
                    }
                    elements.push(
                      <AssistantGroup key={msg.id} items={groupItems} streaming={streaming && j >= nonSystem.length} />
                    );
                    i = j;
                  } else {
                    i++;
                  }
                }
                return elements;
              })()}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className={`w-full ${isEmpty ? "pb-[30vh]" : "pt-4 pb-6"}`}>
        <div className="max-w-[680px] mx-auto px-6">
          <div
            className="relative bg-background border border-border/70 rounded-2xl shadow-[0_1px_6px_-1px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] focus-within:border-border/90 transition-shadow duration-300"
          >
            <textarea
              ref={inputRef}
              className="w-full bg-transparent text-[14px] outline-none! ring-0! border-none! shadow-none! placeholder:text-muted-foreground/30 resize-none leading-normal max-h-[160px] px-5 py-3 focus:outline-none! focus-visible:outline-none! focus-visible:ring-0!"
              placeholder={busy ? (queued.length > 0 ? `${queued.length} queued · Message Kent...` : "Kent is working... type to queue") : "Message Kent..."}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-1.5">
                {queued.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">{queued.length} queued</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {streaming && (
                  <motion.button
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={stopStreaming}
                    title="Stop generating (Esc)"
                    className="h-8 w-8 flex items-center justify-center rounded-lg bg-foreground/[0.06] hover:bg-foreground/[0.1] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <StopCircle size={14} />
                  </motion.button>
                )}
                {!streaming && busy ? (
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
          </div>

          <p className="text-[11px] text-muted-foreground/25 text-center mt-3">
            Search your data, run commands, manage workflows, and more
          </p>
        </div>
      </div>
    </div>
  );
}
