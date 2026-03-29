import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, Static, useInput, useApp, useStdout } from "ink";
import Spinner from "ink-spinner";
import { loadConfig, saveConfig } from "@shared/config.ts";
import { getRunner } from "@daemon/runner.ts";
import type { Config } from "@shared/config.ts";
import type { BaseRunner } from "@daemon/runner-base.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: string[];
}

interface AppState {
  messages: Message[];
  input: string;
  cursorPos: number;
  isStreaming: boolean;
  currentStreamText: string;
  currentToolCall: string | null;
  runnerMode: "local" | "cloud" | "auto";
  scrollOffset: number;
  promptHistoryIndex: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ─── StatusBar ───────────────────────────────────────────────────────────────

function StatusBar({
  config,
  runnerMode,
}: {
  config: Config;
  runnerMode: string;
}) {
  const model = config.agent.default_model;
  const syncInterval = config.daemon.sync_interval_minutes;
  const sources = Object.entries(config.sources)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
      width="100%"
    >
      <Box gap={2}>
        <Text bold color="cyan">
          kent
        </Text>
        <Text dimColor>
          model: <Text color="yellow">{model}</Text>
        </Text>
        <Text dimColor>
          runner: <Text color="green">{runnerMode}</Text>
        </Text>
        <Text dimColor>
          sync: <Text color="white">{syncInterval}m</Text>
        </Text>
      </Box>
      {sources.length > 0 && (
        <Box>
          <Text dimColor>
            sources: <Text color="white">{sources.join(", ")}</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ─── ToolIndicator ───────────────────────────────────────────────────────────

function ToolIndicator({ toolName }: { toolName: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color="yellow">
        <Spinner type="dots" /> {toolName}
      </Text>
    </Box>
  );
}

// ─── MessageView ─────────────────────────────────────────────────────────────

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <Box paddingLeft={1} marginTop={1}>
        <Text bold color="blue">
          {"❯ "}
        </Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "system") {
    return (
      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor italic>
          {message.content}
        </Text>
      </Box>
    );
  }

  // assistant
  return (
    <Box paddingLeft={2} marginTop={1} flexDirection="column">
      <Text>{message.content}</Text>
    </Box>
  );
}

// ─── MessageList (completed messages rendered via Static) ─────────────────────

function MessageList({ messages }: { messages: Message[] }) {
  return (
    <Static items={messages}>
      {(message) => (
        <Box key={message.id} flexDirection="column">
          <MessageView message={message} />
        </Box>
      )}
    </Static>
  );
}

// ─── StreamingOutput ─────────────────────────────────────────────────────────

function StreamingOutput({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text>{text}</Text>
    </Box>
  );
}

// ─── InputArea ───────────────────────────────────────────────────────────────

function InputArea({
  input,
  isStreaming,
}: {
  input: string;
  isStreaming: boolean;
}) {
  if (isStreaming) {
    return (
      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>
          <Spinner type="dots" /> thinking...{" "}
          <Text dimColor italic>
            (ctrl+c to cancel)
          </Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>
          {"─".repeat(Math.min(process.stdout.columns || 80, 120))}
        </Text>
      </Box>
      <Box paddingLeft={1}>
        <Text bold color="cyan">
          {"❯ "}
        </Text>
        <Text>
          {input}
          <Text color="cyan">█</Text>
        </Text>
      </Box>
    </Box>
  );
}

// ─── Help text ───────────────────────────────────────────────────────────────

const HELP_TEXT = `
  Slash commands:
    /sync [source]          Trigger a sync
    /status                 Show daemon status
    /workflow list|run      Manage workflows
    /model <name>           Switch model
    /runner local|cloud     Switch runner
    /clear                  Clear history
    /history                Show past prompts
    /help                   Show this help
    /exit                   Quit`;

// ─── Main App ────────────────────────────────────────────────────────────────

function App({
  initialConfig,
  initialRunner,
  initialRunnerMode,
}: {
  initialConfig: Config;
  initialRunner: BaseRunner;
  initialRunnerMode: "local" | "cloud" | "auto";
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
  const [config, setConfig] = useState(initialConfig);
  const [runnerMode, setRunnerMode] = useState(initialRunnerMode);

  const runnerRef = useRef<BaseRunner>(initialRunner);
  const abortRef = useRef<AbortController | null>(null);
  const promptHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const conversationRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const addMessage = useCallback(
    (role: Message["role"], content: string) => {
      const msg: Message = { id: nextId(), role, content };
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
          setMessages([]);
          addMessage("system", "  [conversation cleared]");
          return;
        }

        case "/history": {
          const history = promptHistoryRef.current;
          if (history.length === 0) {
            addMessage("system", "  [no prompt history]");
          } else {
            const lines = history
              .map((p, i) => {
                const display =
                  p.length > 80 ? p.slice(0, 77) + "..." : p;
                return `  ${i + 1}. ${display}`;
              })
              .join("\n");
            addMessage("system", `  Prompt history:\n${lines}`);
          }
          return;
        }

        case "/sync": {
          const source = parts[1];
          addMessage(
            "system",
            source
              ? `  [syncing ${source}...]`
              : "  [syncing all sources...]",
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
            addMessage("system", "  [sync complete]");
          } catch {
            addMessage("system", "  [sync failed]");
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

          addMessage(
            "system",
            [
              `  Daemon:   ${daemonStatus}`,
              `  Model:    ${config.agent.default_model}`,
              `  Runner:   ${runnerMode}`,
              `  Sync:     every ${config.daemon.sync_interval_minutes}m`,
              `  Sources (on):  ${enabled.length > 0 ? enabled.join(", ") : "none"}`,
              `  Sources (off): ${disabled.length > 0 ? disabled.join(", ") : "none"}`,
            ].join("\n"),
          );
          return;
        }

        case "/workflow": {
          const sub = parts[1];
          if (!sub) {
            addMessage("system", "  Usage: /workflow list | /workflow run <name>");
            return;
          }
          try {
            const { handleWorkflow } = await import(
              "@cli/commands/workflow.ts"
            );
            const originalExit = process.exit;
            process.exit = (() => {}) as never;
            try {
              await handleWorkflow(parts.slice(1));
            } finally {
              process.exit = originalExit;
            }
          } catch {
            addMessage("system", "  [workflow command failed]");
          }
          return;
        }

        case "/model": {
          const modelName = parts[1];
          if (!modelName) {
            addMessage(
              "system",
              `  Current model: ${config.agent.default_model}\n  Usage: /model <model-name>`,
            );
            return;
          }
          const newConfig = { ...config, agent: { ...config.agent, default_model: modelName } };
          setConfig(newConfig);
          saveConfig(newConfig);
          await runnerRef.current.kill().catch(() => {});
          runnerRef.current = getRunner(
            newConfig,
            runnerMode === "auto" ? undefined : runnerMode,
          );
          addMessage("system", `  [model switched to ${modelName}]`);
          return;
        }

        case "/runner": {
          const mode = parts[1] as "local" | "cloud" | undefined;
          if (!mode || (mode !== "local" && mode !== "cloud")) {
            addMessage(
              "system",
              `  Current runner: ${runnerMode}\n  Usage: /runner local|cloud`,
            );
            return;
          }
          setRunnerMode(mode);
          await runnerRef.current.kill().catch(() => {});
          runnerRef.current = getRunner(config, mode);
          addMessage("system", `  [runner switched to ${mode}]`);
          return;
        }

        default: {
          addMessage(
            "system",
            `  Unknown command: ${cmd}. Type /help for commands.`,
          );
        }
      }
    },
    [config, runnerMode, addMessage, exit],
  );

  // ─── Submit prompt ───────────────────────────────────────────────────

  const submitPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Slash commands
      if (trimmed.startsWith("/")) {
        await handleSlashCommand(trimmed);
        return;
      }

      // Add to history
      promptHistoryRef.current.push(trimmed);
      historyIndexRef.current = -1;

      // Show user message
      addMessage("user", trimmed);

      // Build conversation context
      conversationRef.current.push({ role: "user", content: trimmed });
      const fullPrompt = conversationRef.current
        .map(
          (msg) =>
            `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`,
        )
        .join("\n\n");

      // Start streaming
      setIsStreaming(true);
      setCurrentStreamText("");
      setCurrentToolCall(null);
      abortRef.current = new AbortController();

      let output = "";
      let cancelled = false;

      try {
        const result = await runnerRef.current.run(
          fullPrompt,
          undefined,
          (chunk: string) => {
            if (cancelled) return;
            output += chunk;
            setCurrentStreamText((prev) => prev + chunk);
          },
        );

        if (!cancelled) {
          // If no streaming happened, use the full output
          if (!output && result.output) {
            output = result.output;
          }

          conversationRef.current.push({
            role: "assistant",
            content: output || result.output,
          });

          // Finalize: move stream text into a permanent message
          setCurrentStreamText("");
          addMessage("assistant", output || result.output || "[no response]");
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : String(err);
          setCurrentStreamText("");
          addMessage("system", `  [error] ${message}`);
        }
      } finally {
        setIsStreaming(false);
        setCurrentToolCall(null);
        abortRef.current = null;
      }
    },
    [handleSlashCommand, addMessage],
  );

  // ─── Keyboard input ─────────────────────────────────────────────────

  useInput(
    (ch, key) => {
      // Ctrl+D = exit
      if (key.ctrl && ch === "d") {
        runnerRef.current.kill().catch(() => {});
        exit();
        return;
      }

      // Ctrl+C = cancel current run
      if (key.ctrl && ch === "c") {
        if (isStreaming) {
          abortRef.current?.abort();
          abortRef.current = null;
          setIsStreaming(false);
          setCurrentStreamText((prev) => {
            if (prev) {
              addMessage("assistant", prev + "\n[cancelled]");
            } else {
              addMessage("system", "  [cancelled]");
            }
            return "";
          });
        }
        return;
      }

      // Don't accept input while streaming
      if (isStreaming) return;

      // Enter = submit
      if (key.return) {
        const text = input;
        setInput("");
        historyIndexRef.current = -1;
        submitPrompt(text);
        return;
      }

      // Backspace
      if (key.backspace) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Delete
      if (key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Up arrow = prompt history
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

      // Down arrow = prompt history
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

      // Tab = ignore
      if (key.tab) return;

      // Escape = clear input
      if (key.escape) {
        setInput("");
        historyIndexRef.current = -1;
        return;
      }

      // Regular character input
      if (ch && !key.ctrl && !key.meta) {
        setInput((prev) => prev + ch);
      }
    },
    { isActive: true },
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" width="100%">
      <StatusBar config={config} runnerMode={runnerMode} />

      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>
          Type a message to chat, or{" "}
          <Text color="cyan">/help</Text> for commands.{" "}
          <Text dimColor italic>
            ctrl+c cancels, ctrl+d exits.
          </Text>
        </Text>
      </Box>

      {/* Completed messages */}
      <MessageList messages={messages} />

      {/* Streaming output (live) */}
      {isStreaming && currentStreamText && (
        <StreamingOutput text={currentStreamText} />
      )}

      {/* Tool call indicator */}
      {isStreaming && currentToolCall && (
        <ToolIndicator toolName={currentToolCall} />
      )}

      {/* Input area */}
      <InputArea input={input} isStreaming={isStreaming} />
    </Box>
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function startRepl(isLocal: boolean): Promise<void> {
  const config = loadConfig();

  const runnerMode: "local" | "cloud" | "auto" = isLocal
    ? "local"
    : (config.agent.default_runner as "local" | "cloud" | "auto");

  const runner = getRunner(
    config,
    runnerMode === "auto" ? undefined : runnerMode,
  );

  const instance = render(
    <App
      initialConfig={config}
      initialRunner={runner}
      initialRunnerMode={runnerMode}
    />,
    {
      exitOnCtrlC: false,
      patchConsole: true,
    },
  );

  await instance.waitUntilExit();
  process.exit(0);
}
