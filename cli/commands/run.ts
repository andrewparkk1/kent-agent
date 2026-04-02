/** `kent run` — starts the daemon + web dashboard in one command. */
import { daemonStart } from "./daemon.ts";
import { handleWeb } from "./web.ts";

export async function handleRun(): Promise<void> {
  // Start daemon
  try {
    await daemonStart();
    console.log("Daemon started");
  } catch {
    console.log("Daemon already running");
  }

  // Start web + open browser
  await handleWeb();
}
