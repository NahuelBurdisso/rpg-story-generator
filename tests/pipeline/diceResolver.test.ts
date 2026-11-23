import { describe, it, expect } from "vitest";
import { parseMarkers, resolveMechanics, substituteMarkers, matchStat, dropEchoedSentences, keepFirstMarker } from "../../server/pipeline/diceResolver";

describe("parseMarkers", () => {
  it("parses stat_check markers", () => {
    const text = "You try to climb. [MECHANIC:stat_check:STR:DC14] The wall is steep.";
    const markers = parseMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe("stat_check");
    expect(markers[0].params).toEqual({ stat: "STR", dc: 14 });
    expect(markers[0].startIndex).toBe(18);
    expect(markers[0].endIndex).toBe(48);
  });

  it("parses damage markers", () => {
    const text = "The sword strikes! [MECHANIC:damage:2d6+3] Blood flows.";
    const markers = parseMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe("damage");
    expect(markers[0].params).toEqual({ dice: "2d6+3" });
  });

  it("parses save markers", () => {
    const text = "Poison gas! [MECHANIC:save:CON:DC12] You cough.";
    const markers = parseMarkers(text);
    expect(markers[0].type).toBe("save");
    expect(markers[0].params).toEqual({ stat: "CON", dc: 12 });
  });

  it("parses contest markers", () => {
    const text = "You arm wrestle. [MECHANIC:contest:STR:vs:5] Sweat drips.";
    const markers = parseMarkers(text);
    expect(markers[0].type).toBe("contest");
    expect(markers[0].params).toEqual({ stat: "STR", modifier: 5 });
  });

  it("parses multiple markers with correct indices", () => {
    const text = "First [MECHANIC:stat_check:DEX:DC10] then [MECHANIC:damage:1d8] done.";
    const markers = parseMarkers(text);
    expect(markers).toHaveLength(2);
    expect(markers[0].index).toBe(0);
    expect(markers[1].index).toBe(1);
  });

  it("returns empty array for no markers", () => {
    expect(parseMarkers("Just regular text.")).toEqual([]);
  });

  it("skips template placeholders copied from the prompt", () => {
    // Shape captured from a local gemma model.
    const text = "[MECHANIC:stat_check:agility:DC12] | [MECHANIC:damage:{dice}] [MECHANIC:stat_check:{STAT}:DC{n}]";
    const markers = parseMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].params).toEqual({ stat: "agility", dc: 12 });
  });

  it("skips damage markers whose dice can't be rolled", () => {
    expect(parseMarkers("[MECHANIC:damage:mucho]")).toEqual([]);
    expect(parseMarkers("[MECHANIC:damage:2d]")).toEqual([]);
  });

  it("accepts uppercase dice notation and rolls it", () => {
    const { markers, resolutions } = resolveMechanics("[MECHANIC:damage:1D6]", {});
    expect(markers[0].params).toEqual({ dice: "1D6" });
    expect(resolutions[0].total).toBeGreaterThanOrEqual(1);
    expect(resolutions[0].total).toBeLessThanOrEqual(6);
  });
});

describe("resolveMechanics", () => {
  const character = {
    stats: { STR: 16, DEX: 14, CON: 12 },
    statModifiers: { STR: 3, DEX: 2, CON: 1 },
  };

  it("resolves stat checks with modifier", () => {
    const text = "[MECHANIC:stat_check:STR:DC14]";
    const { resolutions } = resolveMechanics(text, character);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].modifier).toBe(3);
    expect(resolutions[0].total).toBe(resolutions[0].roll[0] + 3);
    expect(resolutions[0].success).toBe(resolutions[0].total >= 14);
  });

  it("resolves damage rolls", () => {
    const text = "[MECHANIC:damage:2d6+3]";
    const { resolutions } = resolveMechanics(text, character);
    expect(resolutions[0].total).toBeGreaterThanOrEqual(5);
    expect(resolutions[0].total).toBeLessThanOrEqual(15);
  });

  it("rolls an undefined stat under the sheet's closest stat", () => {
    // Playtest: "Willpower check" on a sci-fi sheet with no such stat rolled at +0.
    const sheet = { stats: { Strength: 10, Agility: 10, Intelligence: 14, Tech: 16, Charisma: 8 } };
    const { resolutions } = resolveMechanics("[MECHANIC:stat_check:Willpower:DC12]", sheet);
    expect(resolutions[0].description).toMatch(/^Intelligence check/);
    expect(resolutions[0].modifier).toBe(2);
  });
});

