/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";
import { execFileSync } from "node:child_process";

const API_PORT = 3456;
const VITE_PORT = 5173;

async function waitForPort(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function handleRun(): Promise<void> {
  // Start daemon via launchd
  try {
    await daemonStart();
  } catch (e) {
    console.log(`Daemon: ${e}`);
  }

  // Start web supervisor via launchd
  try {
    installWebLaunchd();
  } catch (e) {
    console.log(`Web: ${e}`);
    return;
  }

  // Wait for services to be ready
  console.log("Starting web services...");
  const [apiReady, viteReady] = await Promise.all([
    waitForPort(API_PORT),
    waitForPort(VITE_PORT),
  ]);

  if (apiReady && viteReady) {
    console.log(`Dashboard: http://localhost:${VITE_PORT}`);
    console.log(`API:       http://localhost:${API_PORT}`);
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");

    // Open browser now that everything is ready
    try { execFileSync("open", [`http://localhost:${VITE_PORT}`]); } catch {}
  } else {
    if (!apiReady) console.log("Warning: API server didn't start — check: kent logs api");
    if (!viteReady) console.log("Warning: Dashboard didn't start — check: kent logs vite");
    console.log("\nServices are managed by launchd and may still be starting.");
    console.log("Check with: kent status");
  }
}
