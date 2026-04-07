/** `kent logs` — stream logs from daemon and web services. */
import { existsSync, watchFile, unwatchFile, readFileSync, statSync } from "node:fs";
import { LOG_PATH, KENT_DIR } from "@shared/config.ts";
import { resolve } from "node:path";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

const LOG_FILES: Record<string, string> = {
  daemon: LOG_PATH,
  api: resolve(KENT_DIR, "web-api.log"),
  web: resolve(KENT_DIR, "web-supervisor.log"),
};

function colorLine(line: string): string {
  if (line.includes("ERROR") || line.includes("error")) return `${RED}${line}${NC}`;
  if (line.includes("workflow:")) return `${CYAN}${line}${NC}`;
  if (line.includes("new items")) return `${GREEN}${line}${NC}`;
  if (line.includes("shutting down") || line.includes("stopped")) return `${YELLOW}${line}${NC}`;
  return line;
}

function tailLines(filePath: string, n: number): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").slice(-n);
}

export async function handleLogs(args: string[]): Promise<void> {
  // Parse args: kent logs [source] [-n NUM] [--follow/-f]
  let source = "daemon";
  let numLines = 50;
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-f" || arg === "--follow") {
      follow = true;
    } else if (arg === "-n" && args[i + 1]) {
      numLines = Number(args[++i]);
    } else if (arg in LOG_FILES) {
      source = arg;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: kent logs [source] [-n NUM] [-f/--follow]

Sources:
  daemon    Background daemon log (default)
  api       Web API server log
  web       Web supervisor log

Options:
  -n NUM    Number of lines to show (default: 50)
  -f        Follow/stream new log entries`);
      return;
    }
  }

  const logPath = LOG_FILES[source]!;

  if (!existsSync(logPath)) {
    console.log(`No log file found at ${logPath}`);
    return;
  }

  // Print header
  console.log(`${DIM}── ${source} logs (${logPath}) ──${NC}\n`);

  // Show last N lines
  const lines = tailLines(logPath, numLines);
  for (const line of lines) {
    console.log(colorLine(line));
  }

  if (!follow) return;

  // Stream mode — watch for new lines
  console.log(`\n${DIM}── streaming (ctrl+c to stop) ──${NC}\n`);

  let lastSize = statSync(logPath).size;

  watchFile(logPath, { interval: 300 }, () => {
    try {
      const currentSize = statSync(logPath).size;
      if (currentSize <= lastSize) {
        lastSize = currentSize;
        return;
      }

      // Read only the new bytes
      const fd = Bun.file(logPath);
      const reader = fd.slice(lastSize, currentSize);
      reader.text().then((newContent) => {
        const newLines = newContent.trim().split("\n");
        for (const line of newLines) {
          if (line) console.log(colorLine(line));
        }
      });

      lastSize = currentSize;
    } catch {}
  });

  // Keep alive until ctrl+c
  const cleanup = () => {
    try { unwatchFile(logPath); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
}
