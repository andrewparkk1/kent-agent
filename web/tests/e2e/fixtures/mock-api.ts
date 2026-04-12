import type { Page, Route } from "@playwright/test";

export interface MockState {
  memories?: any[];
  memoryDetails?: Record<string, any>;
  workflows?: any[];
  sources?: any[];
  daemonStatus?: string;
  items?: any[];
  counts?: Record<string, number>;
  threads?: any[];
  threadMessages?: Record<string, any[]>;
  identity?: any;
  needsSetup?: boolean;
  unreadCount?: number;
  archivedIds?: string[];
  updatedMemories?: Record<string, any>;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function installApiMocks(page: Page, state: MockState = {}) {
  const archived = new Set(state.archivedIds ?? []);
  const updates = state.updatedMemories ?? {};

  await page.route("**/api/setup/status", (route) =>
    json(route, { needsSetup: state.needsSetup ?? false }),
  );

  await page.route("**/api/memories?**", (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q")?.toLowerCase();
    const type = url.searchParams.get("type");
    let memories = (state.memories ?? []).filter((m) => !archived.has(m.id));
    if (type) memories = memories.filter((m) => m.type === type);
    if (q) memories = memories.filter((m) => m.title.toLowerCase().includes(q));
    return json(route, { memories });
  });

  await page.route("**/api/memories", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const memories = (state.memories ?? []).filter((m) => !archived.has(m.id));
    return json(route, { memories });
  });

  await page.route("**/api/memories/*", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()!.split("?")[0]!;
    const method = route.request().method();

    if (method === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      updates[id] = body;
      return json(route, { ok: true });
    }

    const base = state.memoryDetails?.[id];
    if (!base) return json(route, { error: "not found" }, 404);
    const merged = { ...base.memory, ...(updates[id] ?? {}) };
    return json(route, { memory: merged, links: base.links ?? { outgoing: [], incoming: [] }, memoryIndex: base.memoryIndex ?? {} });
  });

  await page.route("**/api/memories/*/archive", (route) => {
    const id = route.request().url().split("/").slice(-2)[0]!;
    archived.add(id);
    return json(route, { ok: true });
  });

  await page.route("**/api/workflows", (route) =>
    json(route, { workflows: state.workflows ?? [], totalRuns: 0 }),
  );

  await page.route("**/api/sources", (route) =>
    json(route, {
      sources: state.sources ?? [],
      daemon: {
        status: state.daemonStatus ?? "stopped",
        currentSource: null,
        intervalSeconds: 300,
        lastSyncAt: null,
        nextSyncAt: null,
      },
    }),
  );

  await page.route("**/api/items?**", (route) =>
    json(route, { items: state.items ?? [], hasMore: false, total: (state.items ?? []).length }),
  );
  await page.route("**/api/counts", (route) => json(route, state.counts ?? {}));
  await page.route("**/api/activity/unread", (route) =>
    json(route, { count: state.unreadCount ?? 0 }),
  );

  await page.route("**/api/threads", (route) =>
    json(route, { threads: state.threads ?? [] }),
  );
  await page.route("**/api/threads/*/messages", (route) => {
    const url = route.request().url();
    const id = url.split("/").slice(-2)[0]!;
    return json(route, {
      messages: state.threadMessages?.[id] ?? [],
      thread: { id, status: "complete", workflow_name: null },
    });
  });
  await page.route("**/api/threads/*", (route) => {
    const id = route.request().url().split("/").pop()!.split("?")[0]!;
    return json(route, { messages: state.threadMessages?.[id] ?? [] });
  });

  await page.route("**/api/identity", (route) => {
    if (route.request().method() === "PUT") return json(route, { ok: true });
    return json(route, state.identity ?? { files: { "main.md": "# Identity\n\nNo identity yet." } });
  });

  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "POST") return json(route, { ok: true });
    return json(route, {
      config: {
        core: { device_token: "" },
        keys: { anthropic: "", openai: "", openrouter: "", google: "" },
        sources: {},
        daemon: { sync_interval_seconds: 300 },
        agent: { provider: "anthropic", default_model: "claude-sonnet-4-6", base_url: "", api_key: "" },
        telegram: { bot_token: "", chat_ids: [] },
      },
      raw: { keys: { anthropic: "", openai: "", openrouter: "", google: "" } },
      osUser: "test",
    });
  });
  await page.route("**/api/ollama/**", (route) => json(route, { models: [] }));
  await page.route("**/api/activity", (route) => json(route, { runs: [] }));
  await page.route("**/api/activity/seen", (route) => json(route, { ok: true }));
  await page.route("**/api/tools", (route) => json(route, { categories: [] }));
  await page.route("**/api/memories/index", (route) =>
    json(route, { index: state.memoryDetails?.["mem-1"]?.memoryIndex ?? {} }),
  );
  await page.route("**/api/brief**", (route) => json(route, { briefs: [] }));
  await page.route("**/api/feedback", (route) => json(route, { ok: true }));
  await page.route("**/api/sync/**", (route) => json(route, { ok: true }));
  await page.route("**/api/sources/**", (route) => json(route, { ok: true }));

  return { archived, updates };
}

export const sampleMemories = [
  {
    id: "mem-1",
    type: "person",
    title: "Andrew Park",
    summary: "Builder of [[Kent Agent]].",
    body: "## Background\nAndrew is the creator.\n\n## Projects\nWorks on [[Kent Agent]].",
    sources: ["imessage"],
    aliases: ["AP"],
    created_at: Date.now() / 1000 - 3600,
    updated_at: Date.now() / 1000 - 600,
  },
  {
    id: "mem-2",
    type: "project",
    title: "Kent Agent",
    summary: "A personal assistant.",
    body: "Built by [[Andrew Park]].",
    sources: ["imessage"],
    aliases: [],
    created_at: Date.now() / 1000 - 7200,
    updated_at: Date.now() / 1000 - 1200,
  },
  {
    id: "mem-3",
    type: "topic",
    title: "Machine Learning",
    summary: "ML topic notes.",
    body: "Notes about ML.",
    sources: [],
    aliases: [],
    created_at: Date.now() / 1000 - 86400,
    updated_at: Date.now() / 1000 - 86400,
  },
];

export const sampleMemoryIndex = {
  "andrew park": { id: "mem-1", type: "person", title: "Andrew Park" },
  "kent agent": { id: "mem-2", type: "project", title: "Kent Agent" },
};

export const sampleMemoryDetails = {
  "mem-1": {
    memory: sampleMemories[0],
    links: {
      outgoing: [{ id: "mem-2", type: "project", title: "Kent Agent", summary: "A personal assistant.", link_label: "creator of" }],
      incoming: [{ id: "mem-2", type: "project", title: "Kent Agent", summary: "A personal assistant.", link_label: "" }],
    },
    memoryIndex: sampleMemoryIndex,
  },
  "mem-2": {
    memory: sampleMemories[1],
    links: {
      outgoing: [{ id: "mem-1", type: "person", title: "Andrew Park", summary: "Builder.", link_label: "" }],
      incoming: [],
    },
    memoryIndex: sampleMemoryIndex,
  },
  "mem-3": {
    memory: sampleMemories[2],
    links: { outgoing: [], incoming: [] },
    memoryIndex: sampleMemoryIndex,
  },
};
