import { describe, it, expect } from "vitest";
import { memoriesToSeed } from "../../server/pipeline/memory/seeds";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player betrayed me", valence: -85, salienceBase: 90, source: "witnessed",
    confidence: 100, threadId: "t1", sessionId: null, messageId: null,
    introducedTurn: 2, lastReinforcedTurn: 2, status: "active", createdAt: 0, ...over,
  };
}

describe("memoriesToSeed", () => {
  it("derives one seed from a hot, negative, player memory tied to a thread", () => {
    const seed = memoriesToSeed([mem()], 4);
    expect(seed).not.toBeNull();
    expect(seed!.threadId).toBe("t1");
    expect(typeof seed!.trigger).toBe("string");
    expect(typeof seed!.echo).toBe("string");
  });
  it("returns null when no memory is hot enough", () => {
    expect(memoriesToSeed([mem({ salienceBase: 10, lastReinforcedTurn: 0 })], 60)).toBeNull();
  });
  it("ignores non-player memories", () => {
    expect(memoriesToSeed([mem({ about: "Sera" })], 4)).toBeNull();
  });
  it("uses strongly positive player memories as seeds", () => {
    const seed = memoriesToSeed([mem({ valence: 70 })], 4);
    expect(seed).not.toBeNull();
    expect(seed!.echo).toMatch(/gratitud|favor|devuelve/i);
  });
  it("ignores mildly positive player memories", () => {
    expect(memoriesToSeed([mem({ valence: 20 })], 4)).toBeNull();
  });
  it("returns at most one seed (the hottest)", () => {
    const seed = memoriesToSeed([mem({ content: "a", valence: -60 }), mem({ content: "b", valence: -95 })], 4);
    expect(seed!.trigger).toContain("b");
  });
});
