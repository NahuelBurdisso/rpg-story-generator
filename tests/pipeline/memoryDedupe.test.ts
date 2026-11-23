import { describe, it, expect } from "vitest";
import { similarity, findReinforceTarget } from "../../server/pipeline/memory/dedupe";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m1", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player spared my brother at the bridge", valence: 60, salienceBase: 70,
    source: "witnessed", confidence: 100, threadId: null, sessionId: null, messageId: null,
    introducedTurn: 1, lastReinforcedTurn: 1, status: "active", createdAt: 0, ...over,
  };
}

describe("similarity", () => {
  it("is high for near-identical content", () => {
    expect(similarity("player spared my brother at the bridge", "the player spared my brother on the bridge"))
      .toBeGreaterThan(0.6);
  });
  it("is low for unrelated content", () => {
    expect(similarity("player spared my brother", "player bought a horse in town")).toBeLessThan(0.4);
  });
});

describe("findReinforceTarget", () => {
  it("returns an existing memory with same 'about' and similar content", () => {
    const existing = [mem({ id: "old", about: "player", content: "player spared my brother at the bridge" })];
    const hit = findReinforceTarget(existing, { about: "player", content: "the player spared my brother on the bridge" });
    expect(hit?.id).toBe("old");
  });
  it("returns null when 'about' differs", () => {
    const existing = [mem({ id: "old", about: "Sera", content: "player spared my brother at the bridge" })];
    expect(findReinforceTarget(existing, { about: "player", content: "player spared my brother at the bridge" })).toBeNull();
  });
  it("returns null when content is dissimilar", () => {
    const existing = [mem({ id: "old", about: "player", content: "player bought a horse" })];
    expect(findReinforceTarget(existing, { about: "player", content: "player burned the warehouse" })).toBeNull();
  });
});
