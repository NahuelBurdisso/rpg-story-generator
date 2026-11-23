import { describe, it, expect, vi } from "vitest";

// Mock the DB module so importing consolidate.ts doesn't open the real SQLite file
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/db/schema", () => ({ memories: {} }));

import { selectForConsolidation, CONSOLIDATION_THRESHOLD } from "../../server/pipeline/memory/consolidate";
import type { NPCMemoryEntry } from "../../types/index";

function mem(id: string, over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id, campaignId: "c", npcId: "n", about: "player", kind: "episodic", content: "c" + id,
    valence: 10, salienceBase: 50, source: "witnessed", confidence: 100, threadId: null,
    sessionId: null, messageId: null, introducedTurn: 0, lastReinforcedTurn: 0, status: "active",
    createdAt: 0, ...over,
  };
}

describe("selectForConsolidation", () => {
  it("returns empty when under threshold", () => {
    const few = Array.from({ length: 3 }, (_, i) => mem("m" + i));
    expect(selectForConsolidation(few, 10)).toEqual([]);
  });
  it("folds the faint tail once over threshold, keeps the salient head", () => {
    const many = Array.from({ length: CONSOLIDATION_THRESHOLD + 4 }, (_, i) =>
      mem("m" + i, { salienceBase: i < 4 ? 5 : 90, lastReinforcedTurn: i < 4 ? 0 : 10 }));
    const fold = selectForConsolidation(many, 10);
    expect(fold.length).toBeGreaterThan(0);
    expect(fold.every((m) => m.salienceBase <= 5)).toBe(true);   // only the faint ones
  });
});
