/** `kent web` — starts the API server + Vite dev server and opens the dashboard. */
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const API_PORT = 3456;
const VITE_PORT = 5173;

async function isPortInUse(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`);
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortInUse(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function prefixStream(stream: ReadableStream<Uint8Array>, prefix: string): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) process.stdout.write(`${prefix} ${line}\n`);
      }
    }
    if (buffer.trim()) process.stdout.write(`${prefix} ${buffer}\n`);
  })();
}

export async function handleWeb(): Promise<void> {
  const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
  const webDir = resolve(import.meta.dir, "../../web");
  const procs: { proc: ReturnType<typeof Bun.spawn>; name: string }[] = [];

  // Start API server
  const apiRunning = await isPortInUse(API_PORT);
  if (!apiRunning) {
    const serverScript = resolve(webDir, "server.ts");
    const proc = Bun.spawn([bunPath, "run", serverScript], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    procs.push({ proc, name: "api" });
    prefixStream(proc.stdout, "\x1b[36m[api]\x1b[0m");
    prefixStream(proc.stderr, "\x1b[36m[api]\x1b[0m");
  }

  // Start Vite dev server
  const viteRunning = await isPortInUse(VITE_PORT);
  if (!viteRunning) {
    const npxPath = execFileSync("which", ["bunx"], { encoding: "utf-8" }).trim();
    const proc = Bun.spawn([npxPath, "vite", "--port", String(VITE_PORT)], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      cwd: webDir,
    });
    procs.push({ proc, name: "vite" });
    prefixStream(proc.stdout, "\x1b[35m[vite]\x1b[0m");
    prefixStream(proc.stderr, "\x1b[35m[vite]\x1b[0m");
  }

  // Cleanup on exit
  const cleanup = () => {
    for (const { proc } of procs) {
      try { proc.kill(); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for both to be ready
  const [apiReady, viteReady] = await Promise.all([
    apiRunning ? true : waitForPort(API_PORT),
    viteRunning ? true : waitForPort(VITE_PORT),
  ]);

  if (!apiReady) console.log("Warning: API server may not have started");
  if (!viteReady) console.log("Warning: Vite dev server may not have started");

  // Open in browser
  try {
    execFileSync("open", [`http://localhost:${VITE_PORT}`]);
  } catch {
    console.log(`Open http://localhost:${VITE_PORT} in your browser`);
  }

  console.log(`\nKent web dashboard running at http://localhost:${VITE_PORT}`);
  console.log(`API server at http://localhost:${API_PORT}`);
  console.log("Press Ctrl+C to stop\n");

  // Keep alive until processes exit or user kills
  await Promise.all(procs.map(({ proc }) => proc.exited));
}
