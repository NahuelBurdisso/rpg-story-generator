import { describe, it, expect } from "vitest";
import {
  effectiveSalience,
  scoreMemory,
  KeywordRanker,
  tagOverlap,
} from "../../server/pipeline/memory/score";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m1", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player burned the warehouse", valence: -80, salienceBase: 90,
    source: "witnessed", confidence: 100, threadId: null, sessionId: null,
    messageId: null, introducedTurn: 5, lastReinforcedTurn: 5, status: "active",
    createdAt: 0, ...over,
  };
}

describe("effectiveSalience", () => {
  it("equals base at the reinforcement turn", () => {
    expect(effectiveSalience(mem({ salienceBase: 80, lastReinforcedTurn: 10 }), 10)).toBe(80);
  });
  it("decays monotonically as turns pass", () => {
    const m = mem({ salienceBase: 80, lastReinforcedTurn: 0 });
    const s1 = effectiveSalience(m, 5);
    const s2 = effectiveSalience(m, 20);
    expect(s1).toBeLessThan(80);
    expect(s2).toBeLessThan(s1);
    expect(s2).toBeGreaterThanOrEqual(0);
  });
});

describe("tagOverlap", () => {
  it("is higher when scene words overlap the memory content", () => {
    const m = mem({ content: "the player burned the warehouse" });
    const hot = tagOverlap("you mention the burned warehouse", m);
    const cold = tagOverlap("a quiet morning by the river", m);
    expect(hot).toBeGreaterThan(cold);
  });
});

describe("scoreMemory", () => {
  it("ranks a hot, recent, scene-relevant memory above a faint, stale, irrelevant one", () => {
    const ranker = new KeywordRanker();
    const hot = scoreMemory(mem({ valence: -80, salienceBase: 90, lastReinforcedTurn: 19,
      content: "player burned the warehouse" }), 20, "the warehouse still smells of smoke", ranker);
    const faint = scoreMemory(mem({ valence: 5, salienceBase: 20, lastReinforcedTurn: 0,
      content: "player asked the time" }), 20, "the warehouse still smells of smoke", ranker);
    expect(hot).toBeGreaterThan(faint);
  });
});
