#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleDaemon } from "./commands/daemon.ts";
import { handleChannel } from "./commands/channel.ts";
import { handleInit } from "./commands/init.ts";
import { handleSync } from "./commands/sync.ts";
import { handleWorkflow } from "./commands/workflow.ts";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`kent v${getVersion()} - Personal AI agent CLI

Usage:
  kent                          Interactive REPL mode
  kent init                     Setup wizard
  kent daemon <start|stop|status>  Manage background daemon
  kent sync [--source <name>]   Sync data sources
  kent workflow <list|run|push|disable>  Manage workflows
  kent channel <start|stop|status>  Manage channels

Flags:
  --local       Set runner to local mode
  --version     Print version
  --help        Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle global flags
  if (args.includes("--version") || args.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const isLocal = args.includes("--local");
  const filteredArgs = args.filter((a) => a !== "--local");

  const command = filteredArgs[0];
  const subArgs = filteredArgs.slice(1);

  if (!command) {
    // No command = interactive REPL mode
    const { startRepl } = await import("@cli/repl.tsx");
    await startRepl(isLocal);
    return;
  }

  switch (command) {
    case "init":
      await handleInit();
      break;
    case "daemon":
      await handleDaemon(subArgs);
      break;
    case "sync":
      await handleSync(subArgs);
      break;
    case "workflow":
      await handleWorkflow(subArgs);
      break;
    case "channel":
      await handleChannel(subArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
