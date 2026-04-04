/** `kent run` — starts the daemon + web dashboard as persistent launchd services. */
import { daemonStart } from "./daemon.ts";
import { installWebLaunchd } from "./web.ts";

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
    console.log("Web dashboard started via launchd");
    console.log("Dashboard: http://localhost:5173");
    console.log("API:       http://localhost:3456");
    console.log("\nAll services will auto-restart on sleep/reboot.");
    console.log("Stop with: kent daemon stop");
  } catch (e) {
    console.log(`Web: ${e}`);
  }
}
