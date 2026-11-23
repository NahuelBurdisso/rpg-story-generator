import { describe, it, expect } from "vitest";
import { deduplicateContent } from "../../server/pipeline/utils";

describe("deduplicateContent", () => {
  it("removes exact consecutive duplicate sentences", () => {
    const result = deduplicateContent("The warrior attacked. The warrior attacked. The dragon fell.");
    expect(result).toBe("The warrior attacked. The dragon fell.");
  });

  it("preserves non-consecutive duplicates", () => {
    const result = deduplicateContent("He ran. She stopped. He ran.");
    expect(result).toBe("He ran. She stopped. He ran.");
  });

  it("handles newline-separated duplicates", () => {
    const result = deduplicateContent("First line.\nFirst line.\nSecond line.");
    expect(result).toBe("First line. Second line.");
  });

  it("does not split on abbreviations like Mr.", () => {
    const input = "Mr. Smith arrived at the tavern. He ordered a drink.";
    const result = deduplicateContent(input);
    // Should not split "Mr." into a separate fragment
    expect(result).toContain("Mr.");
  });

  it("does not split on decimal numbers", () => {
    const input = "The item costs 1.5 gold coins. The merchant nodded.";
    const result = deduplicateContent(input);
    expect(result).toContain("1.5");
  });

  it("handles empty string", () => {
    expect(deduplicateContent("")).toBe("");
  });

  it("handles single sentence", () => {
    expect(deduplicateContent("Hello world.")).toBe("Hello world.");
  });

  it("handles exclamation and question marks as boundaries", () => {
    const result = deduplicateContent("Watch out! Watch out! Are you okay? Are you okay?");
    expect(result).toBe("Watch out! Are you okay?");
  });
});
