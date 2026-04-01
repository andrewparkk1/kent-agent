import type { Config } from "@shared/config.ts";
import type { BaseRunner } from "./runner-base.ts";
import { LocalRunner } from "./local-runner.ts";

/**
 * Factory function to create the runner.
 * Only local runner is supported now.
 */
export function getRunner(config: Config): BaseRunner {
  return new LocalRunner(config);
}
