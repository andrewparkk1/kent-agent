import type { Message } from "./types";

export const ASSISTANT_DUPLICATE_MIN_CHARS = 20;

export function normalizeAssistantText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isDuplicateAssistantSegment(text: string, finalizedSegments: string[]): boolean {
  const normalized = normalizeAssistantText(text);
  if (!normalized) return false;
  return finalizedSegments.some(
    (prev) => prev === normalized || prev.startsWith(normalized) || normalized.startsWith(prev),
  );
}

export function dedupeLoadedMessages(allMsgs: Message[]): Message[] {
  const normalizedAssistantTexts: string[] = allMsgs
    .filter((m: Message) => m.role === "assistant")
    .map((m: Message) => normalizeAssistantText(m.content))
    .filter(Boolean);

  return allMsgs.filter((m: Message, i: number, arr: Message[]) => {
    if (i > 0) {
      const prev = arr[i - 1];
      if (m.role === prev.role && m.content === prev.content) return false;
    }
    if (m.role === "assistant") {
      const normalized = normalizeAssistantText(m.content);
      if (!normalized) return false;
      const hasLongerVariant = normalizedAssistantTexts.some(
        (other) => other !== normalized && other.startsWith(normalized),
      );
      if (hasLongerVariant) return false;
      const firstIdx = allMsgs.findIndex(
        (om) => om.role === "assistant" && normalizeAssistantText(om.content) === normalized,
      );
      if (firstIdx !== i) return false;
    }
    return true;
  });
}

export function dedupeAssistantItemsForRender(items: Message[]): Message[] {
  const keptAssistants: Array<{ normalized: string; outIndex: number }> = [];
  const hiddenOutIndices = new Set<number>();
  const out: Message[] = [];

  for (const item of items) {
    if (item.role !== "assistant") {
      out.push(item);
      continue;
    }

    const normalized = normalizeAssistantText(item.content);
    if (!normalized) {
      out.push(item);
      continue;
    }

    let skipCurrent = false;
    const replacedIndices: number[] = [];

    for (let i = 0; i < keptAssistants.length; i++) {
      const kept = keptAssistants[i]!;
      if (kept.normalized === normalized) {
        skipCurrent = true;
        break;
      }

      const comparable = kept.normalized.length >= ASSISTANT_DUPLICATE_MIN_CHARS
        && normalized.length >= ASSISTANT_DUPLICATE_MIN_CHARS;
      if (!comparable) continue;

      if (kept.normalized.startsWith(normalized)) {
        skipCurrent = true;
        break;
      }
      if (normalized.startsWith(kept.normalized)) {
        replacedIndices.push(i);
      }
    }

    if (skipCurrent) continue;

    for (const idx of replacedIndices.reverse()) {
      const replaced = keptAssistants[idx]!;
      hiddenOutIndices.add(replaced.outIndex);
      keptAssistants.splice(idx, 1);
    }

    out.push(item);
    keptAssistants.push({ normalized, outIndex: out.length - 1 });
  }

  if (hiddenOutIndices.size === 0) return out;
  return out.filter((_m, idx) => !hiddenOutIndices.has(idx));
}

export function sortAssistantGroupItemsForDisplay(items: Message[]): Message[] {
  const tools = items.filter((item) => item.role === "tool");
  const others = items.filter((item) => item.role !== "tool");
  return [...tools, ...others];
}

export function messageRenderKey(message: Message, index: number, scope = "msg"): string {
  return `${scope}:${message.id}:${message.role}:${message.created_at}:${index}`;
}

