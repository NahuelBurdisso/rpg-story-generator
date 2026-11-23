import { describe, expect, it } from "vitest";
import { MECHANIC_MARKER_RE, sameName, stripMechanicMarkers, stripMechanicMarkersLoose } from "@/server/pipeline/text";

describe("stripMechanicMarkers", () => {
  it("removes complete markers and collapses the gap", () => {
    expect(stripMechanicMarkers("You reach [MECHANIC:stat_check:DEX:DC12] for the latch."))
      .toBe("You reach for the latch.");
  });

  it("is case-insensitive, handles several markers, and keeps paragraph breaks", () => {
    expect(stripMechanicMarkers("A [mechanic:damage:1d6]\n\n\n\nB [MECHANIC:save:STR:DC10] C"))
      .toBe("A \n\nB C");
  });

  it("is repeatable (global regex has no sticky state)", () => {
    expect(stripMechanicMarkers("x [MECHANIC:a] y")).toBe("x y");
    expect(stripMechanicMarkers("x [MECHANIC:a] y")).toBe("x y");
  });

  it("leaves an unterminated marker alone", () => {
    expect(stripMechanicMarkers("text [MECHANIC:stat_che")).toBe("text [MECHANIC:stat_che");
  });
});

describe("stripMechanicMarkersLoose", () => {
  it("removes complete and truncated markers without touching whitespace", () => {
    expect(stripMechanicMarkersLoose("a [MECHANIC:x:DC1] b")).toBe("a  b");
    expect(stripMechanicMarkersLoose("a [MECHANIC:stat_che")).toBe("a ");
    expect(stripMechanicMarkersLoose("a [MECHAN")).toBe("a ");
  });
});

describe("sameName", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(sameName("  Mara ", "mara")).toBe(true);
    expect(sameName("Mara", "Mara Voss")).toBe(false);
  });
});

describe("MECHANIC_MARKER_RE", () => {
  it("is stateless: repeated .test() calls do not carry lastIndex", () => {
    const text = "x [MECHANIC:a:DC1] y";
    expect(MECHANIC_MARKER_RE.test(text)).toBe(true);
    expect(MECHANIC_MARKER_RE.test(text)).toBe(true);
    expect(MECHANIC_MARKER_RE.global).toBe(false);
  });
});
