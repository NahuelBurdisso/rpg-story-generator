import { describe, it, expect } from "vitest";
import { buildSnippetPrompt } from "../../server/pipeline/promptBuilder";

const campaign = { genre: "sci-fi", tone: "dark", difficulty: "normal", worldDescription: "" } as Parameters<typeof buildSnippetPrompt>[0];
const mara = { name: "Mara Kade", role: "Salvage Engineer", stats: { HP: 20, MaxHP: 20 }, inventory: [] } as unknown as Parameters<typeof buildSnippetPrompt>[1];

describe("buildSnippetPrompt ending", () => {
  it("hands the last roll the draft ending and spells out a failure", () => {
    // Playtest (e4b): a failed Intelligence check was narrated as a breakthrough.
    const prompt = buildSnippetPrompt(campaign, mara, [
      { index: 0, description: "Intelligence check DC13: rolled 11+1=12 — FAILURE", contextBefore: "You study the seam", contextAfter: "", draftTail: "The knowledge hits you." },
    ]);
    expect(prompt).toContain('Draft ending (written BEFORE the roll — you replace it): "The knowledge hits you."');
    expect(prompt).toContain("THE ROLL FAILED");
    expect(prompt).not.toContain("Context after");
  });

  it("keeps the plain snippet instructions when there is no ending", () => {
    const prompt = buildSnippetPrompt(campaign, mara, [
      { index: 0, description: "Strength check DC10: rolled 15+0=15 — SUCCESS", contextBefore: "a", contextAfter: "b" },
    ]);
    expect(prompt).toContain('Context after: "b"');
    expect(prompt).not.toContain("ENDING (#");
  });
});