describe("matchStat", () => {
  const keys = ["Strength", "Agility", "Endurance", "Intelligence", "Tech", "Charisma"];

  it("matches case-insensitively first", () => {
    expect(matchStat("tech", keys)).toBe("Tech");
  });

  it("maps synonyms within a family", () => {
    expect(matchStat("Dexterity", keys)).toBe("Agility");
    expect(matchStat("Constitution", keys)).toBe("Endurance");
    expect(matchStat("Hacking", keys)).toBe("Tech");
  });

  it("borrows a neighbouring family when the sheet lacks one", () => {
    expect(matchStat("Perception", keys)).toBe("Intelligence");
    expect(matchStat("Engineering", ["STR", "DEX", "Intelligence"])).toBe("Intelligence");
  });

  it("returns null for unknown names", () => {
    expect(matchStat("Luck", keys)).toBeNull();
  });
});

describe("substituteMarkers", () => {
  it("replaces markers with snippets in reverse order", () => {
    const text = "A [MECHANIC:stat_check:STR:DC14] B [MECHANIC:damage:1d6] C";
    const markers = parseMarkers(text);
    const snippets = new Map<number, string>();
    snippets.set(0, "you succeed easily");
    snippets.set(1, "dealing 4 damage");
    const result = substituteMarkers(text, markers, snippets);
    expect(result).toBe("A you succeed easily B dealing 4 damage C");
  });

  it("uses fallback when snippet missing", () => {
    const text = "[MECHANIC:stat_check:STR:DC14]";
    const markers = parseMarkers(text);
    const snippets = new Map<number, string>();
    const result = substituteMarkers(text, markers, snippets);
    expect(result).not.toContain("[MECHANIC:");
    expect(result.length).toBeGreaterThan(0);
  });

  it("drops the after-context the snippet writer echoed back", () => {
    // Captured shape: the snippet ends with the 100-char contextAfter window,
    // cut mid-word ("mientras s"), and then the real text follows.
    const text =
      "Desenvainás la daga. [MECHANIC:stat_check:DEX:DC12] El metal de la daga rasga el aire con un silbido agudo, cortando la penumbra del rincón mientras salís disparada hacia la figura.";
    const markers = parseMarkers(text);
    const snippets = new Map<number, string>();
    snippets.set(
      0,
      "Tu destreza es letal. El metal de la daga rasga el aire con un silbido agudo, cortando la penumbra del rincón mientras s."
    );
    const result = substituteMarkers(text, markers, snippets);
    expect(result).toBe(
      "Desenvainás la daga. Tu destreza es letal. El metal de la daga rasga el aire con un silbido agudo, cortando la penumbra del rincón mientras salís disparada hacia la figura."
    );
  });

  it("keeps a snippet that merely shares a few words with the text after it", () => {
    const text = "Lo intentás. [MECHANIC:stat_check:STR:DC10] La puerta cede.";
    const markers = parseMarkers(text);
    const snippets = new Map<number, string>([[0, "Empujás con todo el peso de tu cuerpo."]]);
    expect(substituteMarkers(text, markers, snippets)).toBe(
      "Lo intentás. Empujás con todo el peso de tu cuerpo. La puerta cede."
    );
  });

  it("treats a closing quote after punctuation as a sentence end", () => {
    const text = 'He asks, "Who told you?" [MECHANIC:stat_check:CHA:DC12] He waits.';
    const result = substituteMarkers(text, parseMarkers(text), new Map([[0, "You hold his stare."]]));
    expect(result).toBe('He asks, "Who told you?" You hold his stare. He waits.');
  });

  describe("keepFirstMarker", () => {
    it("deletes every marker after the first valid one", () => {
      // Playtest (e4b): a contest and a check stacked on one line of dialogue.
      const draft =
        '"Who told you?" [MECHANIC:contest:Intelligence:vs:2] He leans in. [MECHANIC:stat_check:Intelligence:DC14] Silence.';
      expect(keepFirstMarker(draft)).toBe('"Who told you?" [MECHANIC:contest:Intelligence:vs:2] He leans in. Silence.');
    });

    it("skips a placeholder marker when picking the first", () => {
      expect(keepFirstMarker("A [MECHANIC:damage:{dice}] B [MECHANIC:stat_check:STR:DC10] C")).toBe(
        "A [MECHANIC:damage:{dice}] B [MECHANIC:stat_check:STR:DC10] C"
      );
    });
  });

  describe("dropEchoedSentences", () => {
    // Playtest (e4b): the ending stitched two context sentences back together.
    const context =
      "Something etched deep into the curved steel wall: faint, overlapping markings that are too deliberate to be random corrosion. They appear to be hastily drawn schematics overlaid with what look suspiciously like human handwriting.";

    it("drops a sentence rebuilt from the context", () => {
      const snippet =
        "Your mind stalls. The faint, overlapping markings—the hastily drawn schematics overlaid with what look suspiciously like human handwriting—are too deliberate to be random corrosion. You fumble with the plasma cutter, the arc spitting erratically into the grime.";
      expect(dropEchoedSentences(snippet, context)).toBe(
        "Your mind stalls. You fumble with the plasma cutter, the arc spitting erratically into the grime."
      );
    });

    it("drops a repeated line of dialogue", () => {
      const ctx = `> "Who told you about 'R'? And why are you so keen on knowing what's *behind* the core?"`;
      const snippet = `> "Who told you about 'R'? And why are you so keen on knowing what's *behind* the core?" He looks away.`;
      expect(dropEchoedSentences(snippet, ctx)).toBe("He looks away.");
    });

    it("keeps new sentences that mention things from the context", () => {
      const snippet = "You trace the handwriting with a gloved finger until a name surfaces from the scrawl: Teo Kade, dated forty days ago.";
      expect(dropEchoedSentences(snippet, context)).toBe(snippet);
    });
  });

  describe("rewriteTail", () => {
    // Playtest (e4b): a successful Tech check followed by draft prose written
    // before the roll — "The machine fights back..." — contradicting it.
    const text =
      "You jack the multitool into the port [MECHANIC:stat_check:Tech:DC14] and brace.\n\nThe slate resists. The machine fights back.";
    const markers = parseMarkers(text);

    it("replaces the marker and the whole draft ending with the outcome-aware passage", () => {
      const snippets = new Map([[0, 'The port accepts the handshake and logs spill across the screen.\n\n> "Got it," you mutter.']]);
      expect(substituteMarkers(text, markers, snippets, { rewriteTail: true })).toBe(
        'You jack the multitool into the port. The port accepts the handshake and logs spill across the screen.\n\n> "Got it," you mutter.'
      );
    });

    it("keeps the draft ending when the rewrite is missing or too short", () => {
      const result = substituteMarkers(text, markers, new Map([[0, "It works."]]), { rewriteTail: true });
      expect(result).toContain("The machine fights back.");
      expect(result).toContain("It works.");
    });

    it("only rewrites after the last marker", () => {
      const two = "A [MECHANIC:stat_check:STR:DC10] B [MECHANIC:stat_check:Tech:DC12] old ending here.";
      const snippets = new Map([
        [0, "you heave"],
        [1, "The panel slides open with a hiss and a rush of stale air."],
      ]);
      expect(substituteMarkers(two, parseMarkers(two), snippets, { rewriteTail: true })).toBe(
        "A you heave B. The panel slides open with a hiss and a rush of stale air."
      );
    });
  });
});

describe("dropEchoedSentences on the player's action", () => {
  it("drops the narrator's verbatim copy of the action but keeps the player's dialogue", () => {
    // Playtest (e4b): the action came back first person ("between us").
    const action = '"An emergency shunt to where, Okafor?" I keep my cutter between us and step toward the glowing seam to get a look through the gap.'
      .replace(/"[^"]*"/g, " ");
    const text =
      'The bulkhead groans.\n\n> "An emergency shunt to where?" You keep your cutter between us and step toward the glowing seam to get a look through the gap.\n\nOkafor braces.';
    expect(dropEchoedSentences(text, action)).toBe('The bulkhead groans.\n\n> "An emergency shunt to where?"\n\nOkafor braces.');
  });
});
