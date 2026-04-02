/** `kent web` — ensures API + Vite are running (background), opens the dashboard, and exits. */
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { KENT_DIR } from "@shared/config.ts";

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

export async function handleWeb(): Promise<void> {
  const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
  const webDir = resolve(import.meta.dir, "../../web");

  const apiRunning = await isPortInUse(API_PORT);
  if (!apiRunning) {
    const serverScript = resolve(webDir, "server.ts");
    const logFile = resolve(KENT_DIR, "web-api.log");
    Bun.spawn(["bash", "-c", `nohup "${bunPath}" run "${serverScript}" >> "${logFile}" 2>&1 &`], {
      stdout: "ignore", stderr: "ignore", stdin: "ignore",
    });
  }

  const viteRunning = await isPortInUse(VITE_PORT);
  if (!viteRunning) {
    const npxPath = execFileSync("which", ["bunx"], { encoding: "utf-8" }).trim();
    const logFile = resolve(KENT_DIR, "web-vite.log");
    Bun.spawn(["bash", "-c", `cd "${webDir}" && nohup "${npxPath}" vite --port ${VITE_PORT} >> "${logFile}" 2>&1 &`], {
      stdout: "ignore", stderr: "ignore", stdin: "ignore",
    });
  }

  const [apiReady, viteReady] = await Promise.all([
    apiRunning ? true : waitForPort(API_PORT),
    viteRunning ? true : waitForPort(VITE_PORT),
  ]);

  if (!apiReady) console.log("Warning: API server may not have started");
  if (!viteReady) console.log("Warning: Vite dev server may not have started");

  try {
    execFileSync("open", [`http://localhost:${VITE_PORT}`]);
  } catch {
    console.log(`Open http://localhost:${VITE_PORT} in your browser`);
  }

  console.log(`Dashboard: http://localhost:${VITE_PORT}`);
  console.log(`API:       http://localhost:${API_PORT}`);
}
