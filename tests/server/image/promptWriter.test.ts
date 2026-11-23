import { describe, it, expect } from "vitest";
import { buildImagePromptContext, buildExtractionPrompt, buildOptimizerPrompt, buildDynamicNegative, getDimensionsForTrigger, inferDimensionsFromContent, cleanSdPrompt, applyEmphasis, looksLikeSdTags, structureWithBreaks, boostCharacterFeatures, reorderByPriority, detectSceneArchetype, getArchetypeParams, parseCinematography, getShotScaleParams, SHOT_SCALE_DIMENSIONS } from "@/server/image/promptWriter";
import type { TriggerType, CinematographyResult } from "@/server/image/types";

describe("promptWriter", () => {
  describe("getDimensionsForTrigger", () => {
    it("returns landscape for scene_change", () => {
      const dims = getDimensionsForTrigger("scene_change");
      expect(dims).toEqual({ width: 1216, height: 832 });
    });

    it("returns square for combat", () => {
      const dims = getDimensionsForTrigger("combat");
      expect(dims).toEqual({ width: 1024, height: 1024 });
    });

    it("returns square for player_request", () => {
      const dims = getDimensionsForTrigger("player_request");
      expect(dims).toEqual({ width: 1024, height: 1024 });
    });

    it("custom dimensions override trigger-based", () => {
      const dims = getDimensionsForTrigger("combat", { width: 768, height: 512 });
      expect(dims).toEqual({ width: 768, height: 512 });
    });
  });

  describe("buildImagePromptContext", () => {
    const input = {
      finalText: "The dragon breathes fire across the battlefield, scorching the earth.",
      genre: "fantasy",
      tone: "dark",
      worldDescription: "A war-torn realm where dragons have returned after a thousand years of slumber.",
      characterName: "Kael",
      characterRole: "shadow knight",
      characterAppearance: "tall, lean, dark hair, scarred face, black leather armor",
      characterStatus: "wounded, left arm burned",
      sceneLocation: "battlefield",
      timeOfDay: "evening",
      npcs: [{ name: "Vorn", description: "scarred orc chieftain" }],
      triggerType: "combat" as TriggerType,
      styleTags: "oil painting, fantasy art, detailed, dramatic lighting",
      previousPrompt: null,
    };

    it("includes scene text (truncated to 500 chars)", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("dragon breathes fire");
    });

    it("includes character info", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("Kael");
      expect(result).toContain("shadow knight");
    });

    it("includes NPC names", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("Vorn");
    });

    it("includes trigger type", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("combat");
    });

    it("includes style tags", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("oil painting");
    });

    it("handles null previous prompt", () => {
      const result = buildImagePromptContext(input);
      expect(result).toContain("none");
    });

    it("includes previous prompt when provided", () => {
      const result = buildImagePromptContext({ ...input, previousPrompt: "dark castle, moonlight" });
      expect(result).toContain("dark castle, moonlight");
    });
  });

  describe("buildExtractionPrompt", () => {
    const input = {
      finalText: "Kael pushes through sulfurous smog into The Rancor's Breath, a durasteel cantina. A scarred Weequay bartender slides a dirty glass across the bar.",
      genre: "sci-fi",
      tone: "dark",
      worldDescription: "A lawless sector of the galaxy.",
      characterName: "Kael Voss",
      characterRole: "bounty hunter",
      characterAppearance: "lean, dark-skinned, cybernetic left eye, worn leather duster",
      characterStatus: "blood-spattered from recent kill",
      sceneLocation: "The Rancor's Breath cantina",
      timeOfDay: "night",
      npcs: [{ name: "Weequay bartender", description: "scarred alien bartender" }],
      triggerType: "scene_change" as TriggerType,
      styleTags: "",
      previousPrompt: null,
    };

    it("includes FULL narrative text (not truncated)", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("sulfurous smog");
      expect(result).toContain("Weequay bartender");
    });

    it("includes character appearance when provided", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("cybernetic left eye");
      expect(result).toContain("worn leather duster");
    });

    it("includes extraction format markers", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("MOMENT:");
      expect(result).toContain("SUBJECT:");
      expect(result).toContain("ENVIRONMENT:");
      expect(result).toContain("LIGHTING:");
    });

    it("omits APPEARANCE line when characterAppearance is null", () => {
      const result = buildExtractionPrompt({ ...input, characterAppearance: null });
      expect(result).not.toContain("APPEARANCE:");
    });

    it("includes cinematography section with shot taxonomy", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("SHOT_SCALE:");
      expect(result).toContain("CAMERA_ANGLE:");
      expect(result).toContain("DEPTH_STYLE:");
      expect(result).toContain("DIRECTOR_NOTE:");
    });

    it("includes shot scale options", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("extreme-close-up");
      expect(result).toContain("wide-shot");
      expect(result).toContain("extreme-wide");
    });

    it("includes camera angle options", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("low-angle");
      expect(result).toContain("dutch-angle");
      expect(result).toContain("over-shoulder");
    });

    it("includes cinematographer reasoning examples", () => {
      const result = buildExtractionPrompt(input);
      expect(result).toContain("CINEMATOGRAPHER");
      expect(result).toContain("film director");
    });
  });

  describe("cleanSdPrompt", () => {
    it("returns clean tags unchanged", () => {
      expect(cleanSdPrompt("warrior, dark cave, dramatic lighting")).toBe("warrior, dark cave, dramatic lighting");
    });

    it("strips 'Here's your prompt:' preamble", () => {
      expect(cleanSdPrompt("Here's your prompt: warrior, dark cave")).toBe("warrior, dark cave");
    });

    it("strips 'Here is the SD prompt:' preamble", () => {
      expect(cleanSdPrompt("Here is the stable diffusion prompt:\nwarrior, cave")).toBe("warrior, cave");
    });

    it("strips wrapping double quotes", () => {
      expect(cleanSdPrompt('"warrior, dark cave"')).toBe("warrior, dark cave");
    });

    it("strips wrapping single quotes", () => {
      expect(cleanSdPrompt("'warrior, dark cave'")).toBe("warrior, dark cave");
    });

    it("strips markdown code blocks", () => {
      expect(cleanSdPrompt("```\nwarrior, cave\n```")).toBe("warrior, cave");
    });

    it("converts newlines to commas", () => {
      expect(cleanSdPrompt("warrior\ndark cave\ndramatic lighting")).toBe("warrior, dark cave, dramatic lighting");
    });

    it("collapses multiple commas", () => {
      expect(cleanSdPrompt("warrior,, dark cave,,, lighting")).toBe("warrior, dark cave, lighting");
    });

    it("removes trailing comma", () => {
      expect(cleanSdPrompt("warrior, cave, ")).toBe("warrior, cave");
    });

    it("handles combined preamble + quotes + newlines", () => {
      const messy = 'Here\'s your prompt:\n"warrior in cave\ndramatic lighting\noil painting"';
      const result = cleanSdPrompt(messy);
      expect(result).not.toContain("Here");
      expect(result).toContain("warrior");
      expect(result).toContain("dramatic lighting");
    });

    it("strips numbered list format", () => {
      const numbered = "1. warrior\n2. dark cave\n3. dramatic lighting";
      const result = cleanSdPrompt(numbered);
      expect(result).toBe("warrior, dark cave, dramatic lighting");
    });

    it("strips bullet point format", () => {
      const bulleted = "- warrior\n- dark cave\n- dramatic lighting";
      const result = cleanSdPrompt(bulleted);
      expect(result).toBe("warrior, dark cave, dramatic lighting");
    });

    it("strips LLM refusal prefixes", () => {
      const refusal = "I cannot generate explicit content, however, warrior, dark cave, dramatic lighting";
      const result = cleanSdPrompt(refusal);
      expect(result).not.toContain("cannot");
      expect(result).toContain("warrior");
    });

    it("strips disclaimer prefixes", () => {
      const disclaimed = "Content warning: graphic violence, warrior, blood splatter, severed limb";
      const result = cleanSdPrompt(disclaimed);
      expect(result).not.toContain("Content warning");
      expect(result).toContain("warrior");
      expect(result).toContain("blood splatter");
    });

    it("strips 'Let me create' prefixes", () => {
      const prefixed = "Let me create the prompt: warrior, dark cave, gore";
      const result = cleanSdPrompt(prefixed);
      expect(result).not.toContain("Let me");
      expect(result).toContain("warrior");
    });
  });

  describe("applyEmphasis", () => {
    it("adds weight to masterpiece tag", () => {
      const result = applyEmphasis("masterpiece, warrior, dark cave");
      expect(result).toContain("(masterpiece:1.2)");
      expect(result).toContain("warrior");
    });

    it("adds weight to best quality tag", () => {
      const result = applyEmphasis("warrior, best quality, dark cave");
      expect(result).toContain("(best quality:1.2)");
    });

    it("adds weight to extremely detailed tag", () => {
      const result = applyEmphasis("masterpiece, extremely detailed, cave");
      expect(result).toContain("(extremely detailed:1.1)");
    });

    it("does not double-apply emphasis to already weighted tags", () => {
      const result = applyEmphasis("(masterpiece:1.2), warrior");
      expect(result).toBe("(masterpiece:1.2), warrior");
    });

    it("preserves non-emphasis tags unchanged", () => {
      const result = applyEmphasis("warrior, dark cave, blood splatter");
      expect(result).toBe("warrior, dark cave, blood splatter");
    });
  });

  describe("looksLikeSdTags", () => {
    it("returns true for valid comma-separated tags", () => {
      expect(looksLikeSdTags("warrior, dark cave, dramatic lighting, oil painting")).toBe(true);
    });

    it("returns true for many short tags", () => {
      expect(looksLikeSdTags("1girl, reading on a bed, dim lighting, sharp focus, masterpiece")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(looksLikeSdTags("")).toBe(false);
    });

    it("returns false for too few segments", () => {
      expect(looksLikeSdTags("just one tag")).toBe(false);
    });

    it("returns false for paragraph-like prose", () => {
      expect(looksLikeSdTags("The warrior stands in a dark cave with dramatic lighting illuminating his face from the left side while shadows dance on the walls behind him")).toBe(false);
    });

    it("returns false for refusal text", () => {
      expect(looksLikeSdTags("I'm sorry, I cannot generate that type of content, warrior, cave")).toBe(false);
    });

    it("returns false for apology text", () => {
      expect(looksLikeSdTags("I apologize, but I'm unable to create explicit imagery, here is a safe alternative, warrior")).toBe(false);
    });
  });

  describe("buildDynamicNegative", () => {
    const BASE = "worst quality, low quality, watermark";

    it("returns base negative unchanged when positive has no matching keywords", () => {
      const result = buildDynamicNegative("warrior, fantasy castle, dramatic lighting", BASE);
      expect(result).toBe(BASE);
    });

    it("adds overexposed/washed out for night scenes", () => {
      const result = buildDynamicNegative("warrior, night, torchlight, dark alley", BASE);
      expect(result).toContain("overexposed");
      expect(result).toContain("washed out");
      expect(result).toContain(BASE);
    });

    it("adds overexposed/washed out for dark keyword", () => {
      const result = buildDynamicNegative("dark forest, shadows, mist", BASE);
      expect(result).toContain("overexposed");
    });

    it("adds cute/peaceful/happy for blood/gore", () => {
      const result = buildDynamicNegative("warrior, blood splatter, visceral wound, dark cave", BASE);
      expect(result).toContain("cute");
      expect(result).toContain("peaceful");
      expect(result).toContain("happy");
    });

    it("adds cute for gore keyword", () => {
      const result = buildDynamicNegative("orc, gore, severed limb, battlefield", BASE);
      expect(result).toContain("cute");
    });

    it("adds photorealistic/3d render for anime", () => {
      const result = buildDynamicNegative("anime style, 1girl, vibrant colors, cel shading", BASE);
      expect(result).toContain("photorealistic");
      expect(result).toContain("3d render");
    });

    it("adds anime/cartoon/painting for photorealistic", () => {
      const result = buildDynamicNegative("photorealistic, RAW photo, detailed skin, cinematic", BASE);
      expect(result).toContain("anime");
      expect(result).toContain("cartoon");
      expect(result).toContain("painting");
    });

    it("accumulates multiple additions when positive matches multiple rules", () => {
      const result = buildDynamicNegative("anime style, hooded character, night scene", BASE);
      expect(result).toContain("overexposed");
      expect(result).toContain("photorealistic");
    });

    it("always preserves the base negative at the start", () => {
      const result = buildDynamicNegative("night, hooded figure, blood, anime", BASE);
      expect(result.startsWith(BASE)).toBe(true);
    });
  });

  describe("structureWithBreaks", () => {
    it("separates subject, environment, and style with BREAK", () => {
      const input = "1girl, dark cave, masterpiece";
      const result = structureWithBreaks(input);
      expect(result).toContain("BREAK");
      expect(result).toContain("1girl");
      expect(result).toContain("dark cave");
      expect(result).toContain("masterpiece");
    });

    it("keeps tags in original order within each group", () => {
      const input = "1man, warrior, blood splatter, forest floor, oil painting, extremely detailed";
      const result = structureWithBreaks(input);
      // Subject group should come before environment, environment before style
      const subjectPos = result.indexOf("1man");
      const envPos = result.indexOf("forest floor");
      const stylePos = result.indexOf("oil painting");
      expect(subjectPos).toBeLessThan(envPos);
      expect(envPos).toBeLessThan(stylePos);
      // 1man appears before warrior within the subject group
      expect(result.indexOf("1man")).toBeLessThan(result.indexOf("warrior"));
    });

    it("handles prompt with no environment tags", () => {
      const input = "1girl, red hair, sword, masterpiece, best quality";
      const result = structureWithBreaks(input);
      // Should still have BREAK between subject and style
      expect(result).toContain("BREAK");
      expect(result).not.toMatch(/BREAK.*BREAK/); // only one BREAK since env is empty
      expect(result).toContain("1girl");
      expect(result).toContain("masterpiece");
    });

    it("handles prompt with only style and subject", () => {
      const input = "1boy, dark armor, cinematic, sharp focus";
      const result = structureWithBreaks(input);
      expect(result).toContain("BREAK");
      expect(result).toContain("1boy");
      expect(result).toContain("cinematic");
      // No environment — should not produce two BREAKs
      const breakCount = (result.match(/ BREAK /g) ?? []).length;
      expect(breakCount).toBe(1);
    });

    it("does not add BREAK when all tags are same category", () => {
      // All style tags — no subject or environment
      const input = "masterpiece, best quality, extremely detailed, sharp focus";
      const result = structureWithBreaks(input);
      expect(result).not.toContain("BREAK");
    });
  });

  describe("buildOptimizerPrompt", () => {
    const EXTRACTION = "MOMENT: warrior stands at cliff edge\nSUBJECT: 1man, armored\nACTION: raises sword";
    const CINEMATOGRAPHY: CinematographyResult = {
      shotScale: "wide-shot",
      cameraAngle: "low-angle",
      depthStyle: "deep",
      directorNote: "silhouette against sunset sky",
    };

    it("includes cinematography block", () => {
      const result = buildOptimizerPrompt(EXTRACTION, CINEMATOGRAPHY, "fantasy", "oil painting", null, "landscape");
      expect(result).toContain("SHOT: wide-shot");
      expect(result).toContain("ANGLE: low-angle");
      expect(result).toContain("DEPTH: deep");
      expect(result).toContain("DIRECTOR'S NOTE: silhouette against sunset sky");
    });

    it("includes aspect ratio", () => {
      const result = buildOptimizerPrompt(EXTRACTION, CINEMATOGRAPHY, "fantasy", "oil painting", null, "landscape");
      expect(result).toContain("ASPECT RATIO: landscape");
    });

    it("includes previous prompt for continuity when provided", () => {
      const result = buildOptimizerPrompt(EXTRACTION, CINEMATOGRAPHY, "fantasy", "oil painting", "dark castle, moonlight", "landscape");
      expect(result).toContain("dark castle, moonlight");
    });

    it("omits director's note when empty", () => {
      const noDN = { ...CINEMATOGRAPHY, directorNote: "" };
      const result = buildOptimizerPrompt(EXTRACTION, noDN, "fantasy", "oil painting", null, "landscape");
      expect(result).not.toContain("DIRECTOR'S NOTE");
    });

    it("includes extraction content", () => {
      const result = buildOptimizerPrompt(EXTRACTION, CINEMATOGRAPHY, "fantasy", "oil painting", null, "landscape");
      expect(result).toContain("warrior stands at cliff edge");
    });
  });

  describe("boostCharacterFeatures", () => {
    it("returns prompt unchanged when no appearance", () => {
      const result = boostCharacterFeatures("warrior, dark cave, oil painting", null);
      expect(result).toBe("warrior, dark cave, oil painting");
    });

    it("boosts cybernetic features found in prompt", () => {
      const result = boostCharacterFeatures(
        "warrior, cybernetic left eye, dark cave",
        "tall, cybernetic left eye, worn leather duster"
      );
      expect(result).toContain("(cybernetic left eye:1.3)");
      expect(result).toContain("warrior");
      expect(result).toContain("dark cave");
    });

    it("boosts scar features found in prompt", () => {
      const result = boostCharacterFeatures(
        "1man, facial scar across right cheek, dark armor",
        "muscular, facial scar across right cheek"
      );
      expect(result).toContain("(facial scar across right cheek:1.3)");
    });

    it("boosts tattoo features found in prompt", () => {
      const result = boostCharacterFeatures(
        "1woman, dragon tattoo on back, leather armor",
        "athletic body, dragon tattoo on back, green eyes"
      );
      expect(result).toContain("(dragon tattoo on back:1.3)");
    });

    it("does NOT boost non-distinctive traits like hair color", () => {
      const result = boostCharacterFeatures(
        "1girl, red hair, blue eyes, dark cave",
        "tall, red hair, blue eyes, leather armor"
      );
      expect(result).not.toContain(":1.3)");
      expect(result).toBe("1girl, red hair, blue eyes, dark cave");
    });

    it("does not double-boost already weighted tags", () => {
      const result = boostCharacterFeatures(
        "warrior, (cybernetic eye:1.2), cave",
        "cybernetic eye, worn duster"
      );
      // Should not add another weight
      expect(result).toBe("warrior, (cybernetic eye:1.2), cave");
    });

    it("boosts multiple distinctive features", () => {
      const result = boostCharacterFeatures(
        "1man, glowing runes on arms, missing left hand, dark cave",
        "lean, glowing runes on arms, missing left hand, worn boots"
      );
      expect(result).toContain("(glowing runes on arms:1.3)");
      expect(result).toContain("(missing left hand:1.3)");
    });
  });

  describe("inferDimensionsFromContent", () => {
    it("returns portrait for single character close-up with medium-shot scale", () => {
      const dims = inferDimensionsFromContent("1girl, portrait, beautiful face, sharp focus", "medium-shot");
      expect(dims).toEqual({ width: 832, height: 1216 });
    });

    it("returns portrait for solo character with face detail", () => {
      const dims = inferDimensionsFromContent("1man, close-up, detailed face, scar", "medium-shot");
      expect(dims).toEqual({ width: 832, height: 1216 });
    });

    it("returns landscape for wide establishing shots even with portrait scale", () => {
      const dims = inferDimensionsFromContent("wide shot, castle, panoramic, dramatic sky", "close-up");
      expect(dims).toEqual({ width: 1216, height: 832 });
    });

    it("returns landscape for environment-focused prompts overriding portrait scale", () => {
      const dims = inferDimensionsFromContent("dark forest, landscape, moonlight, fog", "full-body");
      expect(dims).toEqual({ width: 1216, height: 832 });
    });

    it("uses shot scale dimensions when content has no strong signal", () => {
      const dims = inferDimensionsFromContent("warrior, cave, torch", "wide-shot");
      expect(dims).toEqual({ width: 1216, height: 832 });
    });

    it("uses shot scale dimensions for close-up when no content override", () => {
      const dims = inferDimensionsFromContent("warrior, glowing eyes, darkness", "close-up");
      expect(dims).toEqual({ width: 832, height: 1216 });
    });

    it("respects custom dimensions over everything", () => {
      const custom = { width: 768, height: 768 };
      const dims = inferDimensionsFromContent("1girl, portrait, solo", "close-up", custom);
      expect(dims).toEqual(custom);
    });

    it("overrides landscape scale when content is strongly portrait", () => {
      const dims = inferDimensionsFromContent("1man, solo, headshot, face detail", "wide-shot");
      expect(dims).toEqual({ width: 832, height: 1216 });
    });

    it("overrides portrait scale when content is strongly landscape", () => {
      const dims = inferDimensionsFromContent("panoramic battlefield, wide angle, skyline", "close-up");
      expect(dims).toEqual({ width: 1216, height: 832 });
    });

    it("does NOT override when content and scale agree", () => {
      const dims = inferDimensionsFromContent("1girl, portrait, face", "close-up");
      expect(dims).toEqual({ width: 832, height: 1216 });
    });
  });

  describe("reorderByPriority", () => {
    it("puts character count tags first", () => {
      const result = reorderByPriority("dark cave, oil painting, 1girl, dramatic lighting");
      const tags = result.split(", ");
      expect(tags[0]).toBe("1girl");
    });

    it("puts appearance tags before environment", () => {
      const result = reorderByPriority("dark forest, red hair, masterpiece, tall warrior");
      const tags = result.split(", ");
      const hairIdx = tags.findIndex(t => t === "red hair");
      const forestIdx = tags.findIndex(t => t === "dark forest");
      expect(hairIdx).toBeLessThan(forestIdx);
    });

    it("puts quality/style tags last", () => {
      const result = reorderByPriority("masterpiece, 1boy, dark cave, best quality, armor");
      const tags = result.split(", ");
      const lastTwo = tags.slice(-2);
      expect(lastTwo).toContain("masterpiece");
      expect(lastTwo).toContain("best quality");
    });

    it("preserves weighted tags near the top", () => {
      const result = reorderByPriority("dark cave, (cybernetic eye:1.3), masterpiece");
      const tags = result.split(", ");
      const weightedIdx = tags.findIndex(t => t.includes("cybernetic"));
      const masterIdx = tags.findIndex(t => t === "masterpiece");
      expect(weightedIdx).toBeLessThan(masterIdx);
    });

    it("returns short prompts unchanged", () => {
      const result = reorderByPriority("warrior, cave");
      expect(result).toBe("warrior, cave");
    });

    it("puts action/pose before environment", () => {
      const result = reorderByPriority("moonlight, 1woman, standing on cliff, masterpiece");
      const tags = result.split(", ");
      const standingIdx = tags.findIndex(t => t.includes("standing"));
      const moonIdx = tags.findIndex(t => t.includes("moonlight"));
      expect(standingIdx).toBeLessThan(moonIdx);
    });
  });

  describe("detectSceneArchetype", () => {
    it("detects action scenes", () => {
      expect(detectSceneArchetype("warrior, fighting, sword slash, blood spray, dynamic")).toBe("action");
    });

    it("detects horror scenes", () => {
      expect(detectSceneArchetype("corpse, undead, eldritch horror, decay, dark")).toBe("horror");
    });

    it("detects portrait scenes", () => {
      expect(detectSceneArchetype("1girl, portrait, face detail, solo, sharp focus")).toBe("portrait");
    });

    it("detects landscape scenes", () => {
      expect(detectSceneArchetype("wide shot, panoramic, mountain vista, sunset")).toBe("landscape");
    });

    it("returns general for ambiguous prompts", () => {
      expect(detectSceneArchetype("warrior, dark cave, torch, dramatic")).toBe("general");
    });
  });

  describe("getArchetypeParams", () => {
    it("returns more steps for portrait scenes", () => {
      const params = getArchetypeParams("portrait");
      expect(params.stepsMod).toBeGreaterThan(0);
    });

    it("returns higher cfg for horror scenes", () => {
      const params = getArchetypeParams("horror");
      expect(params.cfgMod).toBeGreaterThan(0);
    });

    it("returns zero mods for action (defaults work)", () => {
      const params = getArchetypeParams("action");
      expect(params.cfgMod).toBe(0);
      expect(params.stepsMod).toBe(0);
    });
  });

  describe("parseCinematography", () => {
    it("parses all fields from well-formatted extraction", () => {
      const extraction = `MOMENT: warrior enters the cave
SUBJECT: 1man, armored
SHOT_SCALE: close-up
CAMERA_ANGLE: low-angle
DEPTH_STYLE: shallow
DIRECTOR_NOTE: torchlight reflects off wet cave walls`;
      const result = parseCinematography(extraction);
      expect(result.shotScale).toBe("close-up");
      expect(result.cameraAngle).toBe("low-angle");
      expect(result.depthStyle).toBe("shallow");
      expect(result.directorNote).toBe("torchlight reflects off wet cave walls");
    });

    it("falls back to defaults for missing fields", () => {
      const extraction = `MOMENT: warrior stands
SUBJECT: 1man`;
      const result = parseCinematography(extraction);
      expect(result.shotScale).toBe("medium-shot");
      expect(result.cameraAngle).toBe("eye-level");
      expect(result.depthStyle).toBe("deep");
      expect(result.directorNote).toBe("");
    });

    it("handles LLM adding extra text around valid values", () => {
      const extraction = `SHOT_SCALE: I would choose extreme-wide for this scene
CAMERA_ANGLE: definitely dutch-angle to convey unease
DEPTH_STYLE: atmospheric works best here
DIRECTOR_NOTE: silhouette against burning city`;
      const result = parseCinematography(extraction);
      expect(result.shotScale).toBe("extreme-wide");
      expect(result.cameraAngle).toBe("dutch-angle");
      expect(result.depthStyle).toBe("atmospheric");
    });

    it("is case-insensitive", () => {
      const extraction = `SHOT_SCALE: Wide-Shot
CAMERA_ANGLE: Birds-Eye
DEPTH_STYLE: Shallow`;
      const result = parseCinematography(extraction);
      expect(result.shotScale).toBe("wide-shot");
      expect(result.cameraAngle).toBe("birds-eye");
      expect(result.depthStyle).toBe("shallow");
    });

    it("falls back for completely invalid values", () => {
      const extraction = `SHOT_SCALE: banana
CAMERA_ANGLE: upside-down
DEPTH_STYLE: watery`;
      const result = parseCinematography(extraction);
      expect(result.shotScale).toBe("medium-shot");
      expect(result.cameraAngle).toBe("eye-level");
      expect(result.depthStyle).toBe("deep");
    });
  });

  describe("getShotScaleParams", () => {
    it("returns lower cfg and more steps for close-up", () => {
      const params = getShotScaleParams("close-up");
      expect(params.cfgMod).toBe(-0.5);
      expect(params.stepsMod).toBe(5);
    });

    it("returns lower cfg and more steps for extreme-close-up", () => {
      const params = getShotScaleParams("extreme-close-up");
      expect(params.cfgMod).toBe(-0.5);
      expect(params.stepsMod).toBe(5);
    });

    it("returns more steps for wide-shot", () => {
      const params = getShotScaleParams("wide-shot");
      expect(params.cfgMod).toBe(0);
      expect(params.stepsMod).toBe(5);
    });

    it("returns more steps for extreme-wide", () => {
      const params = getShotScaleParams("extreme-wide");
      expect(params.cfgMod).toBe(0);
      expect(params.stepsMod).toBe(5);
    });

    it("returns zero mods for medium-shot", () => {
      const params = getShotScaleParams("medium-shot");
      expect(params.cfgMod).toBe(0);
      expect(params.stepsMod).toBe(0);
    });
  });

  describe("SHOT_SCALE_DIMENSIONS", () => {
    it("returns portrait for close-up shots", () => {
      expect(SHOT_SCALE_DIMENSIONS["close-up"]).toEqual({ width: 832, height: 1216 });
      expect(SHOT_SCALE_DIMENSIONS["extreme-close-up"]).toEqual({ width: 832, height: 1216 });
    });

    it("returns landscape for wide shots", () => {
      expect(SHOT_SCALE_DIMENSIONS["wide-shot"]).toEqual({ width: 1216, height: 832 });
      expect(SHOT_SCALE_DIMENSIONS["extreme-wide"]).toEqual({ width: 1216, height: 832 });
    });

    it("returns square for medium shots", () => {
      expect(SHOT_SCALE_DIMENSIONS["medium-shot"]).toEqual({ width: 1024, height: 1024 });
      expect(SHOT_SCALE_DIMENSIONS["medium-close-up"]).toEqual({ width: 1024, height: 1024 });
    });

    it("returns portrait for full-body", () => {
      expect(SHOT_SCALE_DIMENSIONS["full-body"]).toEqual({ width: 832, height: 1216 });
    });
  });
});
