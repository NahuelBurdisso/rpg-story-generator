import { describe, expect, it } from "vitest";
import { hpKey, hpValue, maxHpKey, maxHpValue } from "@/lib/stats";

describe("hpKey / maxHpKey", () => {
  it("finds the capitalised and lowercase spellings", () => {
    expect(hpKey({ HP: 10 })).toBe("HP");
    expect(hpKey({ hp: 10 })).toBe("hp");
    expect(maxHpKey({ MaxHP: 20 })).toBe("MaxHP");
    expect(maxHpKey({ maxHp: 20 })).toBe("maxHp");
  });

  it("prefers HP over hp and MaxHP over maxHp", () => {
    expect(hpKey({ hp: 1, HP: 2 })).toBe("HP");
    expect(maxHpKey({ maxHp: 1, MaxHP: 2 })).toBe("MaxHP");
  });

  it("returns null when absent", () => {
    expect(hpKey({ STR: 10 })).toBeNull();
    expect(maxHpKey({ STR: 10 })).toBeNull();
  });

  it("treats a 0 value as present", () => {
    expect(hpKey({ HP: 0, hp: 5 })).toBe("HP");
    expect(hpValue({ HP: 0, hp: 5 })).toBe(0);
  });
});

describe("hpValue / maxHpValue", () => {
  it("reads the resolved key", () => {
    expect(hpValue({ hp: 7 })).toBe(7);
    expect(maxHpValue({ maxHp: 9, MaxHP: 12 })).toBe(12);
    expect(hpValue({})).toBeUndefined();
    expect(maxHpValue({})).toBeUndefined();
  });
});
