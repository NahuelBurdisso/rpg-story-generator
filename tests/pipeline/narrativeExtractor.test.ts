import { describe, it, expect } from "vitest";
import { parseNarrativeState } from "@/server/pipeline/narrativeExtractor";

describe("parseNarrativeState", () => {
  it("extracts the story key from a fenced/noisy LLM response", () => {
    const raw = 'sure!\n```json\n{"story":{"threadUpdates":[{"id":"t1","status":"escalating"}],"newThreads":[],"tensionRead":55}}\n```';
    const r = parseNarrativeState(raw);
    expect(r.story?.tensionRead).toBe(55);
    expect(r.story?.threadUpdates[0].status).toBe("escalating");
  });
  it("drops filler updates that only say a thread is still open", () => {
    // Playtest (e4b): every thread listed every turn, so none ever went stale.
    const raw = JSON.stringify({ story: { threadUpdates: [
      { id: "a", status: "open", notes: "Slate's warning and pressure remain active, awaiting player response." },
      { id: "b", notes: "Teo's mysterious handwritten note remains a point of interest." },
      { id: "c", status: "open", notes: "Okafor confirms the danger, elevating the threat." },
      { id: "d", status: "escalating", notes: "The risk still grows." },
    ], newThreads: [], tensionRead: 50 } });
    expect(parseNarrativeState(raw).story.threadUpdates.map((u) => u.id)).toEqual(["c", "d"]);
  });

  it("returns empty story on malformed JSON without throwing", () => {
    expect(parseNarrativeState("no json here").story).toEqual({ threadUpdates: [], newThreads: [], tensionRead: NaN });
  });

  it("drops malformed threadUpdates (no id) and malformed newThreads (no label/kind/weight) without throwing", () => {
    const raw = JSON.stringify({
      story: {
        threadUpdates: [
          { id: "t1", status: "escalating" },   // valid
          { status: "resolved" },                // malformed — missing id
        ],
        newThreads: [
          { label: "rising flood", kind: "threat", weight: 3 }, // valid
          { kind: "mystery", weight: 2 },                        // malformed — missing label
          { label: "cursed relic", weight: 2 },                 // malformed — missing kind
          { label: "haunted well", kind: "promise" },            // malformed — missing weight (not a number)
        ],
        tensionRead: 40,
      },
    });
    let result: ReturnType<typeof parseNarrativeState>;
    expect(() => { result = parseNarrativeState(raw); }).not.toThrow();
    const { threadUpdates, newThreads } = result!.story;
    // Only the valid element survives in each array
    expect(threadUpdates).toHaveLength(1);
    expect(threadUpdates[0].id).toBe("t1");
    expect(newThreads).toHaveLength(1);
    expect(newThreads[0].label).toBe("rising flood");
  });

  // ------------------------------------------------------------------
  // npc key tests (Task 2.3)
  // ------------------------------------------------------------------

  it("extracts valid npc.updates and drops malformed entries (no name) without throwing", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 30 },
      npc: {
        updates: [
          { name: "the informant", goal: "protect the secret", agenda: "deflect questions", agendaThreadId: "t1" },
          { goal: "x" }, // malformed — no name
        ],
      },
    });
    let result: ReturnType<typeof parseNarrativeState>;
    expect(() => { result = parseNarrativeState(raw); }).not.toThrow();
    const { updates } = result!.npc;
    expect(updates).toHaveLength(1);
    expect(updates[0].name).toBe("the informant");
    expect(updates[0].goal).toBe("protect the secret");
    expect(updates[0].agenda).toBe("deflect questions");
    expect(updates[0].agendaThreadId).toBe("t1");
  });

  it("returns npc.updates === [] when npc key is absent", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 10 },
    });
    const result = parseNarrativeState(raw);
    expect(result.npc.updates).toEqual([]);
  });

  it("drops non-string goal/agenda/agendaThreadId fields but keeps the valid name entry", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 20 },
      npc: {
        updates: [
          { name: "the barkeep", goal: 42, agenda: null, agendaThreadId: "t2" },
        ],
      },
    });
    const result = parseNarrativeState(raw);
    const entry = result.npc.updates[0];
    expect(entry.name).toBe("the barkeep");
    expect(entry.goal).toBeUndefined();    // non-string dropped
    expect(entry.agenda).toBeUndefined();  // null dropped
    expect(entry.agendaThreadId).toBe("t2"); // valid string kept
  });

  // ------------------------------------------------------------------
  // world key tests (Task 3.4)
  // ------------------------------------------------------------------

  it("extracts valid world.newSeeds and drops malformed entries (no trigger) without throwing", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 50 },
      npc: { updates: [] },
      world: {
        newSeeds: [
          { trigger: "pressed the informant", echo: "cultists bar the doors", threadId: "t1" }, // valid
          { echo: "x" }, // malformed — no trigger
        ],
      },
    });
    let result: ReturnType<typeof parseNarrativeState>;
    expect(() => { result = parseNarrativeState(raw); }).not.toThrow();
    const { newSeeds } = result!.world;
    expect(newSeeds).toHaveLength(1);
    expect(newSeeds[0].trigger).toBe("pressed the informant");
    expect(newSeeds[0].echo).toBe("cultists bar the doors");
    expect(newSeeds[0].threadId).toBe("t1");
  });

  it("returns world.newSeeds === [] when world key is absent", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 10 },
      npc: { updates: [] },
    });
    const result = parseNarrativeState(raw);
    expect(result.world.newSeeds).toEqual([]);
  });

  it("drops newSeed where trigger is empty string or echo is empty string", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 10 },
      npc: { updates: [] },
      world: {
        newSeeds: [
          { trigger: "", echo: "something happens" },     // empty trigger — drop
          { trigger: "player does X", echo: "" },         // empty echo — drop
          { trigger: "player Y", echo: "world reacts" },  // valid
        ],
      },
    });
    const result = parseNarrativeState(raw);
    expect(result.world.newSeeds).toHaveLength(1);
    expect(result.world.newSeeds[0].trigger).toBe("player Y");
  });

  it("copies threadId only when it is a string; omits it otherwise", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 10 },
      npc: { updates: [] },
      world: {
        newSeeds: [
          { trigger: "did A", echo: "result A", threadId: 42 },    // non-string threadId — omit
          { trigger: "did B", echo: "result B", threadId: "t2" },  // string — keep
          { trigger: "did C", echo: "result C" },                   // absent — omit
        ],
      },
    });
    const result = parseNarrativeState(raw);
    expect(result.world.newSeeds).toHaveLength(3);
    expect(result.world.newSeeds[0].threadId).toBeUndefined();
    expect(result.world.newSeeds[1].threadId).toBe("t2");
    expect(result.world.newSeeds[2].threadId).toBeUndefined();
  });
});

