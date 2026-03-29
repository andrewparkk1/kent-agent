import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli", "index.ts");

describe("daemon status command", () => {
  test("daemon status reports not running when no PID file", async () => {
    const { PID_PATH } = await import("@shared/config.ts");

    // Ensure no PID file
    if (existsSync(PID_PATH)) {
      // Don't remove it if a real daemon is running — just skip
      const pid = parseInt(await Bun.file(PID_PATH).text(), 10);
      try {
        process.kill(pid, 0);
        // Real daemon is running, skip this test
        console.log("Skipping: real daemon is running");
        return;
      } catch {
        // PID is stale, safe to test
      }
    }

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "daemon", "status"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(stdout).toContain("not running");
  });
});

describe("daemon PID file management", () => {
  test("PID_PATH is correctly formed", async () => {
    const { PID_PATH, KENT_DIR } = await import("@shared/config.ts");

    expect(PID_PATH).toBe(join(KENT_DIR, "daemon.pid"));
    expect(PID_PATH).toContain(".kent");
  });

  test("PLIST_PATH points to LaunchAgents", async () => {
    const { PLIST_PATH } = await import("@shared/config.ts");

    expect(PLIST_PATH).toContain("Library/LaunchAgents");
    expect(PLIST_PATH).toContain("sh.kent.daemon.plist");
  });
});
