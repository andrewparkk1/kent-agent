/** `kent uninstall` — stops all services, removes launchd plists, cleans up ~/.kent. */
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { KENT_DIR, PLIST_PATH, WEB_PLIST_PATH } from "@shared/config.ts";
import { stopWeb, uninstallWebLaunchd } from "./web.ts";

export async function handleUninstall(): Promise<void> {
  const uid = process.getuid!();

  console.log("Stopping all Kent services...\n");

  // Unload daemon launchd service
  if (existsSync(PLIST_PATH)) {
    try { execFileSync("launchctl", ["bootout", `gui/${uid}`, PLIST_PATH], { stdio: "pipe", timeout: 5000 }); } catch {}
    try { execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe", timeout: 3000 }); } catch {}
    try { rmSync(PLIST_PATH); } catch {}
    console.log("  ✓ Daemon launchd service removed");
  }

  // Unload web launchd service
  await uninstallWebLaunchd();
  console.log("  ✓ Web launchd service removed");

  // Kill any remaining web processes
  await stopWeb();
  console.log("  ✓ Web processes stopped");

  // Remove ~/.kent directory
  if (existsSync(KENT_DIR)) {
    rmSync(KENT_DIR, { recursive: true, force: true });
    console.log("  ✓ Removed ~/.kent");
  }

  // Remove global bun link
  try {
    execFileSync("bun", ["unlink", "kent-agent"], { stdio: "pipe", timeout: 5000 });
    console.log("  ✓ Removed global bun link");
  } catch {}

  console.log("\nKent has been fully uninstalled.");
  console.log("To reinstall, run: bun link && kent init");
}
