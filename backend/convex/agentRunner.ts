"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const E2B_API_KEY = process.env.E2B_API_KEY!;
const E2B_TEMPLATE_ID = process.env.E2B_TEMPLATE_ID || "andysampark/kent-agent";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CONVEX_URL = process.env.CONVEX_CLOUD_URL || process.env.CONVEX_URL || "";

// AES-256-GCM constants (must match cli/crypto.ts)
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Decrypt the user's API keys using their device token + salt.
 */
function decryptKeys(
  encryptedBlob: string,
  deviceToken: string,
  saltBase64: string,
): Record<string, string> {
  const salt = Buffer.from(saltBase64, "base64");
  const key = pbkdf2Sync(deviceToken, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
  const packed = Buffer.from(encryptedBlob, "base64");

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Run the Kent agent in an E2B sandbox for a given Telegram user's prompt.
 * Called from the Telegram webhook HTTP action.
 */
export const runForTelegram = internalAction({
  args: {
    telegramUserId: v.number(),
    prompt: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    // 1. Look up the user by Telegram ID
    const user = await ctx.runQuery(internal.telegram.getUserByTelegramId, {
      telegramUserId: args.telegramUserId,
    });

    if (!user) {
      return "❌ No Kent account linked to this Telegram. Run `kent init` first.";
    }

    if (!user.encryptedKeys || !user.encryptionSalt) {
      return "❌ No API keys configured. Run `kent init` and add your Anthropic key.";
    }

    // 2. Decrypt the API key
    let anthropicKey: string;
    try {
      const keys = decryptKeys(user.encryptedKeys, user.deviceToken, user.encryptionSalt);
      anthropicKey = keys.anthropic;
      if (!anthropicKey) {
        return "❌ No Anthropic key found. Run `kent init` to add one.";
      }
    } catch (err) {
      console.error("[agentRunner] Failed to decrypt keys:", err);
      return "❌ Could not decrypt API keys. Try re-running `kent init`.";
    }

    // 3. Create E2B sandbox and run the agent
    try {
      // Dynamic import — e2b is a Node.js dependency
      const { Sandbox } = await import("e2b");

      const runId = crypto.randomUUID();

      const sandbox = await Sandbox.create(E2B_TEMPLATE_ID, {
        timeoutMs: SANDBOX_TIMEOUT_MS,
        apiKey: E2B_API_KEY,
        envs: {
          ANTHROPIC_API_KEY: anthropicKey,
          CONVEX_URL: CONVEX_URL,
          DEVICE_TOKEN: user.deviceToken,
          RUNNER: "cloud",
          OUTPUT_DIR: "/outputs",
          MODEL: "claude-sonnet-4-20250514",
          MAX_TURNS: "10",
          RUN_ID: runId,
        },
      });

      // Write prompt to file to avoid shell escaping issues
      await sandbox.files.write("/tmp/prompt.txt", args.prompt);

      const cmd = [
        `export RUN_ID="${runId}"`,
        `export PROMPT="$(cat /tmp/prompt.txt)"`,
        "cd /agent",
        "bun run agent.ts",
      ].join(" && ");

      let output = "";

      await sandbox.commands.run(cmd, {
        timeoutMs: SANDBOX_TIMEOUT_MS,
        onStdout: (data: string) => {
          output += data;
        },
        onStderr: (_data: string) => {
          // Agent tool calls go to stderr — ignore for telegram response
        },
      });

      // Try to read the output file (agent writes final output here)
      try {
        const outputContent = await sandbox.files.read("/outputs/output.md");
        if (outputContent && outputContent.trim()) {
          output = outputContent;
        }
      } catch {
        // No output file — use stdout
      }

      // Kill sandbox (don't keep warm in serverless context)
      try {
        await Sandbox.kill(sandbox.sandboxId);
      } catch {
        // Non-critical
      }

      return output.trim() || "Agent completed but produced no output.";
    } catch (err) {
      console.error("[agentRunner] E2B execution failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return `❌ Agent error: ${msg}`;
    }
  },
});
