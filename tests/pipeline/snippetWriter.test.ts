import { describe, it, expect } from "vitest";
import { parseSnippets, getMarkerContext } from "../../server/pipeline/snippetWriter";

describe("parseSnippets", () => {
  it("parses numbered snippet response", () => {
    const response = "#0: The blade finds its mark, slicing deep.\n#1: You leap aside just in time.";
    const snippets = parseSnippets(response);
    expect(snippets.get(0)).toBe("The blade finds its mark, slicing deep.");
    expect(snippets.get(1)).toBe("You leap aside just in time.");
  });

  it("handles multi-line snippets (accumulates continuation lines)", () => {
    const response = "#0: The arrow flies true.\nSome extra text\n#1: Missed!";
    const snippets = parseSnippets(response);
    expect(snippets.get(0)).toBe("The arrow flies true. Some extra text");
    expect(snippets.get(1)).toBe("Missed!");
  });

  it("keeps paragraph breaks and dialogue lines of a multi-paragraph snippet", () => {
    const response = '#0: The lock gives.\n\nOkafor steps closer.\n> "Nice work."\nThe corridor beyond is dark.';
    expect(parseSnippets(response).get(0)).toBe(
      'The lock gives.\n\nOkafor steps closer.\n\n> "Nice work." The corridor beyond is dark.'
    );
  });

  it("drops a trailing meta note in parentheses", () => {
    // Shape captured from a local gemma model.
    const snippets = parseSnippets("#0: Distinguís un patrón de desgaste ritual. (Para discernir la naturaleza de lo que está enterrado)");
    expect(snippets.get(0)).toBe("Distinguís un patrón de desgaste ritual.");
  });

  it("returns empty map for malformed response", () => {
    const snippets = parseSnippets("No valid format here");
    expect(snippets.size).toBe(0);
  });
});

describe("getMarkerContext", () => {
  it("extracts 30 chars before and after marker", () => {
    const text = "The warrior charges forward. [MECHANIC:stat_check:STR:DC14] The goblin braces for impact.";
    const { before, after } = getMarkerContext(text, 29, 59);
    expect(before).toBe("The warrior charges forward. ");
    expect(after).toBe(" The goblin braces for impact.");
  });

  it("handles markers at start of text", () => {
    const text = "[MECHANIC:damage:1d6] blood.";
    const { before, after } = getMarkerContext(text, 0, 21);
    expect(before).toBe("[start of text]");
    expect(after).toBe(" blood.");
  });
});
