import { describe, it, expect } from "vitest";
import { buildNarratorPrompt } from "../../server/pipeline/promptBuilder";
import type { DirectorDecision, NPCMemoryDoc, RetrievedMemory } from "@/types";

const baseDirector: DirectorDecision = {
  phase: "rising", tension: 30, intent: "develop", wordBudget: "100-200 words",
  spotlight: undefined, gmInitiative: "", actingNpc: undefined, consequenceEcho: undefined,
  activeThreads: [],
};

const base = {
  campaign: { genre: "fantasy", tone: "dark", difficulty: "normal", worldDescription: "w", plotHooks: [] as string[] },
  characters: [{ name: "Kael", role: "warrior", stats: {}, inventory: [] as string[] }],
  director: baseDirector,
  sceneSummary: "s", contextSummary: undefined, sceneState: null,
};

/** Helper to build a minimal NPCMemoryDoc for test */
function npc(
  overrides: Partial<NPCMemoryDoc> & Pick<NPCMemoryDoc, "id" | "name" | "personality">,
  memories?: RetrievedMemory[]
): NPCMemoryDoc & { memories?: RetrievedMemory[] } {
  return {
    campaignId: "c1",
    location: "unknown",
    relationships: [],
    secrets: [],
    revealedInfo: [],
    memoryLog: [],
    currentState: "idle",
    speechPattern: null,
    vocabulary: null,
    deepHistory: null,
    goal: null,
    agenda: null,
    agendaThreadId: null,
    lastActedTurn: null,
    lastInteractedAt: null,
    ...overrides,
    ...(memories ? { memories } : {}),
  };
}

describe("buildNarratorPrompt — REMEMBERS block", () => {
  it("renders retrieved memories under the NPC", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [npc(
        { id: "n1", name: "Sera", personality: "guarded" },
        [{ id: "m", about: "player", kind: "episodic", content: "the player spared my brother",
          valence: 60, source: "witnessed", confidence: 100, effectiveSalience: 70 }],
      )],
    }, "I greet Sera");
    expect(prompt).toContain("REMEMBERS");
    expect(prompt).toContain("spared my brother");
  });

  it("hedges heard/rumor memories", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [npc(
        { id: "n1", name: "Dax", personality: "gruff" },
        [{ id: "m", about: "player", kind: "episodic", content: "the player torched the docks",
          valence: -50, source: "heard", confidence: 60, effectiveSalience: 50 }],
      )],
    }, "hi");
    expect(prompt).toMatch(/heard from others|believes/i);
  });

  it("omits the block when an NPC has no memories", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [npc({ id: "n1", name: "Sera", personality: "guarded" })],
    }, "hi");
    expect(prompt).not.toContain("REMEMBERS");
  });
});
