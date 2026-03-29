#!/usr/bin/env bun
/**
 * Dump all synced items from Convex, grouped by source.
 *
 * Usage:
 *   bun scripts/dump-items.ts                  # all sources
 *   bun scripts/dump-items.ts --source gmail   # one source
 *   bun scripts/dump-items.ts --limit 5        # limit per source
 *   bun scripts/dump-items.ts --json           # raw JSON output
 */
import { loadConfig, KENT_CONVEX_URL } from "../shared/config.ts";
import { ConvexHttpClient } from "convex/browser";

const config = loadConfig();
if (!config.core.device_token) {
  console.error("No device token. Run: kent init");
  process.exit(1);
}

const client = new ConvexHttpClient(KENT_CONVEX_URL);

// Parse args
const args = process.argv.slice(2);
const sourceIdx = args.indexOf("--source");
const sourceFilter = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50;
const jsonMode = args.includes("--json");

// Fetch stats first
const stats = await client.query("items:getStats" as any, {
  deviceToken: config.core.device_token,
});

if (!jsonMode) {
  console.log("=== Kent Sync Stats ===\n");
  for (const [source, info] of Object.entries(stats as Record<string, any>)) {
    const earliest = new Date(info.earliest * 1000).toLocaleDateString();
    const latest = new Date(info.latest * 1000).toLocaleDateString();
    console.log(`  ${source}: ${info.count} items (${earliest} → ${latest})`);
  }
  console.log("");
}

// Fetch items
const sources = sourceFilter ? [sourceFilter] : Object.keys(stats as object);

for (const source of sources) {
  const items = await client.query("items:getRecentItems" as any, {
    deviceToken: config.core.device_token,
    source,
    limit,
  });

  if (jsonMode) {
    console.log(JSON.stringify({ source, items }, null, 2));
    continue;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${source.toUpperCase()} (${(items as any[]).length} shown)`);
  console.log(`${"=".repeat(60)}`);

  for (const item of items as any[]) {
    const date = new Date(item.createdAt * 1000);
    const dateStr = date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    console.log(`\n--- [${dateStr}] ${item.externalId} ---`);

    // Print content (truncated)
    const content = item.content || "";
    const lines = content.split("\n").slice(0, 6);
    for (const line of lines) {
      console.log(`  ${line.slice(0, 120)}`);
    }
    if (content.split("\n").length > 6) {
      console.log(`  ... (${content.split("\n").length - 6} more lines)`);
    }

    // Print key metadata
    const meta = item.metadata || {};
    const metaKeys = Object.entries(meta)
      .filter(([_, v]) => v !== null && v !== undefined && v !== false && v !== "")
      .slice(0, 5);
    if (metaKeys.length > 0) {
      const metaStr = metaKeys
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(", ");
      console.log(`  [meta: ${metaStr.slice(0, 120)}]`);
    }
  }
}

console.log("\nDone.");
