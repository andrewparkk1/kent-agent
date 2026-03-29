import type { Source, SyncState, Item } from "./types";

export const gmail: Source = {
  name: "gmail",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      // Check if gws CLI is available
      const whichProc = Bun.spawn(["which", "gws"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const whichCode = await whichProc.exited;
      if (whichCode !== 0) {
        console.warn("[gmail] gws CLI not installed, skipping");
        return [];
      }

      const proc = Bun.spawn(
        [
          "gws",
          "gmail",
          "users",
          "messages",
          "list",
          "--params",
          JSON.stringify({ userId: "me", q: "newer_than:1d", maxResults: 100 }),
          "--format",
          "json",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        console.warn(`[gmail] gws command failed: ${stderr}`);
        return [];
      }

      if (!stdout.trim()) return [];

      const messages = JSON.parse(stdout);

      if (!Array.isArray(messages)) {
        console.warn("[gmail] Unexpected gws output format");
        return [];
      }

      return messages.map((msg: any) => ({
        source: "gmail",
        externalId: `gmail-${msg.id || msg.messageId}`,
        content: [
          msg.subject ? `Subject: ${msg.subject}` : "",
          msg.from ? `From: ${msg.from}` : "",
          msg.snippet || msg.body || "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          subject: msg.subject,
          from: msg.from,
          to: msg.to,
          date: msg.date,
          labels: msg.labels || msg.labelIds || [],
          threadId: msg.threadId,
          hasAttachments: !!msg.hasAttachments,
        },
        createdAt: msg.date
          ? Math.floor(new Date(msg.date).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      }));
    } catch (e) {
      console.warn(`[gmail] Failed to fetch emails: ${e}`);
      return [];
    }
  },
};
