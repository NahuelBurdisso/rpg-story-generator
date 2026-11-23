import { describe, it, expect } from "vitest";
import { narrationForDisplay, splitStateUpdate } from "@/lib/narrative";

// Canonical, extra-brace, lone-brace, prose-block, bare and unclosed STATE_UPDATE shapes, with the exact
// cleaned prose frozen. (server/pipeline/stateParser.ts delegates to splitStateUpdate, so comparing the two
// would be circular; stateParser.test.ts covers the server side.)
const samples: Array<{ input: string; cleanedContent: string; payloads: string[] }> = [
  { input: "Just some narrative text.", cleanedContent: "Just some narrative text.", payloads: [] },
  {
    input: 'Hola.\n\n<!-- STATE_UPDATE {"characters":{"Ilse":{}}}} STATE_UPDATE -->',
    cleanedContent: "Hola.",
    payloads: ['{"characters":{"Ilse":{}}}'],
  },
  { input: "Hola.\n\n---\n}", cleanedContent: "Hola.\n\n---", payloads: [] },
  { input: "[STATE_UPDATE]\nInventory: rope\n\nNext paragraph.", cleanedContent: "Next paragraph.", payloads: [] },
  {
    input: 'A bare block.\nSTATE_UPDATE\n{"characters":{}}',
    cleanedContent: "A bare block.",
    payloads: ['{"characters":{}}'],
  },
  {
    input: 'Unclosed <!-- STATE_UPDATE {"characters":{"A":\n\nTail paragraph.',
    cleanedContent: "Unclosed Tail paragraph.",
    payloads: [],
  },
];

describe("splitStateUpdate", () => {
  it.each(samples)("splits %j", ({ input, cleanedContent, payloads }) => {
    expect(splitStateUpdate(input)).toEqual({ cleanedContent, payloads });
  });
});

describe("narrationForDisplay", () => {
  it("drops complete and cut-off mechanic markers", () => {
    expect(narrationForDisplay("a [MECHANIC:stat_check:DEX:DC12] b [MECHAN")).toBe("a  b");
  });
  it("drops STATE_UPDATE blocks", () => {
    expect(narrationForDisplay('Prose.\n\n<!-- STATE_UPDATE {"characters":{}} STATE_UPDATE -->')).toBe("Prose.");
  });
});
