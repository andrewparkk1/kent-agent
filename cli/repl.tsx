import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import Spinner from "ink-spinner";
import { loadConfig, saveConfig } from "@shared/config.ts";
import { getRunner } from "@daemon/runner.ts";
import {
  createThread,
  getRecentThreads,
  getMessages as dbGetMessages,
  addMessage as dbAddMessage,
  getItemCount,
} from "@shared/db.ts";
import type { Config } from "@shared/config.ts";
import type { BaseRunner } from "@daemon/runner-base.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCallState {
  name: string;
  args: string;
  status: "running" | "done" | "error";
  result?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallState[];
  duration?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UI = {
  fg: "white",
  muted: "gray",
  accent: "cyan",
  info: "blue",
  success: "green",
  warning: "yellow",
  danger: "red",
} as const;

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

function getTermWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function humanizeToolName(name: string): string {
  const normalized = name.replace(/[_-]+/g, " ").trim().toLowerCase();
  switch (normalized) {
    case "read file":
      return "Read file";
    case "search":
      return "Search";
    case "run command":
    case "run terminal cmd":
      return "Run command";
    default:
      return normalized
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(" ");
  }
}

// ─── WelcomeHeader ──────────────────────────────────────────────────────────

function WelcomeHeader({ config }: { config: Config }) {
  const model = config.agent.default_model;
  const sources = Object.entries(config.sources)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const width = Math.max(30, Math.min(getTermWidth() - 2, 96));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={UI.fg} bold>Kent</Text>
        <Text color={UI.muted}>{"  ·  "}{model}</Text>
      </Box>
      <Box>
        <Text color={UI.muted}>
          {sources.length > 0 ? `sources: ${sources.join(", ")}` : "sources: none enabled"}
        </Text>
      </Box>
      <Box>
        <Text color={UI.muted}>
          {"Enter to send  ·  Ctrl+C to cancel  ·  "}
          <Text color={UI.fg}>/help</Text>
        </Text>
      </Box>
      <Box>
        <Text color={UI.muted}>{"─".repeat(width)}</Text>
      </Box>
    </Box>
  );
}

// ─── Tool Call Display ──────────────────────────────────────────────────────

/** Format tool args into a concise one-liner. */
function formatToolArgs(name: string, argsJson: string): string {
  try {
    const a = JSON.parse(argsJson);
    switch (name) {
      case "search_memory":
        return a.query + (a.source ? ` (${a.source})` : "");
      case "get_recent_items":
        return a.source ? `source=${a.source}` : "all sources";
      case "get_source_stats":
        return "";
      case "read_file":
        return a.path?.replace(/^\/Users\/[^/]+/, "~") ?? a.path;
      case "list_directory":
        return a.path?.replace(/^\/Users\/[^/]+/, "~") ?? a.path;
      case "search_files":
        return `/${a.pattern}/` + (a.glob ? ` ${a.glob}` : "") + (a.path ? ` in ${a.path.replace(/^\/Users\/[^/]+/, "~")}` : "");
      case "write_file":
        return a.path;
      case "run_command":
        return truncate(a.command, 70);
      default:
        if (a.query) return a.query;
        if (a.path) return a.path;
        if (a.command) return truncate(a.command, 70);
        return truncate(argsJson, 60);
    }
  } catch {
    return truncate(argsJson, 60);
  }
}

