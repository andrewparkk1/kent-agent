import * as readline from "node:readline";
import { loadConfig, saveConfig } from "@shared/config.ts";
import { getRunner } from "@daemon/runner.ts";
import { threads } from "@shared/convex-client.ts";
import type { Config } from "@shared/config.ts";
import type { BaseRunner } from "@daemon/runner-base.ts";

interface ReplState {
  config: Config;
  runner: BaseRunner;
  runnerMode: "local" | "cloud" | "auto";
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  promptHistory: string[];
  isRunning: boolean;
  abortController: AbortController | null;
  threadId: string | null;
}

function printStatusBar(state: ReplState): void {
  const model = state.config.agent.default_model;
  const runner = state.runnerMode;
  const syncInterval = state.config.daemon.sync_interval_minutes;
  const sources = Object.entries(state.config.sources)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  console.log("");
  console.log("─".repeat(60));
  console.log(`  kent interactive`);
  console.log(`  model: ${model}  |  runner: ${runner}  |  sync: every ${syncInterval}m`);
  if (sources.length > 0) {
    console.log(`  sources: ${sources.join(", ")}`);
  }
  console.log("─".repeat(60));
  console.log("");
  console.log("  Type a message to chat, or use /help for commands.");
  console.log("  Ctrl+C cancels current run. /exit to quit.");
  console.log("");
}

function printHelp(): void {
  console.log(`
Slash commands:
  /sync [source]          Trigger a sync (optionally for a specific source)
  /status                 Show daemon status and source counts
  /workflow list           List workflows
  /workflow run <name>    Run a workflow
  /threads                List recent conversation threads
  /thread new             Start a new thread
  /thread <number>        Switch to a thread by number (from /threads list)
  /model <name>           Switch model mid-session
  /runner local|cloud     Switch runner mid-session
  /clear                  Clear conversation history
  /history                Show past prompts this session
  /help                   Show this help
  /exit, /quit            Quit the REPL
`);
}

