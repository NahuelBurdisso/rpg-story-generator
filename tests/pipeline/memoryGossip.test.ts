import { describe, it, expect } from "vitest";
import { planGossip, GOSSIP_SALIENCE_FLOOR } from "../../server/pipeline/memory/gossip";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m", campaignId: "c", npcId: "holder", about: "player", kind: "episodic",
    content: "player burned the warehouse", valence: -80, salienceBase: 95, source: "witnessed",
    confidence: 100, threadId: null, sessionId: null, messageId: null,
    introducedTurn: 1, lastReinforcedTurn: 1, status: "active", createdAt: 0, ...over,
  };
}

describe("planGossip", () => {
  it("copies a hot player memory to a recipient who lacks it, as 'heard' with lowered confidence", () => {
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a" })],
      recipientId: "b", recipientMemories: [], currentTurn: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ npcId: "b", about: "player", source: "heard", confidence: 60 });
    expect(out[0].salienceBase).toBeLessThan(95);
  });
  it("does not copy memories the recipient already holds", () => {
    const existing = mem({ npcId: "b", content: "player burned the warehouse" });
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a" })],
      recipientId: "b", recipientMemories: [existing], currentTurn: 1 });
    expect(out).toEqual([]);
  });
  it("skips faint memories and non-player subjects", () => {
    const out = planGossip({ holderId: "a",
      holderMemories: [mem({ npcId: "a", salienceBase: GOSSIP_SALIENCE_FLOOR - 10, lastReinforcedTurn: 0 }), mem({ npcId: "a", about: "Sera" })],
      recipientId: "b", recipientMemories: [], currentTurn: 30 });
    expect(out).toEqual([]);
  });
  it("downgrades to 'rumor' when the origin confidence is already low", () => {
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a", source: "heard", confidence: 50 })],
      recipientId: "b", recipientMemories: [], currentTurn: 1 });
    expect(out[0].source).toBe("rumor");
  });
});
