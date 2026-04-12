import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createNotionSource, notion } from "@daemon/sources/notion.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────

function titleProp(text: string) {
  return { type: "title", title: [{ plain_text: text }] };
}

function richText(text: string) {
  return [{ plain_text: text }];
}

const PAGES = [
  {
    id: "page-aaa",
    created_time: "2023-10-01T10:00:00Z",
    last_edited_time: "2023-11-14T10:00:00Z",
    url: "https://notion.so/page-aaa",
    parent: { type: "workspace" },
    properties: { Name: titleProp("Meeting Notes") },
  },
  {
    id: "page-bbb",
    created_time: "2023-10-02T10:00:00Z",
    last_edited_time: "2023-11-13T09:00:00Z",
    url: "https://notion.so/page-bbb",
    parent: { type: "database_id", database_id: "db-1" },
    properties: { Title: titleProp("Project Plan") },
  },
  {
    id: "page-ccc",
    created_time: "2023-10-03T10:00:00Z",
    last_edited_time: "2023-11-12T09:00:00Z",
    url: "https://notion.so/page-ccc",
    parent: { type: "page_id", page_id: "parent-page" },
    properties: { Name: titleProp("Ideas") },
  },
];

const BLOCKS: Record<string, any[]> = {
  "page-aaa": [
    { type: "heading_1", heading_1: { rich_text: richText("Sync") } },
    { type: "paragraph", paragraph: { rich_text: richText("Discussed roadmap") } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: richText("Ship v1") } },
  ],
  "page-bbb": [
    { type: "paragraph", paragraph: { rich_text: richText("Q4 plan") } },
    { type: "to_do", to_do: { rich_text: richText("Write RFC"), checked: false } },
  ],
  "page-ccc": [
    { type: "paragraph", paragraph: { rich_text: richText("Brainstorm") } },
  ],
};

function makeFetcher(): typeof fetch {
  return (async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url ?? input.toString();
    const path = url.replace("https://api.notion.com/v1", "");
    const method = init?.method ?? "GET";

    const json = (d: any) =>
      new Response(JSON.stringify(d), {
        headers: { "content-type": "application/json" },
      });

    if (path === "/search" && method === "POST") {
      return json({ results: PAGES, has_more: false });
    }
    const blocksMatch = path.match(/^\/blocks\/([^/]+)\/children/);
    if (blocksMatch) {
      const pid = blocksMatch[1]!;
      return json({ results: BLOCKS[pid] ?? [], has_more: false });
    }
    return json({ results: [] });
  }) as unknown as typeof fetch;
}

describe("notion source (mocked)", () => {
  test("exported notion still conforms to Source interface", () => {
    expect(notion.name).toBe("notion");
    expect(typeof notion.fetchNew).toBe("function");
  });

  test("returns empty array when no token", async () => {
    const src = createNotionSource({ token: null, fetcher: makeFetcher() });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("parses 3 pages with rendered block content and metadata", async () => {
    const src = createNotionSource({
      token: "secret_test",
      fetcher: makeFetcher(),
      now: () => Date.parse("2023-11-15T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 365 });

    for (const item of items) validateItem(item, "notion", /^notion-/);
    expect(items.length).toBe(3);

    const a = items.find((i) => i.externalId === "notion-page-aaa")!;
    expect(a).toBeDefined();
    expect(a.content).toBe(
      "Meeting Notes\n\n# Sync\nDiscussed roadmap\n- Ship v1",
    );
    expect(a.metadata.title).toBe("Meeting Notes");
    expect(a.metadata.url).toBe("https://notion.so/page-aaa");
    expect(a.metadata.parentType).toBe("workspace");
    expect(a.metadata.lastEditedAt).toBe("2023-11-14T10:00:00Z");
    expect(a.createdAt).toBe(Math.floor(Date.parse("2023-10-01T10:00:00Z") / 1000));

    const b = items.find((i) => i.externalId === "notion-page-bbb")!;
    expect(b).toBeDefined();
    expect(b.content).toBe("Project Plan\n\nQ4 plan\n[ ] Write RFC");
    expect(b.metadata.parentType).toBe("database_id");

    const c = items.find((i) => i.externalId === "notion-page-ccc")!;
    expect(c).toBeDefined();
    expect(c.content).toBe("Ideas\n\nBrainstorm");
    expect(c.metadata.parentType).toBe("page_id");
  });

  test("stops pagination when page lastEdited is older than lastSync", async () => {
    const src = createNotionSource({
      token: "secret_test",
      fetcher: makeFetcher(),
    });
    const state = new MockSyncState();
    // cutoff after page-aaa but before page-bbb
    const cutoff = Math.floor(Date.parse("2023-11-13T10:00:00Z") / 1000);
    state.resetSync("notion", cutoff);
    const items = await src.fetchNew(state);
    // only page-aaa (lastEdited 2023-11-14) survives
    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe("notion-page-aaa");
  });

  test.skipIf(!LIVE)("LIVE: pulls real Notion pages", async () => {
    const items = await notion.fetchNew(new MockSyncState(), { defaultDays: 30, limit: 5 });
    for (const item of items) validateItem(item, "notion", /^notion-/);
  }, 120_000);
});
