/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";
import { execFileSync } from "node:child_process";

const API_PORT = 3456;

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

  // Wait for API server to be ready (serves both API + static frontend)
  console.log("Starting web services...");
  const apiReady = await waitForPort(API_PORT);

  if (apiReady) {
    console.log(`Dashboard: http://localhost:${API_PORT}`);
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");

    // Open browser now that everything is ready
    try { execFileSync("open", [`http://localhost:${API_PORT}`]); } catch {}
  } else {
    console.log("Warning: API server didn't start — check: kent logs api");
    console.log("\nServices are managed by launchd and may still be starting.");
    console.log("Check with: kent status");
  }
}
