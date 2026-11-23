import { describe, it, expect } from "vitest";
import { mergePages, isHiddenOpener } from "@/lib/messages";
import type { Message } from "@/types";

const msg = (id: string, createdAt: number): Message =>
  ({ id, sessionId: "s1", role: "assistant", content: id, streamingText: null, isStreaming: false, metadata: null, createdAt }) as Message;

describe("mergePages", () => {
  it("returns an empty list before the first page arrives", () => {
    expect(mergePages(undefined)).toEqual([]);
  });

  it("flattens newest-first pages into one chronological list", () => {
    const pages = [
      { messages: [msg("c", 3), msg("d", 4)] }, // newest page
      { messages: [msg("a", 1), msg("b", 2)] }, // older page
    ];
    expect(mergePages(pages).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a message repeated across pages once", () => {
    const pages = [
      { messages: [msg("b", 2), msg("c", 3)] },
      { messages: [msg("a", 1), msg("b", 2)] },
    ];
    expect(mergePages(pages).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("isHiddenOpener", () => {
  it("hides only a user message that starts with the session-start prefix", () => {
    expect(isHiddenOpener({ ...msg("u", 1), role: "user", content: "[SESSION START — set the scene]" })).toBe(true);
    expect(isHiddenOpener({ ...msg("a", 1), content: "[SESSION START — echoed]" })).toBe(false);
    expect(isHiddenOpener({ ...msg("u2", 1), role: "user", content: "I open the door" })).toBe(false);
  });

  it("hides a user message flagged metadata.opener, whatever its text", () => {
    expect(isHiddenOpener({ ...msg("u3", 1), role: "user", content: "anything", metadata: { opener: true } })).toBe(true);
    expect(isHiddenOpener({ ...msg("a2", 1), content: "anything", metadata: { opener: true } })).toBe(false);
  });
});
