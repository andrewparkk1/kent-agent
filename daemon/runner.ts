import type { Config } from "@shared/config.ts";
import type { BaseRunner } from "./runner-base.ts";
import { E2BRunner } from "./e2b-runner.ts";
import { LocalRunner } from "./local-runner.ts";
import { PID_PATH } from "@shared/config.ts";
import { existsSync } from "node:fs";

/**
 * Detect if the local daemon is running by checking the PID file.
 */
function isDaemonAlive(): boolean {
  try {
    if (!existsSync(PID_PATH)) return false;
    const pid = parseInt(
      Bun.file(PID_PATH).toString(),
      10
    );
    // Send signal 0 to check if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Factory function to create the appropriate runner.
 *
 * @param config - Kent configuration
 * @param override - Force a specific runner type ("local" | "cloud")
 * @returns The runner instance
 */
export function getRunner(
  config: Config,
  override?: "local" | "cloud"
): BaseRunner {
  const mode = override ?? config.agent.default_runner;

  switch (mode) {
    case "local":
      return new LocalRunner(config);

    case "cloud":
      return new E2BRunner(config);

    case "auto":
      // Auto-detect: use local if daemon is alive, cloud otherwise
      if (isDaemonAlive()) {
        return new LocalRunner(config);
      }
      return new E2BRunner(config);

    default:
      return new E2BRunner(config);
  }
}
