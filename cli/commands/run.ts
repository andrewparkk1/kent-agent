/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { API_PORT, VITE_PORT } from "@shared/config.ts";

async function waitForPort(port: number, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastSec = 0;
  while (Date.now() < deadline) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed > lastSec) {
      lastSec = elapsed;
      process.stdout.write(`\rWaiting for server... ${elapsed}s`);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status < 500) {
        process.stdout.write(`\rServer ready in ${lastSec}s          \n`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`\rServer timed out after ${Math.floor(timeoutMs / 1000)}s\n`);
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
  const dashboardPort = hasStaticBuild ? API_PORT : VITE_PORT;

  console.log("Starting web services...");
  const ready = await waitForPort(dashboardPort);

  if (ready) {
    console.log(`Dashboard: http://localhost:${dashboardPort}`);
    if (!hasStaticBuild) console.log(`(dev mode — using Vite on port ${VITE_PORT})`);
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");

    try { execFileSync("open", [`http://localhost:${dashboardPort}`]); } catch {}
  } else {
    console.log("Warning: server didn't start — check: kent logs api");
    console.log("\nServices are managed by launchd and may still be starting.");
    console.log("Check with: kent status");
  }
}
