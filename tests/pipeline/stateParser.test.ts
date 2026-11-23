import { describe, it, expect } from "vitest";
import { parseStateUpdate, inventoryKey, isHeld, claimsHealthyWhileHurt } from "../../server/pipeline/stateParser";

describe("parseStateUpdate", () => {
  it("returns null when no STATE_UPDATE block exists", () => {
    const { cleanedContent, stateUpdate } = parseStateUpdate("Just some narrative text.");
    expect(cleanedContent).toBe("Just some narrative text.");
    expect(stateUpdate).toBeNull();
  });

  it("parses a single STATE_UPDATE block", () => {
    const input = `The warrior found a sword. <!-- STATE_UPDATE {"characters":{"Kael":{"addInventory":["Iron Sword"]}}} STATE_UPDATE -->`;
    const { cleanedContent, stateUpdate } = parseStateUpdate(input);
    expect(cleanedContent).toBe("The warrior found a sword.");
    expect(stateUpdate).not.toBeNull();
    expect(stateUpdate!.characters.Kael.addInventory).toEqual(["Iron Sword"]);
  });

  it("strips STATE_UPDATE from displayed content", () => {
    const input = `Before. <!-- STATE_UPDATE {"characters":{}} STATE_UPDATE --> After.`;
    const { cleanedContent } = parseStateUpdate(input);
    expect(cleanedContent).toBe("Before.  After.");
  });

  it("merges multiple STATE_UPDATE blocks — addInventory concatenated", () => {
    const input = `Text <!-- STATE_UPDATE {"characters":{"Kael":{"addInventory":["Sword"]}}} STATE_UPDATE --> more <!-- STATE_UPDATE {"characters":{"Kael":{"addInventory":["Shield"]}}} STATE_UPDATE -->`;
    const { stateUpdate } = parseStateUpdate(input);
    expect(stateUpdate!.characters.Kael.addInventory).toEqual(["Sword", "Shield"]);
  });

  it("merges multiple STATE_UPDATE blocks — statChanges summed", () => {
    const input = `<!-- STATE_UPDATE {"characters":{"Kael":{"statChanges":{"HP":-5}}}} STATE_UPDATE --> <!-- STATE_UPDATE {"characters":{"Kael":{"statChanges":{"HP":-3,"STR":1}}}} STATE_UPDATE -->`;
    const { stateUpdate } = parseStateUpdate(input);
    expect(stateUpdate!.characters.Kael.statChanges).toEqual({ HP: -8, STR: 1 });
  });

  it("merges multiple STATE_UPDATE blocks — statusNotes uses last value", () => {
    const input = `<!-- STATE_UPDATE {"characters":{"Kael":{"statusNotes":"poisoned"}}} STATE_UPDATE --> <!-- STATE_UPDATE {"characters":{"Kael":{"statusNotes":"poisoned and bleeding"}}} STATE_UPDATE -->`;
    const { stateUpdate } = parseStateUpdate(input);
    expect(stateUpdate!.characters.Kael.statusNotes).toBe("poisoned and bleeding");
  });

  it("merges STATE_UPDATE blocks for different characters", () => {
    const input = `<!-- STATE_UPDATE {"characters":{"Kael":{"addInventory":["Sword"]}}} STATE_UPDATE --> <!-- STATE_UPDATE {"characters":{"Lyra":{"addInventory":["Staff"]}}} STATE_UPDATE -->`;
    const { stateUpdate } = parseStateUpdate(input);
    expect(stateUpdate!.characters.Kael.addInventory).toEqual(["Sword"]);
    expect(stateUpdate!.characters.Lyra.addInventory).toEqual(["Staff"]);
  });

  it("handles malformed JSON gracefully", () => {
    const input = `Text <!-- STATE_UPDATE {invalid json STATE_UPDATE -->`;
    const { cleanedContent, stateUpdate } = parseStateUpdate(input);
    expect(cleanedContent).toBe("Text");
    expect(stateUpdate).toBeNull();
  });

  // Shapes captured from a local gemma model in live play.
  it.each([
    ["comment without closing tag", `Hola. <!-- STATE_UPDATE {"characters":{"Ilse":{"addInventory":["brújula"]}}}-->`],
    ["comment with spaced close", `Hola. <!-- STATE_UPDATE {"characters":{"Ilse":{"addInventory":["brújula"]}}} -->`],
    ["bracket opener", `Hola.\n\n[STATE_UPDATE {"characters":{"Ilse":{"addInventory":["brújula"]}}} STATE_UPDATE -->`],
    ["bare tag + newline", `Hola.\n\nSTATE_UPDATE\n{"characters":{"Ilse":{"addInventory":["brújula"]}}}`],
  ])("parses and strips a %s", (_label, input) => {
    const { cleanedContent, stateUpdate } = parseStateUpdate(input);
    expect(cleanedContent).toBe("Hola.");
    expect(stateUpdate!.characters.Ilse.addInventory).toEqual(["brújula"]);
  });

  it("strips empty STATE_UPDATE tags left after the block", () => {
    const input = `Hola.\n\n[STATE_UPDATE {"characters":{"Ilse":{}}}\n\n<!-- STATE_UPDATE -->`;
    const { cleanedContent, stateUpdate } = parseStateUpdate(input);
    expect(cleanedContent).toBe("Hola.");
    expect(stateUpdate!.characters.Ilse).toEqual({});
  });

  it("drops stray closing braces after the block and on the last line", () => {
    const extra = parseStateUpdate(`Hola.\n\n<!-- STATE_UPDATE {"characters":{"Ilse":{}}}} STATE_UPDATE -->`);
    expect(extra.cleanedContent).toBe("Hola.");
    expect(extra.stateUpdate!.characters.Ilse).toEqual({});
    expect(parseStateUpdate("Hola.\n\n---\n}").cleanedContent).toBe("Hola.\n\n---");
  });

  it("drops placeholder and note entries from inventory changes", () => {
    // Shapes captured from a local gemma model.
    const { stateUpdate } = parseStateUpdate(
      `<!-- STATE_UPDATE {"characters":{"Ilse":{"addInventory":["Ninguno","caja de madera oscura","estado: contenido desconocido",""]}}} STATE_UPDATE -->`
    );
    expect(stateUpdate!.characters.Ilse.addInventory).toEqual(["caja de madera oscura"]);
  });

  it("drops things learned from inventory additions", () => {
    // Playtest (e4b): "recess observation (volatile energy source)".
    const { stateUpdate } = parseStateUpdate(
      `<!-- STATE_UPDATE {"characters":{"Mara":{"addInventory":["recess observation (volatile energy source)","crystalline drive core","clue about Teo"]}}} STATE_UPDATE -->`
    );
    expect(stateUpdate!.characters.Mara.addInventory).toEqual(["crystalline drive core"]);
  });

  it("keeps braces in JSON strings from ending the block early", () => {
    const input = `Hola. <!-- STATE_UPDATE {"characters":{"Ilse":{"statusNotes":"herida }"}}} STATE_UPDATE --> Chau.`;
    const { cleanedContent, stateUpdate } = parseStateUpdate(input);
    expect(cleanedContent).toBe("Hola.  Chau.");
    expect(stateUpdate!.characters.Ilse.statusNotes).toBe("herida }");
  });

  it("merges removeInventory across blocks", () => {
    const input = `<!-- STATE_UPDATE {"characters":{"Kael":{"removeInventory":["Potion"]}}} STATE_UPDATE --> <!-- STATE_UPDATE {"characters":{"Kael":{"removeInventory":["Key"]}}} STATE_UPDATE -->`;
    const { stateUpdate } = parseStateUpdate(input);
    expect(stateUpdate!.characters.Kael.removeInventory).toEqual(["Potion", "Key"]);
  });
});

