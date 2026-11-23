import { describe, it, expect } from "vitest";
import { shouldUseFaceDetailer, shouldUseHiresFix, getFaceDetailerDenoise } from "@/server/image/stylePresets";
import { inferCinematographyFromContent } from "@/server/image/promptWriter";
import { composeAppearance } from "@/server/image/appearanceComposer";

describe("shouldUseFaceDetailer", () => {
  it("returns true when style preset enables it", () => {
    expect(shouldUseFaceDetailer(true, "wide-shot")).toBe(true);
  });

  it("returns true for close-up shots regardless of style", () => {
    expect(shouldUseFaceDetailer(false, "close-up")).toBe(true);
    expect(shouldUseFaceDetailer(false, "extreme-close-up")).toBe(true);
    expect(shouldUseFaceDetailer(false, "medium-close-up")).toBe(true);
    expect(shouldUseFaceDetailer(false, "medium-shot")).toBe(true);
  });

  it("returns false for wide shots without style override", () => {
    expect(shouldUseFaceDetailer(false, "wide-shot")).toBe(false);
    expect(shouldUseFaceDetailer(false, "extreme-wide")).toBe(false);
    expect(shouldUseFaceDetailer(undefined, "full-body")).toBe(false);
  });

  it("returns false when no shot scale provided and no style override", () => {
    expect(shouldUseFaceDetailer(false, undefined)).toBe(false);
  });
});

describe("shouldUseHiresFix", () => {
  it("returns true for premium styles", () => {
    expect(shouldUseHiresFix("photorealistic", "wide-shot")).toBe(true);
    expect(shouldUseHiresFix("extreme-horror", "full-body")).toBe(true);
  });

  it("returns true for close-up shots in any style", () => {
    expect(shouldUseHiresFix("painterly-fantasy", "close-up")).toBe(true);
    expect(shouldUseHiresFix("anime-rpg", "extreme-close-up")).toBe(true);
  });

  it("returns false for wide/medium shots in non-premium styles", () => {
    expect(shouldUseHiresFix("painterly-fantasy", "wide-shot")).toBe(false);
    expect(shouldUseHiresFix("anime-rpg", "medium-shot")).toBe(false);
    expect(shouldUseHiresFix("dark-ink", "full-body")).toBe(false);
  });
});

describe("getFaceDetailerDenoise", () => {
  it("returns lower denoise for anime/painterly styles", () => {
    expect(getFaceDetailerDenoise("anime-rpg")).toBe(0.25);
    expect(getFaceDetailerDenoise("painterly-fantasy")).toBe(0.25);
  });

  it("returns moderate denoise for horror", () => {
    expect(getFaceDetailerDenoise("grimdark-horror")).toBe(0.30);
    expect(getFaceDetailerDenoise("extreme-horror")).toBe(0.30);
  });

  it("returns full denoise for photorealistic", () => {
    expect(getFaceDetailerDenoise("photorealistic")).toBe(0.35);
  });
});

describe("inferCinematographyFromContent", () => {
  it("infers wide-shot for scene changes", () => {
    const result = inferCinematographyFromContent("You enter the vast cavern.", "scene_change");
    expect(result.shotScale).toBe("wide-shot");
  });

  it("infers medium-full for combat", () => {
    const result = inferCinematographyFromContent("The orc swings its axe at you.", "combat");
    expect(result.shotScale).toBe("medium-full");
    expect(result.cameraAngle).toBe("low-angle");
  });

  it("infers medium-close-up + shallow depth for quiet personal moments", () => {
    const result = inferCinematographyFromContent("She whispers softly, lips close to your ear.", "consequence");
    expect(result.shotScale).toBe("medium-close-up");
    expect(result.depthStyle).toBe("shallow");
  });

  it("infers dutch angle for horror content", () => {
    const result = inferCinematographyFromContent("Blood drips from the eldritch horror above.", "gm_event");
    expect(result.cameraAngle).toBe("dutch-angle");
    expect(result.depthStyle).toBe("atmospheric");
  });

  it("infers medium-shot for conversation", () => {
    const result = inferCinematographyFromContent("The innkeeper says hello and smiles warmly.", "consequence");
    expect(result.shotScale).toBe("medium-shot");
    expect(result.depthStyle).toBe("shallow");
  });

  it("falls back to medium-shot for generic content", () => {
    const result = inferCinematographyFromContent("Time passes slowly.", "consequence");
    expect(result.shotScale).toBe("medium-shot");
  });
});

describe("composeAppearance — emphasis weighting", () => {
  it("boosts cybernetic features with 1.3x emphasis", () => {
    const result = composeAppearance({ features: "cybernetic left eye" });
    expect(result).toContain("(cybernetic left eye:1.3)");
  });

  it("boosts tattoos with 1.3x emphasis", () => {
    const result = composeAppearance({ bodyMarkings: "dragon tattoo" });
    expect(result).toContain("(dragon tattoo:1.3)");
  });

  it("boosts white hair with 1.15x emphasis", () => {
    const result = composeAppearance({ hairColor: "white", hairStyle: "long" });
    expect(result).toContain("(long white hair:1.15)");
  });

  it("does NOT boost common brown hair", () => {
    const result = composeAppearance({ hairColor: "brown", hairStyle: "short" });
    expect(result).toBe("short brown hair");
    expect(result).not.toContain(":");
  });

  it("does NOT boost normal clothing", () => {
    const result = composeAppearance({ clothing: "leather armor" });
    expect(result).toBe("leather armor");
  });
});
