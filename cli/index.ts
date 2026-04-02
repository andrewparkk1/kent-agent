#!/usr/bin/env bun
/**
 * CLI entry point — routes `kent <command>` to the right handler.
 * No args = interactive REPL, otherwise: init, daemon, sync.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleDaemon } from "./commands/daemon.ts";
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
  kent sync [--source <name>] [--full]  Sync data sources
  kent workflow <sub>           Manage scheduled workflows
  kent web                      Open web dashboard

Flags:
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

  const command = args[0];
  const subArgs = args.slice(1);

  if (!command) {
    // No command = interactive REPL mode
    const { startRepl } = await import("@cli/repl.tsx");
    await startRepl();
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
    case "web": {
      const { handleWeb } = await import("./commands/web.ts");
      await handleWeb();
      break;
    }
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