describe("inventoryKey", () => {
  it("treats reworded copies of the same item as one", () => {
    // Playtest (e4b): "data slate (antique)" then "antique data slate".
    expect(inventoryKey("data slate (antique)")).toBe(inventoryKey("antique data slate"));
    expect(inventoryKey("The Plasma Cutter")).toBe(inventoryKey("plasma cutter"));
  });

  it("keeps different items apart", () => {
    expect(inventoryKey("data slate")).not.toBe(inventoryKey("antique data slate"));
  });
});

describe("isHeld", () => {
  it("absorbs qualifiers on a multi-word item", () => {
    // Playtest (e4b): "plasma cutter (active)" added next to the cutter already held.
    expect(isHeld(["plasma cutter"], "plasma cutter (active)")).toBe(true);
    expect(isHeld(["antique data slate"], "data slate")).toBe(true);
  });

  it("keeps single-word items apart from longer names", () => {
    expect(isHeld(["key"], "brass key")).toBe(false);
    expect(isHeld(["stim injector"], "plasma cutter")).toBe(false);
  });
});

describe("claimsHealthyWhileHurt", () => {
  it("flags a healthy note on a hurt character", () => {
    // Play-loop (e4b): statusNotes "Uninjured." at HP 11/20.
    expect(claimsHealthyWhileHurt("Uninjured.", { HP: 11, MaxHP: 20 })).toBe(true);
  });

  it("accepts it near full HP, and wound notes at any HP", () => {
    expect(claimsHealthyWhileHurt("Uninjured.", { HP: 18, MaxHP: 20 })).toBe(false);
    expect(claimsHealthyWhileHurt("Bleeding from the shoulder", { HP: 5, MaxHP: 20 })).toBe(false);
  });
});
