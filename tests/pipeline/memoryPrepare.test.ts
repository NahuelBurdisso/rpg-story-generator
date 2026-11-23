import { describe, it, expect } from "vitest";
import { prepareMemoryRows } from "../../server/pipeline/memory/prepare";

const sceneNpcs = [{ id: "npc-sera", name: "Sera Vane" }, { id: "npc-dax", name: "Dax Korr" }];
const ctx = { campaignId: "camp1", sessionId: "sess1", messageId: "msg1", turn: 7 };

describe("prepareMemoryRows", () => {
  it("resolves holder name to npcId (case-insensitive) and fills defaults", () => {
    const rows = prepareMemoryRows(
      [{ npc: "sera vane", about: "player", content: "spared my brother", valence: 60, salience: 80, threadId: "t1" }],
      sceneNpcs, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      npcId: "npc-sera", campaignId: "camp1", about: "player", content: "spared my brother",
      valence: 60, salienceBase: 80, source: "witnessed", confidence: 100, threadId: "t1",
      sessionId: "sess1", messageId: "msg1", introducedTurn: 7, lastReinforcedTurn: 7,
      kind: "episodic", status: "active",
    });
  });

  it("drops a memory whose holder is not in the scene", () => {
    const rows = prepareMemoryRows(
      [{ npc: "Unknown Stranger", about: "player", content: "x", valence: 0, salience: 50 }],
      sceneNpcs, ctx);
    expect(rows).toEqual([]);
  });
});
