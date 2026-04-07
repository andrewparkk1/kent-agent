/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { API_PORT, VITE_PORT } from "@shared/config.ts";

async function waitForPort(port: number, label: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastSec = 0;
  while (Date.now() < deadline) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed > lastSec) {
      lastSec = elapsed;
      process.stdout.write(`\rWaiting for ${label}... ${elapsed}s`);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status < 500) {
        process.stdout.write(`\r${label} ready in ${lastSec}s          \n`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`\r${label} timed out after ${Math.floor(timeoutMs / 1000)}s\n`);
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

  // Detect dev mode: no pre-built frontend means Vite dev server is used
  const hasStaticBuild = existsSync(resolve(import.meta.dir, "../../web/dist/index.html"));

  console.log("Starting web services...");

  // Always wait for the API server first (starts fast)
  const apiReady = await waitForPort(API_PORT, "API server", 30000);

  if (!apiReady) {
    console.log("Warning: API server didn't start — check: kent logs api");
    console.log("\nServices are managed by launchd and may still be starting.");
    console.log("Check with: kent status");
    return;
  }

  if (hasStaticBuild) {
    // Production mode — API serves the frontend directly
    console.log(`Dashboard: http://localhost:${API_PORT}`);
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");
    try { execFileSync("open", [`http://localhost:${API_PORT}`]); } catch {}
  } else {
    // Dev mode — also wait for Vite (can take longer due to compilation)
    const viteReady = await waitForPort(VITE_PORT, "Vite dev server", 60000);
    const dashboardPort = viteReady ? VITE_PORT : API_PORT;

    console.log(`Dashboard: http://localhost:${dashboardPort}`);
    if (viteReady) {
      console.log(`(dev mode — using Vite on port ${VITE_PORT})`);
    } else {
      console.log(`Warning: Vite dev server didn't start — check: kent logs vite`);
      console.log(`API is running at http://localhost:${API_PORT}`);
    }
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");
    try { execFileSync("open", [`http://localhost:${dashboardPort}`]); } catch {}
  }
}
