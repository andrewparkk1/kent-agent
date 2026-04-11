/**
 * Notion source — pulls pages from a Notion workspace via the Notion API.
 * Requires a Notion integration token set via NOTION_TOKEN env var or
 * config keys.notion. Fetches recently edited pages and their block content.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";
import { loadConfig } from "@shared/config.ts";

async function notionApi(endpoint: string, body: any, token: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/** Extract the title string from a Notion page object. */
function extractTitle(page: any): string {
  const props = page.properties ?? {};
  // Look for a property with type "title"
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((t: any) => t.plain_text ?? "").join("");
    }
  }
  return "Untitled";
}

/** Convert a single Notion block to plain text. */
function blockToText(block: any): string {
  const type = block.type;
  if (!type) return "";
  const data = block[type];
  if (!data) return "";

  const richText = data.rich_text ?? data.text ?? [];
  const text = Array.isArray(richText)
    ? richText.map((t: any) => t.plain_text ?? "").join("")
    : "";

  switch (type) {
    case "paragraph":
      return text;
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do":
      return `[${data.checked ? "x" : " "}] ${text}`;
    case "toggle":
      return `> ${text}`;
    case "quote":
      return `> ${text}`;
    case "code":
      return `\`\`\`\n${text}\n\`\`\``;
    case "callout":
      return `> ${text}`;
    case "divider":
      return "---";
    case "image":
      return "[image]";
    case "bookmark":
      return data.url ?? "[bookmark]";
    case "equation":
      return data.expression ?? "";
    default:
      return text;
  }
}

/** Fetch all block children for a page, converting to plain text. */
async function fetchPageContent(pageId: string, token: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    const endpoint = `/blocks/${pageId}/children${cursor ? `?start_cursor=${cursor}` : ""}`;
    const result = await notionApi(endpoint, null, token);
    const blocks = result.results ?? [];

    for (const block of blocks) {
      const text = blockToText(block);
      if (text) lines.push(text);
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

export const notion: Source = {
  name: "notion",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
    const config = loadConfig();
    const token =
      process.env.NOTION_TOKEN ||
      (config.keys as Record<string, string>).notion ||
      "";

    if (!token) {
      return [];
    }

    const lastSync = state.getLastSync("notion");
    const defaultDays = options?.defaultDays ?? 365;
    const sinceTs =
      lastSync > 0
        ? lastSync
        : defaultDays === 0
          ? 0
          : Math.floor((Date.now() - defaultDays * 24 * 60 * 60 * 1000) / 1000);

    const items: Item[] = [];
    const limit = options?.limit ?? 100;
    let cursor: string | undefined;
    let pageCount = 0;

    // Paginate through search results
    do {
      const body: any = {
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: Math.min(limit - pageCount, 100),
      };
      if (cursor) body.start_cursor = cursor;

      const result = await notionApi("/search", body, token);
      const pages = result.results ?? [];

      for (const page of pages) {
        if (pageCount >= limit) break;

        const lastEdited = page.last_edited_time
          ? Math.floor(new Date(page.last_edited_time).getTime() / 1000)
          : 0;

        // Stop if we've gone past our sync window (results are sorted desc)
        if (lastEdited <= sinceTs) {
          // All remaining pages are older, stop pagination
          cursor = undefined;
          break;
        }

        const title = extractTitle(page);
        const createdTime = page.created_time
          ? Math.floor(new Date(page.created_time).getTime() / 1000)
          : Math.floor(Date.now() / 1000);

        // Fetch page block content
        const content = await fetchPageContent(page.id, token);
        const fullContent = title ? `${title}\n\n${content}` : content;

        const parentType = page.parent?.type ?? "unknown";
        const url = page.url ?? "";

        items.push({
          source: "notion",
          externalId: `notion-${page.id}`,
          content: fullContent,
          metadata: {
            title,
            url,
            lastEditedAt: page.last_edited_time,
            parentType,
          },
          createdAt: createdTime,
        });

        pageCount++;
        if (options?.onProgress) {
          options.onProgress(pageCount);
        }
      }

      cursor =
        pageCount < limit && result.has_more ? result.next_cursor : undefined;
    } while (cursor);

    return items;
    } catch (e) {
      console.warn(`[notion] Failed to fetch pages: ${e}`);
      return [];
    }
  },
};
