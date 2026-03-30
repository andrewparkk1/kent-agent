import { CONVEX_URL } from "@shared/config.ts";

/**
 * Lightweight Convex HTTP client for CLI/REPL usage.
 * Uses the Convex HTTP API directly (no SDK dependency).
 */

export async function convexQuery(
  functionPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = CONVEX_URL.replace(/\/$/, "");
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: functionPath, args }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Convex query ${functionPath} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    status: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value;
}

export async function convexMutation(
  functionPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = CONVEX_URL.replace(/\/$/, "");
  const res = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: functionPath, args }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Convex mutation ${functionPath} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    status: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value;
}

/**
 * Thread-specific helpers that wrap the Convex thread functions.
 */
export const threads = {
  async create(
    deviceToken: string,
    channel: string,
    title?: string,
  ): Promise<string> {
    return (await convexMutation("threads:create", {
      deviceToken,
      channel,
      title,
    })) as string;
  },

  async getRecent(
    deviceToken: string,
    channel?: string,
    limit?: number,
  ): Promise<
    Array<{
      _id: string;
      title?: string;
      channel: string;
      createdAt: number;
      lastMessageAt: number;
    }>
  > {
    return (await convexQuery("threads:getRecent", {
      deviceToken,
      channel,
      limit,
    })) as any;
  },

  async addMessage(
    deviceToken: string,
    threadId: string,
    role: string,
    content: string,
  ): Promise<string> {
    return (await convexMutation("threads:addMessage", {
      deviceToken,
      threadId,
      role,
      content,
    })) as string;
  },

  async getMessages(
    deviceToken: string,
    threadId: string,
    limit?: number,
  ): Promise<
    Array<{
      _id: string;
      role: string;
      content: string;
      createdAt: number;
    }>
  > {
    return (await convexQuery("threads:getMessages", {
      deviceToken,
      threadId,
      limit,
    })) as any;
  },

  async getOrCreate(
    deviceToken: string,
    channel: string,
    channelId: string,
  ): Promise<string> {
    return (await convexMutation("threads:getOrCreate", {
      deviceToken,
      channel,
      channelId,
    })) as string;
  },
};
