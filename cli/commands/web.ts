/** `kent web` — opens the local web dashboard (if built) on port 3456. */
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const PORT = 3456;

async function isPortInUse(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/counts`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function handleWeb(): Promise<void> {
  const alreadyRunning = await isPortInUse();

  if (!alreadyRunning) {
    // Start server in background
    const serverScript = resolve(import.meta.dir, "../../web/server.ts");
    const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();

    const proc = Bun.spawn(["bash", "-c", `nohup "${bunPath}" run "${serverScript}" > /dev/null 2>&1 &`], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    await proc.exited;

    // Wait for server to be ready
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await isPortInUse()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Open in default browser
  try {
    execFileSync("open", [`http://localhost:${PORT}`]);
  } catch {
    console.log(`Open http://localhost:${PORT} in your browser`);
  }

  console.log(`Kent web dashboard running at http://localhost:${PORT}`);
  if (!alreadyRunning) {
    console.log("Server started in background. To stop: lsof -ti:3456 | xargs kill");
  }
}
