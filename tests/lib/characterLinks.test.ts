import { describe, it, expect } from "vitest";
import { injectCharacterLinks } from "@/lib/character-links";

const links = [
  { name: "Sera", id: "c1", campaignId: "k" },
  { name: "Sera Vane", id: "c2", campaignId: "k" },
];

describe("injectCharacterLinks", () => {
  it("links the longest name first", () => {
    expect(injectCharacterLinks("Sera Vane waits.", links)).toBe("[Sera Vane](/campaigns/k/characters/c2) waits.");
  });
  it("does not re-link text that is already a link", () => {
    const text = "[Sera](/campaigns/k/characters/c1) smiles.";
    expect(injectCharacterLinks(text, links)).toBe(text);
  });
  it("returns the text untouched without links", () => {
    expect(injectCharacterLinks("Sera.", [])).toBe("Sera.");
  });
});
