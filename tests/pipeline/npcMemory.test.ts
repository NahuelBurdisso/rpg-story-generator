import { describe, it, expect } from "vitest";
import { selectRelevantNPCs } from "../../server/pipeline/npcSelection";
import type { NpcMemoryRow } from "../../server/db/schema";

const mockNPCs: NpcMemoryRow[] = [
  { id: "1", campaignId: "c1", name: "Greta", lastInteractedAt: 100, personality: "gruff blacksmith", location: "forge", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "idle", speechPattern: null, vocabulary: null, goal: null, agenda: null, agendaThreadId: null, lastActedTurn: null, deepHistory: null },
  { id: "2", campaignId: "c1", name: "Finn", lastInteractedAt: 200, personality: "cheerful bard", location: "tavern", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "idle", speechPattern: null, vocabulary: null, goal: null, agenda: null, agendaThreadId: null, lastActedTurn: null, deepHistory: null },
  { id: "3", campaignId: "c1", name: "Mordak", lastInteractedAt: 50, personality: "shady merchant", location: "market", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "idle", speechPattern: null, vocabulary: null, goal: null, agenda: null, agendaThreadId: null, lastActedTurn: null, deepHistory: null },
  { id: "4", campaignId: "c1", name: "Elena", lastInteractedAt: 300, personality: "wise elder", location: "tower", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "idle", speechPattern: null, vocabulary: null, goal: null, agenda: null, agendaThreadId: null, lastActedTurn: null, deepHistory: null },
];

describe("selectRelevantNPCs", () => {
  it("prioritizes NPCs mentioned in player message", () => {
    const result = selectRelevantNPCs("I want to talk to Mordak", [], mockNPCs, 3);
    expect(result[0].name).toBe("Mordak");
  });

  it("includes NPCs from recent assistant messages", () => {
    const result = selectRelevantNPCs("hello", ["Greta hands you the sword."], mockNPCs, 3);
    expect(result.some((n) => n.name === "Greta")).toBe(true);
  });

  it("fills remaining slots by recency", () => {
    const result = selectRelevantNPCs("generic action", [], mockNPCs, 3);
    expect(result[0].name).toBe("Elena");
    expect(result[1].name).toBe("Finn");
    expect(result[2].name).toBe("Greta");
  });

  it("respects max count", () => {
    const result = selectRelevantNPCs("talk to Mordak and Greta and Finn and Elena", [], mockNPCs, 3);
    expect(result).toHaveLength(3);
  });

  it("handles empty NPC list", () => {
    const result = selectRelevantNPCs("hello", [], [], 3);
    expect(result).toEqual([]);
  });
});