describe("parseNarrativeState thread field normalization", () => {
  const parse = (story: object) => parseNarrativeState(JSON.stringify({ story: { tensionRead: 50, threadUpdates: [], newThreads: [], ...story } })).story;

  it("trims and lowercases a status, and ignores one that is not a ThreadStatus", () => {
    const { threadUpdates } = parse({
      threadUpdates: [
        { id: "a", status: " Escalating ", notes: "n" },
        { id: "b", status: "ongoing", notes: "n" },
      ],
    });
    expect(threadUpdates).toEqual([{ id: "a", status: "escalating", notes: "n" }, { id: "b", notes: "n" }]);
  });

  it("treats an unknown status like a missing one for the filler filter", () => {
    const { threadUpdates } = parse({ threadUpdates: [{ id: "a", status: "ongoing", notes: "still unresolved" }] });
    expect(threadUpdates).toEqual([]);
  });

  it("normalizes new-thread kind (case, unknown -> goal) and rounds/clamps weight", () => {
    const { newThreads } = parse({
      newThreads: [
        { label: "a", kind: " Mystery ", weight: 2.6 },
        { label: "b", kind: "quest", weight: 9 },
        { label: "c", kind: "threat", weight: -4 },
        { label: "d", kind: "threat", weight: "3" },
      ],
    });
    expect(newThreads.map((t) => [t.kind, t.weight])).toEqual([["mystery", 3], ["goal", 5], ["threat", 1]]);
  });
});
