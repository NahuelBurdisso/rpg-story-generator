import { describe, it, expect } from "vitest";
import { STYLE_PRESETS, getStyleConfig, QUALITY_NEGATIVE, ANATOMY_NEGATIVE, resolveImageStyle } from "@/server/image/stylePresets";

describe("stylePresets", () => {
  it("returns all 8 presets", () => {
    expect(Object.keys(STYLE_PRESETS)).toHaveLength(8);
    expect(STYLE_PRESETS["painterly-fantasy"]).toBeDefined();
    expect(STYLE_PRESETS["cinematic-scifi"]).toBeDefined();
    expect(STYLE_PRESETS["grimdark-horror"]).toBeDefined();
    expect(STYLE_PRESETS["extreme-horror"]).toBeDefined();
  });

  it("every preset has required fields", () => {
    for (const [_name, preset] of Object.entries(STYLE_PRESETS)) {
      expect(preset.checkpoint).toBeTruthy();
      expect(preset.negativePrompt).toBeTruthy();
      expect(preset.tags).toBeTruthy();
      expect(preset.defaultDimensions.width).toBeGreaterThan(0);
      expect(preset.defaultDimensions.height).toBeGreaterThan(0);
      expect(preset.cfg).toBeGreaterThan(0);
      expect(preset.steps).toBeGreaterThan(0);
    }
  });

  it("getStyleConfig returns base preset when no custom", () => {
    const result = getStyleConfig("dark-ink");
    expect(result).toEqual(STYLE_PRESETS["dark-ink"]);
  });

  it("getStyleConfig falls back to painterly-fantasy for unknown style", () => {
    const result = getStyleConfig("nonexistent");
    expect(result).toEqual(STYLE_PRESETS["painterly-fantasy"]);
  });

  it("getStyleConfig merges custom overrides", () => {
    const result = getStyleConfig("painterly-fantasy", {
      checkpoint: "custom.safetensors",
      negativePrompt: "custom negative",
    });
    expect(result.checkpoint).toBe("custom.safetensors");
    expect(result.negativePrompt).toBe("custom negative");
    expect(result.tags).toBe(STYLE_PRESETS["painterly-fantasy"].tags);
  });

  it("shared negative has quality and anatomy terms", () => {
    expect(STYLE_PRESETS["painterly-fantasy"].negativePrompt.startsWith(QUALITY_NEGATIVE)).toBe(true);
    expect(STYLE_PRESETS["painterly-fantasy"].negativePrompt).toContain(ANATOMY_NEGATIVE);
  });

  it("resolveImageStyle falls back to the genre default", () => {
    expect(resolveImageStyle({ imageStyle: null, genre: "horror" })).toBe("grimdark-horror");
    expect(resolveImageStyle({ imageStyle: "dark-ink", genre: "horror" })).toBe("dark-ink");
    expect(resolveImageStyle({ imageStyle: null, genre: "unknown-genre" })).toBe("painterly-fantasy");
  });

  it("extreme-horror has higher steps for quality", () => {
    expect(STYLE_PRESETS["extreme-horror"].steps).toBeGreaterThanOrEqual(45);
  });
});