/** Summarize a tool result into compact display lines. */
function formatToolResult(name: string, result: string, maxLines: number = 4): string[] {
  if (!result) return [];
  const raw = result.trim();
  if (!raw) return [];

  // For JSON array results (search_memory, get_recent_items), count + preview
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const lines: string[] = [`${arr.length} result${arr.length === 1 ? "" : "s"}`];
        for (const item of arr.slice(0, maxLines - 1)) {
          const label = item.metadata?.subject
            ?? item.metadata?.title
            ?? item.metadata?.summary
            ?? (item.content ? truncate(item.content.split("\n")[0] ?? "", 80) : "");
          if (label) {
            const src = item.source ? `[${item.source}] ` : "";
            lines.push(`  ${src}${truncate(label, 75)}`);
          }
        }
        if (arr.length > maxLines - 1) lines.push(`  … and ${arr.length - (maxLines - 1)} more`);
        return lines;
      }
    } catch {}
  }

  // For JSON object results (get_source_stats), format as key: value
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      if (typeof obj === "object" && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length <= maxLines) {
          return entries.map(([k, v]) => `  ${k}: ${v}`);
        }
        const lines = entries.slice(0, maxLines - 1).map(([k, v]) => `  ${k}: ${v}`);
        lines.push(`  … and ${entries.length - (maxLines - 1)} more`);
        return lines;
      }
    } catch {}
  }

  // For plain text (file contents, command output), show first few lines
  const textLines = raw.split("\n").filter(Boolean);
  if (textLines.length <= maxLines) {
    return textLines.map((l) => `  ${truncate(l, 80)}`);
  }
  const lines = textLines.slice(0, maxLines - 1).map((l) => `  ${truncate(l, 80)}`);
  lines.push(`  … ${textLines.length - (maxLines - 1)} more lines`);
  return lines;
}

