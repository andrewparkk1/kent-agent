/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { API_PORT } from "@shared/config.ts";

async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
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

/** Build the frontend if web/dist/ doesn't exist yet. */
function ensureFrontendBuilt(): void {
  const distIndex = resolve(import.meta.dir, "../../web/dist/index.html");
  if (existsSync(distIndex)) return;

  console.log("Building frontend...");
  const root = resolve(import.meta.dir, "../..");
  try {
    execFileSync("bun", ["run", "build:web"], {
      cwd: root,
      stdio: "pipe",
      timeout: 120000,
    });
    console.log("Frontend built.");
  } catch (e: any) {
    const stderr = e?.stderr?.toString?.() || "";
    console.log(`Warning: frontend build failed — dashboard may not load.`);
    if (stderr) console.log(stderr.slice(0, 500));
  }
}

export async function handleRun(): Promise<void> {
  // Start daemon via launchd
  try {
    await daemonStart();
  } catch (e) {
    console.log(`Daemon: ${e}`);
  }

  // Build frontend if needed (no more Vite dev server)
  ensureFrontendBuilt();

  // Start web supervisor via launchd
  try {
    installWebLaunchd();
  } catch (e) {
    console.log(`Web: ${e}`);
    return;
  }

  console.log("Starting web services...");
  const ready = await waitForPort(API_PORT);

  if (ready) {
    console.log(`Dashboard: http://localhost:${API_PORT}`);
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");
    try { execFileSync("open", [`http://localhost:${API_PORT}`]); } catch {}
  } else {
    console.log("Warning: server didn't start — check: kent logs api");
    console.log("\nServices are managed by launchd and may still be starting.");
    console.log("Check with: kent status");
  }
}
