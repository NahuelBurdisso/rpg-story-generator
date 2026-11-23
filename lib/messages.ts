import type { Message } from "@/types";

/** Flattens infinite-query pages (newest page first, each page chronological) into one chronological list, deduped by id. */
export function mergePages(pages: ReadonlyArray<{ messages: Message[] }> | undefined): Message[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: Message[] = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    for (const m of pages[i].messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** The hidden opener turn. Rows saved before metadata.opener existed are recognized by their prefix (legacy). */
export function isHiddenOpener(m: Pick<Message, "role" | "content" | "metadata">): boolean {
  return m.role === "user" && (m.metadata?.opener === true || m.content.startsWith("[SESSION START"));
}
