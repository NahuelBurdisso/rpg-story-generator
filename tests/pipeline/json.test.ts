import { describe, expect, it } from "vitest";
import { scanBalanced } from "@/server/pipeline/json";

describe("scanBalanced", () => {
  it("finds the end of a nested object", () => {
    const t = 'x {"a":{"b":1},"c":2} tail';
    const start = t.indexOf("{");
    expect(scanBalanced(t, start, "object").end).toBe(t.indexOf("} tail") + 1);
  });

  it("ignores braces inside strings and escaped quotes", () => {
    const t = '{"a":"}{\\"}","b":1}';
    expect(scanBalanced(t, 0, "object").end).toBe(t.length);
  });

  it("object mode ignores brackets; any mode counts them", () => {
    const t = '{"a":[1,2}';
    expect(scanBalanced(t, 0, "object").end).toBe(t.length);
    // "any": `}` pops the `[`, leaving the object open.
    expect(scanBalanced(t, 0, "any")).toEqual({ end: -1, unclosed: "}" });
  });

  it("reports the closers needed for unterminated input, innermost first", () => {
    expect(scanBalanced('{"a":[{"b":1', 0, "any")).toEqual({ end: -1, unclosed: "}]}" });
    expect(scanBalanced('{"a":1', 0, "object")).toEqual({ end: -1, unclosed: "}" });
  });

  it("works from a [ start in any mode", () => {
    expect(scanBalanced("[1,[2]] x", 0, "any").end).toBe(7);
  });
});