function ToolCallLine({ tool, expanded }: { tool: ToolCallState; expanded?: boolean }) {
  const icon: React.ReactNode =
    tool.status === "running" ? (
      <Text color={UI.accent}><Spinner type="dots" /></Text>
    ) : tool.status === "error" ? (
      <Text color={UI.danger}>{"✕"}</Text>
    ) : (
      <Text color={UI.success}>{"✓"}</Text>
    );

  const nameColor =
    tool.status === "error" ? UI.danger : tool.status === "running" ? UI.accent : UI.muted;

  const argStr = formatToolArgs(tool.name, tool.args);
  const showResult = expanded !== false && tool.status !== "running" && tool.result;
  const resultLines = showResult ? formatToolResult(tool.name, tool.result!, 4) : [];

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {icon}
        <Text color={nameColor} bold={tool.status === "running"}>
          {humanizeToolName(tool.name)}
        </Text>
        {argStr ? <Text color={UI.muted}>{argStr}</Text> : null}
      </Box>
      {resultLines.length > 0 && (
        <Box flexDirection="column" paddingLeft={3}>
          {resultLines.map((line, i) => (
            <Text key={i} color={UI.muted}>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ToolCallsBlock({ tools }: { tools: ToolCallState[] }) {
  if (tools.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {tools.map((tool, i) => (
        <ToolCallLine key={`${tool.name}-${i}`} tool={tool} />
      ))}
    </Box>
  );
}

// ─── Active Tool Indicator (during streaming) ───────────────────────────────

function ActiveToolIndicator({ tools }: { tools: ToolCallState[] }) {
  if (tools.length === 0) return null;

  // Show all completed tools with results, plus the running one
  const completed = tools.filter((t) => t.status !== "running");
  const running = tools.filter((t) => t.status === "running");

  return (
    <Box flexDirection="column" marginTop={1}>
      {completed.map((tool, i) => (
        <ToolCallLine key={`done-${tool.name}-${i}`} tool={tool} />
      ))}
      {running.map((tool, i) => (
        <ToolCallLine key={`run-${tool.name}-${i}`} tool={tool} />
      ))}
    </Box>
  );
}

// ─── Markdown Renderer ──────────────────────────────────────────────────────

function renderMarkdownLine(line: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      elements.push(<Text key={key++}>{line.slice(lastIndex, match.index)}</Text>);
    }
    if (match[2]) {
      elements.push(<Text key={key++} bold italic>{match[2]}</Text>);
    } else if (match[3]) {
      elements.push(<Text key={key++} bold>{match[3]}</Text>);
    } else if (match[4]) {
      elements.push(<Text key={key++} bold>{match[4]}</Text>);
    } else if (match[5]) {
      elements.push(<Text key={key++} italic>{match[5]}</Text>);
    } else if (match[6]) {
      elements.push(<Text key={key++} italic>{match[6]}</Text>);
    } else if (match[7]) {
      elements.push(
        <Text key={key++} color="cyan" backgroundColor="#1a1a2e">{" "}{match[7]}{" "}</Text>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    elements.push(<Text key={key++}>{line.slice(lastIndex)}</Text>);
  }

  return elements.length > 0 ? elements : [<Text key={0}>{line}</Text>];
}

function MarkdownText({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <Box key={key++} flexDirection="column" marginY={0} paddingLeft={1}>
            {codeLang && (
              <Text dimColor color="blue">{`  ${codeLang}`}</Text>
            )}
            <Box flexDirection="column" paddingLeft={1}>
              {codeLines.map((cl, i) => (
              <Text key={i} color={UI.accent}>{cl}</Text>
            ))}
          </Box>
        </Box>
      );
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(
        <Box key={key++} marginTop={1}>
          <Text bold color="blue">{"   "}{line.slice(4)}</Text>
          
        </Box>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <Box key={key++} marginTop={1}>
          <Text bold color="blue">{"   "}{line.slice(3)}</Text>
        </Box>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <Box key={key++} marginTop={1}>
          <Text bold color="blue">{"   "}{line.slice(2)}</Text>
        </Box>
      );
    } else if (line.match(/^\s*[-]\s/) || line.match(/^\s*\*\s[^*]/)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      const text = line.replace(/^\s*[-*]\s/, "");
      elements.push(
        <Box key={key++} paddingLeft={indent + 2}>
          <Text color={UI.muted}>{"• "}</Text>
          <Text>{renderMarkdownLine(text)}</Text>
        </Box>
      );
    } else if (line.match(/^\s*\d+\.\s/)) {
      const m = line.match(/^(\s*)(\d+)\.\s(.*)/);
      if (m) {
        elements.push(
          <Box key={key++} paddingLeft={(m[1]?.length ?? 0) + 2}>
            <Text color={UI.muted}>{m[2]}. </Text>
            <Text>{renderMarkdownLine(m[3] || "")}</Text>
          </Box>
        );
      }
    } else if (line.match(/^---+$/)) {
      elements.push(
        <Box key={key++} marginY={0}>
          <Text color={UI.muted}>{"─".repeat(Math.min(getTermWidth() - 2, 72))}</Text>
        </Box>
      );
    } else if (line.startsWith("> ")) {
      elements.push(
        <Box key={key++} paddingLeft={0}>
          <Text color={UI.muted}>{"│ "}</Text>
          <Text italic color={UI.muted}>{renderMarkdownLine(line.slice(2))}</Text>
        </Box>
      );
    } else if (line.trim() === "") {
      elements.push(<Box key={key++}><Text>{" "}</Text></Box>);
    } else {
      elements.push(
        <Box key={key++} paddingLeft={0}>
          <Text>{renderMarkdownLine(line)}</Text>
        </Box>
      );
    }
  }

  return <Box flexDirection="column">{elements}</Box>;
}

// ─── MessageView ────────────────────────────────────────────────────────────

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color={UI.fg} bold>{"› "}</Text>
        <Text color={UI.fg}>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "system") {
    return (
      <Box marginTop={0}>
        <Text color={UI.muted} italic>
          {message.content}
        </Text>
      </Box>
    );
  }

  // Assistant message
  return (
    <Box marginTop={1} flexDirection="column">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginBottom={0} marginTop={0}>
          <ToolCallsBlock tools={message.toolCalls} />
        </Box>
      )}

      {message.content && (
        <Box flexDirection="column">
          <MarkdownText content={message.content} />
        </Box>
      )}

      {message.duration !== undefined && (
        <Box marginTop={0}>
          <Text color={UI.muted}>{"· "}{formatDuration(message.duration)}</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── MessageList ────────────────────────────────────────────────────────────

function MessageList({
  messages,
  headerConfig,
}: {
  messages: Message[];
  headerConfig: Config | null;
}) {
  const items = headerConfig
    ? [{ id: "__header__", role: "system" as const, content: "" }, ...messages]
    : messages;

  return (
    <Static items={items}>
      {(message) => {
        if (message.id === "__header__" && headerConfig) {
          return (
            <Box key="__header__" flexDirection="column">
              <WelcomeHeader config={headerConfig} />
            </Box>
          );
        }
        return (
          <Box key={message.id} flexDirection="column">
            <MessageView message={message as Message} />
          </Box>
        );
      }}
    </Static>
  );
}

// ─── StreamingOutput ────────────────────────────────────────────────────────

function StreamingOutput({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Box marginTop={1} flexDirection="column">
      <MarkdownText content={text} />
    </Box>
  );
}

// ─── InputArea ──────────────────────────────────────────────────────────────

function InputArea({
  input,
  isStreaming,
}: {
  input: string;
  isStreaming: boolean;
}) {
  if (isStreaming) {
    return (
      <Box marginTop={1}>
        <Text color={UI.muted}>
          <Spinner type="dots" />
        </Text>
        <Text color={UI.muted}>
          {"  thinking…"}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text color={UI.fg} bold>{"› "}</Text>
      <Text color={UI.fg}>{input}</Text>
      <Text color={UI.muted}>{"█"}</Text>
    </Box>
  );
}

// ─── Help text ──────────────────────────────────────────────────────────────

const HELP_TEXT = `
  Slash commands:
    /sync [source]          Trigger a sync
    /status                 Show daemon & data status
    /threads                List recent threads
    /thread new             Start a new thread
    /thread <number>        Switch to thread
    /model <name>           Switch model
    /clear                  Clear history
    /history                Show past prompts
    /help                   Show this help
    /exit                   Quit`;

// ─── Tool Event Parser ──────────────────────────────────────────────────────

interface ToolEvent {
  name: string;
  type: "start" | "end" | "error";
  args: string;
  result?: string;
}

function parseToolEvent(raw: string): ToolEvent | null {
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    const trimmed = line.trim();

    // Try new JSON protocol first
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj.event === "tool_start") {
          return {
            name: obj.name,
            type: "start",
            args: typeof obj.args === "string" ? obj.args : JSON.stringify(obj.args ?? {}),
          };
        }
        if (obj.event === "tool_end") {
          return {
            name: obj.name,
            type: obj.error ? "error" : "end",
            args: "",
            result: obj.result ?? "",
          };
        }
      } catch {}
    }

    // Fallback: legacy bracket protocol
    const doneMatch = trimmed.match(/^\[([\w_]+)\]\s+done$/);
    if (doneMatch) {
      return { name: doneMatch[1]!, type: "end", args: "" };
    }

    const errorMatch = trimmed.match(/^\[([\w_]+)\]\s+ERROR$/);
    if (errorMatch) {
      return { name: errorMatch[1]!, type: "error", args: "" };
    }

    const startMatch = trimmed.match(/^\[([\w_]+)\]\s+(.*)/);
    if (startMatch) {
      return { name: startMatch[1]!, type: "start", args: startMatch[2] || "" };
    }
  }
  return null;
}

// ─── Main App ───────────────────────────────────────────────────────────────

function App({
  initialConfig,
  initialRunner,
}: {
  initialConfig: Config;
  initialRunner: BaseRunner;
}) {
  const { exit } = useApp();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [activeTools, setActiveTools] = useState<ToolCallState[]>([]);
  const [config, setConfig] = useState(initialConfig);

  const runnerRef = useRef<BaseRunner>(initialRunner);
  const abortRef = useRef<AbortController | null>(null);
  const promptHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const conversationRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const threadIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCallState[]>([]);
  const startTimeRef = useRef<number>(0);

  // Initialize thread on mount
  useEffect(() => {
    const recent = getRecentThreads(1);
    if (recent.length > 0) {
      const latest = recent[0]!;
      const hoursSince = (Date.now() / 1000 - latest.last_message_at) / 3600;
      if (hoursSince < 24) {
        threadIdRef.current = latest.id;
        const msgs = dbGetMessages(latest.id);
        const history = msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
        conversationRef.current = history;
        if (history.length > 0) {
          for (const m of history) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: m.role, content: m.content },
            ]);
          }
        }
        const title = latest.title || "(untitled)";
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "system", content: `Resumed: ${title} (${history.length} messages)` },
        ]);
      } else {
        threadIdRef.current = createThread();
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "system", content: "New thread started." },
        ]);
      }
    } else {
      threadIdRef.current = createThread();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "system", content: "New thread started." },
      ]);
    }
  }, []);

  const addMessage = useCallback(
    (role: Message["role"], content: string, extra?: Partial<Message>) => {
      const msg: Message = { id: nextId(), role, content, ...extra };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    [],
  );

  // ─── Slash command handler ───────────────────────────────────────────

  const handleSlashCommand = useCallback(
    async (text: string) => {
      const parts = text.trim().split(/\s+/);
      const cmd = parts[0]!.toLowerCase();

      switch (cmd) {
        case "/exit":
        case "/quit": {
          await runnerRef.current.kill().catch(() => {});
          exit();
          return;
        }

        case "/help": {
          addMessage("system", HELP_TEXT);
          return;
        }

        case "/clear": {
          conversationRef.current = [];
          threadIdRef.current = createThread();
          setMessages([]);
          addMessage("system", "Conversation cleared, new thread started.");
          return;
        }

        case "/history": {
          const history = promptHistoryRef.current;
          if (history.length === 0) {
            addMessage("system", "No prompt history.");
          } else {
            const lines = history
              .map((p, i) => {
                const display =
                  p.length > 80 ? p.slice(0, 77) + "..." : p;
                return `  ${i + 1}. ${display}`;
              })
              .join("\n");
            addMessage("system", `Prompt history:\n${lines}`);
          }
          return;
        }

        case "/sync": {
          const source = parts[1];
          addMessage(
            "system",
            source
              ? `Syncing ${source}...`
              : "Syncing all sources...",
          );
          try {
            const { handleSync } = await import("@cli/commands/sync.ts");
            const originalExit = process.exit;
            process.exit = (() => {}) as never;
            try {
              await handleSync(source ? ["--source", source] : []);
            } finally {
              process.exit = originalExit;
            }
            addMessage("system", "Sync complete.");
          } catch {
            addMessage("system", "Sync failed.");
          }
          return;
        }

        case "/status": {
          const { existsSync, readFileSync } = await import("node:fs");
          const { PID_PATH } = await import("@shared/config.ts");

          let daemonStatus = "not running";
          if (existsSync(PID_PATH)) {
            const pid = readFileSync(PID_PATH, "utf-8").trim();
            try {
              process.kill(Number(pid), 0);
              daemonStatus = `running (PID ${pid})`;
            } catch {
              daemonStatus = `stale PID (${pid})`;
            }
          }

          const sources = Object.entries(config.sources);
          const enabled = sources
            .filter(([, v]) => v)
            .map(([k]) => k);
          const disabled = sources
            .filter(([, v]) => !v)
            .map(([k]) => k);

          const counts = getItemCount();
          const countLines = Object.entries(counts)
            .map(([source, count]) => `    ${source}: ${count}`)
            .join("\n");

          addMessage(
            "system",
            [
              `Daemon:   ${daemonStatus}`,
              `Model:    ${config.agent.default_model}`,
              `Sync:     every ${config.daemon.sync_interval_minutes}m`,
              `Sources (on):  ${enabled.length > 0 ? enabled.join(", ") : "none"}`,
              `Sources (off): ${disabled.length > 0 ? disabled.join(", ") : "none"}`,
              Object.keys(counts).length > 0 ? `Data:\n${countLines}` : "Data: (empty)",
            ].join("\n"),
          );
          return;
        }

        case "/threads": {
          const recentThreads = getRecentThreads(10);
          if (recentThreads.length === 0) {
            addMessage("system", "No threads yet.");
          } else {
            const lines = recentThreads.map((t, i) => {
              const active = threadIdRef.current === t.id ? " ←" : "";
              const title = t.title || "(untitled)";
              const date = new Date(t.last_message_at * 1000).toLocaleDateString();
              return `  ${i + 1}. ${title}  (${date})${active}`;
            });
            addMessage(
              "system",
              `Recent threads:\n${lines.join("\n")}\n\n  /thread <number> to switch, /thread new to start fresh.`,
            );
          }
          return;
        }

        case "/thread": {
          const sub = parts[1];

          if (sub === "new") {
            threadIdRef.current = createThread();
            conversationRef.current = [];
            setMessages([]);
            addMessage("system", "Started new thread.");
            return;
          }

          const num = parseInt(sub || "", 10);
          if (isNaN(num) || num < 1) {
            addMessage("system", "Usage: /thread new | /thread <number>");
            return;
          }

          const recentThreads = getRecentThreads(10);
          if (num > recentThreads.length) {
            addMessage("system", `Thread ${num} not found.`);
            return;
          }
          const selected = recentThreads[num - 1]!;
          threadIdRef.current = selected.id;

          const msgs = dbGetMessages(selected.id);
          conversationRef.current = msgs
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

          setMessages([]);
          for (const m of conversationRef.current) {
            addMessage(m.role, m.content);
          }
          const title = selected.title || "(untitled)";
          addMessage("system", `Switched to: ${title} — ${conversationRef.current.length} messages`);
          return;
        }

        case "/model": {
          const modelName = parts[1];
          if (!modelName) {
            addMessage(
              "system",
              `Current model: ${config.agent.default_model}\nUsage: /model <model-name>`,
            );
            return;
          }
          const newConfig = { ...config, agent: { ...config.agent, default_model: modelName } };
          setConfig(newConfig);
          saveConfig(newConfig);
          await runnerRef.current.kill().catch(() => {});
          runnerRef.current = getRunner(newConfig);
          addMessage("system", `Model switched to ${modelName}`);
          return;
        }

        default: {
          addMessage(
            "system",
            `Unknown command: ${cmd}. Type /help for commands.`,
          );
        }
      }
    },
    [config, addMessage, exit],
  );

  // ─── Submit prompt ────────────────────────────────────────────────────

  const submitPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("/")) {
        await handleSlashCommand(trimmed);
        return;
      }

      promptHistoryRef.current.push(trimmed);
      historyIndexRef.current = -1;

      addMessage("user", trimmed);
      conversationRef.current.push({ role: "user", content: trimmed });

      if (threadIdRef.current) {
        dbAddMessage(threadIdRef.current, "user", trimmed);
      }

      const fullPrompt = conversationRef.current
        .map(
          (msg) =>
            `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`,
        )
        .join("\n\n");

      setIsStreaming(true);
      setCurrentStreamText("");
      setActiveTools([]);
      toolCallsRef.current = [];
      startTimeRef.current = Date.now();
      abortRef.current = new AbortController();

      let output = "";
      let cancelled = false;

      try {
        const result = await runnerRef.current.run(
          fullPrompt,
          undefined,
          (chunk: string, type: "text" | "tool") => {
            if (cancelled) return;

            if (type === "text") {
              output += chunk;
              setCurrentStreamText((prev) => prev + chunk);
            } else if (type === "tool") {
              const event = parseToolEvent(chunk);
              if (event) {
                if (event.type === "start") {
                  const newTool: ToolCallState = {
                    name: event.name,
                    args: event.args,
                    status: "running",
                  };
                  toolCallsRef.current = [...toolCallsRef.current, newTool];
                  setActiveTools([...toolCallsRef.current]);
                } else if (event.type === "end") {
                  toolCallsRef.current = toolCallsRef.current.map((t) =>
                    t.name === event.name && t.status === "running"
                      ? { ...t, status: "done", result: event.result }
                      : t
                  );
                  setActiveTools([...toolCallsRef.current]);
                } else if (event.type === "error") {
                  toolCallsRef.current = toolCallsRef.current.map((t) =>
                    t.name === event.name && t.status === "running"
                      ? { ...t, status: "error", result: event.result }
                      : t
                  );
                  setActiveTools([...toolCallsRef.current]);
                }
              }
            }
          },
        );

        if (!cancelled) {
          if (!output && result.output) {
            output = result.output;
          }

          const assistantContent = output || result.output;
          conversationRef.current.push({
            role: "assistant",
            content: assistantContent,
          });

          if (threadIdRef.current && assistantContent) {
            dbAddMessage(threadIdRef.current, "assistant", assistantContent);
          }

          const duration = (Date.now() - startTimeRef.current) / 1000;

          setCurrentStreamText("");
          setActiveTools([]);
          addMessage("assistant", assistantContent || "[no response]", {
            toolCalls: toolCallsRef.current.length > 0 ? toolCallsRef.current : undefined,
            duration,
          });
          toolCallsRef.current = [];
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : String(err);
          setCurrentStreamText("");
          setActiveTools([]);
          addMessage("system", `Error: ${message}`);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [handleSlashCommand, addMessage],
  );

  // ─── Keyboard input ──────────────────────────────────────────────────

  useInput(
    (ch, key) => {
      if (key.ctrl && ch === "d") {
        runnerRef.current.kill().catch(() => {});
        exit();
        return;
      }

      if (key.ctrl && ch === "c") {
        if (isStreaming) {
          abortRef.current?.abort();
          abortRef.current = null;
          setIsStreaming(false);
          setCurrentStreamText((prev) => {
            if (prev) {
              const duration = (Date.now() - startTimeRef.current) / 1000;
              addMessage("assistant", prev + "\n\n*[cancelled]*", {
                toolCalls: toolCallsRef.current.length > 0 ? toolCallsRef.current : undefined,
                duration,
              });
            } else {
              addMessage("system", "Cancelled.");
            }
            return "";
          });
          setActiveTools([]);
          toolCallsRef.current = [];
        }
        return;
      }

      if (isStreaming) return;

      if (key.return) {
        const text = input;
        setInput("");
        historyIndexRef.current = -1;
        submitPrompt(text);
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (key.upArrow) {
        const history = promptHistoryRef.current;
        if (history.length === 0) return;
        const newIndex =
          historyIndexRef.current === -1
            ? history.length - 1
            : Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = newIndex;
        setInput(history[newIndex] || "");
        return;
      }

      if (key.downArrow) {
        const history = promptHistoryRef.current;
        if (historyIndexRef.current === -1) return;
        const newIndex = historyIndexRef.current + 1;
        if (newIndex >= history.length) {
          historyIndexRef.current = -1;
          setInput("");
        } else {
          historyIndexRef.current = newIndex;
          setInput(history[newIndex] || "");
        }
        return;
      }

      if (key.tab) return;

      if (key.escape) {
        setInput("");
        historyIndexRef.current = -1;
        return;
      }

      if (ch && !key.ctrl && !key.meta) {
        setInput((prev) => prev + ch);
      }
    },
    { isActive: true },
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" width="100%">
      <MessageList messages={messages} headerConfig={config} />

      {isStreaming && activeTools.length > 0 && (
        <ActiveToolIndicator tools={activeTools} />
      )}

      {isStreaming && currentStreamText && (
        <StreamingOutput text={currentStreamText} />
      )}

      <InputArea input={input} isStreaming={isStreaming} />
    </Box>
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function startRepl(): Promise<void> {
  const config = loadConfig();
  const runner = getRunner(config);

  const instance = render(
    <App
      initialConfig={config}
      initialRunner={runner}
    />,
    {
      exitOnCtrlC: false,
      patchConsole: true,
    },
  );

  await instance.waitUntilExit();
  process.exit(0);
}
