import { describe, it, expect } from "vitest";
import { composeAppearance, composeDamageState } from "@/server/image/appearanceComposer";

describe("composeAppearance", () => {
  it("returns null for null input", () => {
    expect(composeAppearance(null)).toBeNull();
  });

  it("returns null for empty traits", () => {
    expect(composeAppearance({})).toBeNull();
  });

  it("composes full traits into SD-ready string", () => {
    const result = composeAppearance({
      build: "lean",
      height: "tall",
      age: "adult",
      skinTone: "dark",
      hairColor: "black",
      hairStyle: "short",
      eyeColor: "amber",
      clothing: "worn leather duster, heavy boots",
      features: "cybernetic left eye, facial scar",
    });
    // cybernetic and scar get emphasis weighting
    expect(result).toContain("lean tall adult");
    expect(result).toContain("dark skin");
    expect(result).toContain("short black hair");
    expect(result).toContain("amber eyes");
    expect(result).toContain("worn leather duster, heavy boots");
    expect(result).toContain("cybernetic left eye");
    expect(result).toContain(":1.3)");
  });

  it("handles partial traits", () => {
    const result = composeAppearance({
      build: "muscular",
      hairColor: "red",
      features: "missing left arm",
    });
    expect(result).toContain("muscular");
    expect(result).toContain("red hair");
    expect(result).toContain("missing left arm");
  });

  it("combines eye color and feature", () => {
    const result = composeAppearance({
      eyeColor: "green",
      eyeFeature: "glowing",
    });
    // "glowing" matches distinctive trait pattern → gets emphasis
    expect(result).toContain("green glowing eyes");
    expect(result).toContain(":1.3)");
  });

  it("handles only clothing and features", () => {
    const result = composeAppearance({
      clothing: "dark robes",
      features: "arcane tattoos on both arms",
    });
    expect(result).toContain("dark robes");
    // tattoo gets emphasis
    expect(result).toContain("arcane tattoos on both arms");
    expect(result).toContain(":1.3)");
  });

  it("includes bodyType when provided", () => {
    const result = composeAppearance({
      build: "tall",
      bodyType: "athletic",
      skinTone: "olive",
    });
    expect(result).toBe("tall, athletic body, olive skin");
  });

  it("includes bodyMarkings when provided", () => {
    const result = composeAppearance({
      skinTone: "pale",
      clothing: "leather corset",
      bodyMarkings: "dragon tattoo on back, navel piercing",
    });
    expect(result).toContain("pale skin");
    expect(result).toContain("leather corset");
    // tattoo + piercing match emphasis patterns
    expect(result).toContain("dragon tattoo on back, navel piercing");
    expect(result).toContain(":1.3)");
  });

  it("includes faceShape when provided", () => {
    const result = composeAppearance({
      faceShape: "sharp jawline, high cheekbones",
      eyeColor: "blue",
    });
    expect(result).toBe("sharp jawline, high cheekbones, blue eyes");
  });

  it("composes all new fields together", () => {
    const result = composeAppearance({
      build: "petite",
      bodyType: "curvy",
      faceShape: "round face",
      skinTone: "fair",
      hairColor: "blonde",
      hairStyle: "long wavy",
      eyeColor: "green",
      clothing: "silk dress",
      bodyMarkings: "rose tattoo on shoulder",
      features: "beauty mark near lips",
    });
    expect(result).toContain("petite");
    expect(result).toContain("curvy body");
    expect(result).toContain("round face");
    expect(result).toContain("fair skin");
    expect(result).toContain("long wavy blonde hair");
    expect(result).toContain("green eyes");
    expect(result).toContain("silk dress");
    // tattoo gets emphasis
    expect(result).toContain("rose tattoo on shoulder");
    expect(result).toContain(":1.3)");
    expect(result).toContain("beauty mark near lips");
  });

  it("applies moderate boost for distinctive coloring", () => {
    const result = composeAppearance({
      hairColor: "white",
      hairStyle: "long",
    });
    expect(result).toContain("long white hair");
    expect(result).toContain(":1.15)");
  });

  it("does not apply emphasis to common traits", () => {
    const result = composeAppearance({
      build: "tall",
      skinTone: "olive",
      hairColor: "brown",
      clothing: "simple tunic",
    });
    expect(result).toBe("tall, olive skin, brown hair, simple tunic");
  });
});

describe("composeDamageState", () => {
  it("returns null for null input", () => {
    expect(composeDamageState(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(composeDamageState("")).toBeNull();
  });

  it("returns null for status with no visual damage", () => {
    expect(composeDamageState("Healthy, full HP")).toBeNull();
  });

  it("detects blood/wounds", () => {
    const result = composeDamageState("Bleeding from a sword wound to the left arm");
    expect(result).toContain("bloodied");
  });

  it("detects bruises", () => {
    const result = composeDamageState("Beaten and battered after the fight");
    expect(result).toContain("bruised face");
  });

  it("detects burns", () => {
    const result = composeDamageState("Scorched by dragon fire, burn marks on chest");
    expect(result).toContain("burn marks on skin");
  });

  it("detects exhaustion", () => {
    const result = composeDamageState("Exhausted from running, barely standing");
    expect(result).toContain("exhausted expression");
    expect(result).toContain("sweat");
  });

  it("detects unconscious state", () => {
    const result = composeDamageState("Unconscious, passed out from blood loss");
    expect(result).toContain("unconscious");
    expect(result).toContain("closed eyes");
  });

  it("detects rage/berserk", () => {
    const result = composeDamageState("Enraged, berserker fury active");
    expect(result).toContain("rage expression");
    expect(result).toContain("veins visible");
  });

  it("detects torn clothing", () => {
    const result = composeDamageState("Armor damaged, torn clothing from combat");
    expect(result).toContain("torn clothing");
  });

  it("detects wet state", () => {
    const result = composeDamageState("Soaked from falling into the river");
    expect(result).toContain("wet skin");
    expect(result).toContain("dripping");
  });

  it("accumulates multiple damage states", () => {
    const result = composeDamageState("Bleeding, exhausted, torn armor from the long battle");
    expect(result).toContain("bloodied");
    expect(result).toContain("exhausted expression");
    expect(result).toContain("torn clothing");
  });
});