async function handleSlashCommand(
  input: string,
  state: ReplState,
): Promise<boolean> {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]!.toLowerCase();

  switch (cmd) {
    case "/exit":
    case "/quit": {
      console.log("Goodbye.");
      return true; // signal exit
    }

    case "/help": {
      printHelp();
      return false;
    }

    case "/clear": {
      state.conversationHistory = [];
      console.log("[cleared conversation history]");
      return false;
    }

    case "/history": {
      if (state.promptHistory.length === 0) {
        console.log("[no prompt history yet]");
      } else {
        console.log("\nPrompt history:");
        for (let i = 0; i < state.promptHistory.length; i++) {
          const prompt = state.promptHistory[i]!;
          const display = prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt;
          console.log(`  ${i + 1}. ${display}`);
        }
        console.log("");
      }
      return false;
    }

    case "/sync": {
      const source = parts[1];
      if (source) {
        console.log(`[syncing ${source}...]`);
        // Delegate to the sync handler logic
        const { handleSync } = await import("@cli/commands/sync.ts");
        try {
          await handleSync(["--source", source]);
        } catch {
          // handleSync may call process.exit; catch and continue
        }
      } else {
        console.log("[syncing all sources...]");
        const { handleSync } = await import("@cli/commands/sync.ts");
        try {
          await handleSync([]);
        } catch {
          // continue
        }
      }
      return false;
    }

    case "/status": {
      const { existsSync, readFileSync } = await import("node:fs");
      const { PID_PATH } = await import("@shared/config.ts");

      // Daemon status
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

      // Source counts
      const sources = Object.entries(state.config.sources);
      const enabledSources = sources.filter(([, v]) => v).map(([k]) => k);
      const disabledSources = sources.filter(([, v]) => !v).map(([k]) => k);

      console.log(`\n  Daemon:   ${daemonStatus}`);
      console.log(`  Model:    ${state.config.agent.default_model}`);
      console.log(`  Runner:   ${state.runnerMode}`);
      console.log(`  Sync:     every ${state.config.daemon.sync_interval_minutes}m`);
      console.log(`  Sources (enabled):  ${enabledSources.length > 0 ? enabledSources.join(", ") : "none"}`);
      console.log(`  Sources (disabled): ${disabledSources.length > 0 ? disabledSources.join(", ") : "none"}`);
      console.log("");
      return false;
    }

    case "/workflow": {
      const sub = parts[1];
      if (!sub) {
        console.log("Usage: /workflow list | /workflow run <name>");
        return false;
      }
      const { handleWorkflow } = await import("@cli/commands/workflow.ts");
      // Prevent process.exit from killing the REPL by temporarily overriding
      const originalExit = process.exit;
      process.exit = (() => {
        // no-op inside REPL
      }) as never;
      try {
        await handleWorkflow(parts.slice(1));
      } catch {
        // continue
      } finally {
        process.exit = originalExit;
      }
      return false;
    }

    case "/threads": {
      const deviceToken = state.config.core.device_token;
      if (!deviceToken) {
        console.log("[no device token — run `kent init` first]");
        return false;
      }
      try {
        const recentThreads = await threads.getRecent(deviceToken, "cli", 10);
        if (recentThreads.length === 0) {
          console.log("[no threads yet]");
        } else {
          console.log("\nRecent threads:");
          for (let i = 0; i < recentThreads.length; i++) {
            const t = recentThreads[i]!;
            const active = state.threadId === t._id ? " ←" : "";
            const title = t.title || "(untitled)";
            const date = new Date(t.lastMessageAt).toLocaleDateString();
            console.log(`  ${i + 1}. ${title}  (${date})${active}`);
          }
          console.log("\n  Use /thread <number> to switch, /thread new to start fresh.\n");
        }
      } catch (err) {
        console.log(`[failed to list threads: ${err instanceof Error ? err.message : err}]`);
      }
      return false;
    }

    case "/thread": {
      const sub = parts[1];
      const deviceToken = state.config.core.device_token;
      if (!deviceToken) {
        console.log("[no device token — run `kent init` first]");
        return false;
      }

      if (sub === "new") {
        try {
          const threadId = await threads.create(deviceToken, "cli");
          state.threadId = threadId;
          state.conversationHistory = [];
          console.log("[started new thread]");
        } catch (err) {
          console.log(`[failed to create thread: ${err instanceof Error ? err.message : err}]`);
        }
        return false;
      }

      // Switch to thread by number
      const num = parseInt(sub || "", 10);
      if (isNaN(num) || num < 1) {
        console.log("Usage: /thread new | /thread <number>");
        return false;
      }

      try {
        const recentThreads = await threads.getRecent(deviceToken, "cli", 10);
        if (num > recentThreads.length) {
          console.log(`[thread ${num} not found — only ${recentThreads.length} threads]`);
          return false;
        }
        const selected = recentThreads[num - 1]!;
        state.threadId = selected._id;

        // Load conversation history from this thread
        const messages = await threads.getMessages(deviceToken, selected._id);
        state.conversationHistory = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const title = selected.title || "(untitled)";
        console.log(`[switched to thread: ${title} — ${state.conversationHistory.length} messages loaded]`);
      } catch (err) {
        console.log(`[failed to switch thread: ${err instanceof Error ? err.message : err}]`);
      }
      return false;
    }

    case "/model": {
      const modelName = parts[1];
      if (!modelName) {
        console.log(`Current model: ${state.config.agent.default_model}`);
        console.log("Usage: /model <model-name>");
        return false;
      }
      state.config.agent.default_model = modelName;
      saveConfig(state.config);
      // Recreate runner with new config
      await state.runner.kill().catch(() => {});
      state.runner = getRunner(state.config, state.runnerMode === "auto" ? undefined : state.runnerMode);
      console.log(`[model switched to ${modelName}]`);
      return false;
    }

    case "/runner": {
      const mode = parts[1] as "local" | "cloud" | undefined;
      if (!mode || (mode !== "local" && mode !== "cloud")) {
        console.log(`Current runner: ${state.runnerMode}`);
        console.log("Usage: /runner local|cloud");
        return false;
      }
      state.runnerMode = mode;
      await state.runner.kill().catch(() => {});
      state.runner = getRunner(state.config, mode);
      console.log(`[runner switched to ${mode}]`);
      return false;
    }

    default: {
      console.log(`Unknown command: ${cmd}. Type /help for available commands.`);
      return false;
    }
  }
}

