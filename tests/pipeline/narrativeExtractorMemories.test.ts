import { describe, it, expect } from "vitest";
import { parseNarrativeState, repairJson } from "../../server/pipeline/narrativeExtractor";

describe("parseNarrativeState — memories key", () => {
  it("parses well-formed memories", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 30 },
      npc: { updates: [] },
      world: { newSeeds: [] },
      memories: [
        { npc: "Sera", about: "player", content: "the player spared my brother", valence: 60, salience: 80, threadId: "t1" },
      ],
    });
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0]).toMatchObject({ npc: "Sera", about: "player", valence: 60, salience: 80, threadId: "t1" });
  });

  it("defaults memories to [] when key is missing", () => {
    const raw = JSON.stringify({ story: { threadUpdates: [], newThreads: [], tensionRead: 30 }, npc: { updates: [] }, world: { newSeeds: [] } });
    expect(parseNarrativeState(raw).memories).toEqual([]);
  });

  it("drops memories missing npc/content and clamps numbers", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 30 }, npc: { updates: [] }, world: { newSeeds: [] },
      memories: [
        { about: "player", content: "no holder" },                              // drop: no npc
        { npc: "Sera", content: "no about" },                                    // drop: no about
        { npc: "Sera", about: "player", content: "" },                           // drop: empty content
        { npc: "Sera", about: "player", content: "valid", valence: 999, salience: -5 }, // clamp
      ],
    });
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0].valence).toBe(100);
    expect(r.memories[0].salience).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(parseNarrativeState("not json").memories).toEqual([]);
  });

  it("recovers keys whose closing quote the model dropped", () => {
    // Shape captured from a local gemma model — `"salience:50` etc.
    const raw =
      '{"story":{"threadUpdates":[],"newThreads":[],"tensionRead":45},"npc":{"updates":[]},"world":{"newSeeds":[]},' +
      '"memories":[{"npc":"Brannoc","about":"Oren Vash","content":"Oren Vash compró la carga.","valence":0,"salience:50,"threadId":"t1"},' +
      '{"npc":"Brannoc","about":"The player","content":"Me prometió pagar mi deuda.","valence:10,"salience:60}],' +
      '"scene":{"location":"La taberna","activeNPCs":[{"name":"Brannoc","desc":"Tabernero","disposition:5}],"situation":"","pendingThreats":[],"timeOfDay":"evening"}}';
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(2);
    expect(r.memories[0]).toMatchObject({ npc: "Brannoc", salience: 50, threadId: "t1" });
    expect(r.memories[1]).toMatchObject({ valence: 10, salience: 60 });
    expect(r.scene.location).toBe("La taberna");
  });

  it("recovers every section when the model drops a closing brace mid-object", () => {
    // Captured shape: npc is never closed (`}],"world"`) and a key lost its quote.
    const raw =
      '{"story":{"threadUpdates":[{"id":"t1","status":"escalating"}],"newThreads":[],"tensionRead":45},' +
      '"npc":{"updates":[{"name":"Brannoc","agenda":"cobrar la deuda","interacted_with":["Me"]}],' +
      '"world":{"newSeeds":[{"trigger":"pagar en oro viejo","echo":"el Gremio se entera","threadId":"t1"}]},' +
      '"memories":[{"npc":"Brannoc","about":"The player","content":"Me prometió pagar mi deuda.","valence":10,"salience:60,"threadId":"t1"}],' +
      '"scene":{"location":"La taberna","activeNPCs":[],"situation":"","pendingThreats":[],"timeOfDay":"evening"}}';
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0]).toMatchObject({ npc: "Brannoc", salience: 60 });
    expect(r.npc.updates[0]).toMatchObject({ name: "Brannoc", agenda: "cobrar la deuda" });
    expect(r.world.newSeeds).toHaveLength(1);
    expect(r.story.tensionRead).toBe(45);
    expect(r.scene.location).toBe("La taberna");
  });

  it("recovers sections around an extra closing brace", () => {
    const raw =
      '{"story":{"threadUpdates":[],"newThreads":[],"tensionRead":20}},' +
      '"memories":[{"npc":"Sera","about":"player","content":"me salvó","valence":50,"salience":70}],' +
      '"scene":{"location":"El muelle","activeNPCs":[],"situation":"","pendingThreats":[],"timeOfDay":"night"}}';
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.scene.location).toBe("El muelle");
    expect(r.story.tensionRead).toBe(20);
  });

  it("keeps other sections when story itself is unrecoverable", () => {
    const raw = '{"memories":[{"npc":"Sera","about":"player","content":"me salvó"}]}';
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.story.threadUpdates).toEqual([]);
  });
});

describe("repairJson", () => {
  it("leaves well-formed JSON untouched", () => {
    const ok = '{"a":1,"b":{"c":"Hora:10"},"d":[{"e":true}]}';
    expect(repairJson(ok)).toBe(ok);
  });

  it("only fixes keys, not colons inside string values", () => {
    expect(repairJson('{"note":"Nota:dato","v:1}')).toBe('{"note":"Nota:dato","v":1}');
  });
});
