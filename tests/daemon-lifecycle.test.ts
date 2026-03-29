import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DAEMON_PATH = join(import.meta.dir, "..", "daemon", "daemon.ts");

/**
 * Tests for daemon/daemon.ts lifecycle behavior.
 *
 * Each test spawns the daemon as a subprocess with HOME set to an isolated
 * temp directory, so PID_PATH and LOG_PATH (derived from ~/.kent/) write
 * into the temp dir instead of the real home.
 */

function makeTempHome(): string {
  const dir = join(tmpdir(), `kent-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function kentDir(home: string): string {
  return join(home, ".kent");
}

function pidPath(home: string): string {
  return join(kentDir(home), "daemon.pid");
}

function logPath(home: string): string {
  return join(kentDir(home), "daemon.log");
}

/** Wait until a file exists or timeout */
async function waitForFile(path: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return true;
    await Bun.sleep(50);
  }
  return false;
}

/** Wait until a file contains a given substring or timeout */
async function waitForLogContent(path: string, content: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      if (text.includes(content)) return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

describe("daemon lifecycle", () => {
  let tempHome: string;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  beforeEach(() => {
    tempHome = makeTempHome();
  });

  afterEach(async () => {
    // Kill the daemon if still running
    if (proc) {
      try {
        proc.kill("SIGKILL");
        await proc.exited;
      } catch {
        // Already exited
      }
      proc = null;
    }
    // Clean up temp directory
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  function spawnDaemon(): ReturnType<typeof Bun.spawn> {
    proc = Bun.spawn(["bun", "run", DAEMON_PATH], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: tempHome,
      },
    });
    return proc;
  }

  test("daemon writes PID file on start", async () => {
    spawnDaemon();

    const found = await waitForFile(pidPath(tempHome));
    expect(found).toBe(true);
  });

  test("PID file contains actual process PID", async () => {
    const p = spawnDaemon();

    const found = await waitForFile(pidPath(tempHome));
    expect(found).toBe(true);

    const pidContent = readFileSync(pidPath(tempHome), "utf-8").trim();
    expect(pidContent).toBe(String(p.pid));
  });

  test("daemon creates log file with startup message", async () => {
    spawnDaemon();

    const found = await waitForFile(logPath(tempHome));
    expect(found).toBe(true);

    const hasStartup = await waitForLogContent(logPath(tempHome), "Daemon started");
    expect(hasStartup).toBe(true);
  });

  test("log contains 'Daemon started' with PID", async () => {
    const p = spawnDaemon();

    const hasStartup = await waitForLogContent(logPath(tempHome), `Daemon started (PID ${p.pid})`);
    expect(hasStartup).toBe(true);
  });

  test("log contains sync interval message", async () => {
    spawnDaemon();

    const hasInterval = await waitForLogContent(logPath(tempHome), "Sync interval:");
    expect(hasInterval).toBe(true);

    const logContent = readFileSync(logPath(tempHome), "utf-8");
    expect(logContent).toContain("minutes");
  });

  test("daemon removes PID file on SIGTERM", async () => {
    const p = spawnDaemon();

    // Wait for daemon to be ready (PID file written)
    const started = await waitForFile(pidPath(tempHome));
    expect(started).toBe(true);

    // Send SIGTERM
    p.kill("SIGTERM");
    const exitCode = await p.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(pidPath(tempHome))).toBe(false);
  });

  test("daemon removes PID file on SIGINT", async () => {
    const p = spawnDaemon();

    // Wait for daemon to be ready
    const started = await waitForFile(pidPath(tempHome));
    expect(started).toBe(true);

    // Send SIGINT
    p.kill("SIGINT");
    const exitCode = await p.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(pidPath(tempHome))).toBe(false);
  });

  test("daemon exits cleanly after SIGTERM", async () => {
    const p = spawnDaemon();

    const started = await waitForFile(pidPath(tempHome));
    expect(started).toBe(true);

    p.kill("SIGTERM");
    const exitCode = await p.exited;

    expect(exitCode).toBe(0);
  });

  test("daemon exits cleanly after SIGINT", async () => {
    const p = spawnDaemon();

    const started = await waitForFile(pidPath(tempHome));
    expect(started).toBe(true);

    p.kill("SIGINT");
    const exitCode = await p.exited;

    expect(exitCode).toBe(0);
  });
});