export async function startRepl(isLocal: boolean): Promise<void> {
  const config = loadConfig();

  const runnerMode: "local" | "cloud" | "auto" = isLocal
    ? "local"
    : (config.agent.default_runner as "local" | "cloud" | "auto");

  const runner = getRunner(config, runnerMode === "auto" ? undefined : runnerMode);

  const state: ReplState = {
    config,
    runner,
    runnerMode,
    conversationHistory: [],
    promptHistory: [],
    isRunning: false,
    abortController: null,
    threadId: null,
  };

  printStatusBar(state);

  // Initialize thread — resume latest or create new
  const deviceToken = config.core.device_token;
  if (deviceToken) {
    try {
      const recent = await threads.getRecent(deviceToken, "cli", 1);
      if (recent.length > 0) {
        const latest = recent[0]!;
        // Resume if last message was within 24 hours
        const hoursSince = (Date.now() - latest.lastMessageAt) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          state.threadId = latest._id;
          const messages = await threads.getMessages(deviceToken, latest._id);
          state.conversationHistory = messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
          const title = latest.title || "(untitled)";
          console.log(`  Resumed thread: ${title} (${state.conversationHistory.length} messages)`);
        } else {
          state.threadId = await threads.create(deviceToken, "cli");
          console.log("  Started new thread.");
        }
      } else {
        state.threadId = await threads.create(deviceToken, "cli");
        console.log("  Started new thread.");
      }
    } catch {
      // Convex unavailable — continue without persistence
      console.log("  (offline — thread history unavailable)");
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "kent> ",
    historySize: 200,
    terminal: true,
  });

  // Handle Ctrl+C: cancel current run or show message
  rl.on("SIGINT", () => {
    if (state.isRunning) {
      console.log("\n[cancelled]");
      state.isRunning = false;
      // Signal abort if we have a controller
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
      }
      rl.prompt();
    } else {
      console.log('\n(Use /exit or /quit to leave)');
      rl.prompt();
    }
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      const shouldExit = await handleSlashCommand(input, state);
      if (shouldExit) {
        await state.runner.kill().catch(() => {});
        rl.close();
        process.exit(0);
      }
      rl.prompt();
      return;
    }

    // Regular prompt — send to the agent runner
    state.promptHistory.push(input);
    state.conversationHistory.push({ role: "user", content: input });
    state.isRunning = true;
    state.abortController = new AbortController();

    // Persist user message to thread
    if (state.threadId && deviceToken) {
      threads.addMessage(deviceToken, state.threadId, "user", input).catch(() => {});
    }

    // Build multi-turn prompt with conversation context
    const fullPrompt = state.conversationHistory
      .map((msg) => `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`)
      .join("\n\n");

    try {
      let output = "";
      const result = await state.runner.run(
        fullPrompt,
        undefined,
        (chunk: string, type: "text" | "tool") => {
          if (!state.isRunning) return; // cancelled
          if (type === "tool") {
            // Tool call indicators — dim gray
            process.stdout.write(`\x1b[2m${chunk}\x1b[0m`);
          } else {
            process.stdout.write(chunk);
            output += chunk;
          }
        },
        { threadId: state.threadId ?? undefined },
      );

      if (state.isRunning) {
        // If no streaming happened, print the full output
        if (!output && result.output) {
          console.log(result.output);
          output = result.output;
        }
        // Ensure we end with a newline
        if (output && !output.endsWith("\n")) {
          console.log("");
        }
        const assistantContent = output || result.output;
        state.conversationHistory.push({ role: "assistant", content: assistantContent });

        // Persist assistant message to thread
        if (state.threadId && deviceToken && assistantContent) {
          threads.addMessage(deviceToken, state.threadId, "assistant", assistantContent).catch(() => {});
        }
      }
    } catch (err) {
      if (state.isRunning) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n[error] ${message}`);
      }
    } finally {
      state.isRunning = false;
      state.abortController = null;
      console.log("");
      rl.prompt();
    }
  });

  rl.on("close", async () => {
    await state.runner.kill().catch(() => {});
    process.exit(0);
  });
}
