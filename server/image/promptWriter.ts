import { db } from "../db";
import { sceneImages } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { callLLM, type ProviderConfig } from "../llm/providers";
import type { TriggerType, PromptWriterResult, ShotScale, CameraAngle, DepthStyle, CinematographyResult } from "./types";
import { getStyleConfig, GENRE_ANCHORS } from "./stylePresets";
import type { ImageStyle, CustomImageConfig } from "./types";

/** Trigger-specific negative prompt additions to steer away from wrong aesthetics */
const TRIGGER_NEGATIVE_ADDITIONS: Partial<Record<TriggerType, string>> = {
  combat: "peaceful, calm, cute, happy, relaxed, static pose",
  consequence: "cartoonish, cheerful, static pose",
};

/**
 * Scene archetype detection — identifies what kind of scene the prompt depicts
 * for parameter tuning downstream.
 */
export type SceneArchetype = "action" | "portrait" | "horror" | "landscape" | "general";

export function detectSceneArchetype(positive: string): SceneArchetype {
  const lower = positive.toLowerCase();

  if (/\b(fighting|combat|sword|explosion|attack|dodge|blood spray|battle|charging)\b/.test(lower)) return "action";
  if (/\b(horror|gore|viscera|corpse|undead|eldritch|nightmare|dread|decay)\b/.test(lower)) return "horror";
  if (/\b(portrait|close-up|solo|face detail|headshot|upper body)\b/.test(lower)) return "portrait";
  if (/\b(landscape|panoramic|wide shot|establishing|skyline|vista|environment)\b/.test(lower)) return "landscape";

  return "general";
}

/**
 * Get optimal generation parameters for a scene archetype.
 * These are soft suggestions — style preset values take precedence.
 */
export function getArchetypeParams(archetype: SceneArchetype): { cfgMod: number; stepsMod: number; denoiseMod: number } {
  switch (archetype) {
    case "action": return { cfgMod: 0, stepsMod: 0, denoiseMod: 0 }; // defaults are fine for action
    case "portrait": return { cfgMod: -0.5, stepsMod: 5, denoiseMod: -0.05 }; // lower cfg + more steps for face detail
    case "horror": return { cfgMod: 0.5, stepsMod: 0, denoiseMod: 0 }; // slightly higher cfg for stark contrast
    case "landscape": return { cfgMod: 0, stepsMod: 5, denoiseMod: 0 }; // more steps for environmental detail
    default: return { cfgMod: 0, stepsMod: 0, denoiseMod: 0 };
  }
}

const SINGLE_PASS_OPTIONS = {
  temperature: 0.55,
  maxTokens: 700,
};

const RETRY_OPTIONS = {
  temperature: 0.5,
  maxTokens: 300,
};

// Simple LRU cache for last prompt per campaign (avoids DB query)
const lastPromptCache = new Map<string, string>();
const CACHE_MAX = 20;

const DIMENSION_MAP: Record<TriggerType, { width: number; height: number }> = {
  scene_change: { width: 1216, height: 832 },
  combat: { width: 1024, height: 1024 },
  consequence: { width: 832, height: 1216 },
  gm_event: { width: 1216, height: 832 },
  player_request: { width: 1024, height: 1024 },
};

export function getDimensionsForTrigger(
  triggerType: TriggerType,
  customDimensions?: { width: number; height: number }
): { width: number; height: number } {
  if (customDimensions) return customDimensions;
  return DIMENSION_MAP[triggerType] ?? { width: 1024, height: 1024 };
}

export const SHOT_SCALE_DIMENSIONS: Record<ShotScale, { width: number; height: number }> = {
  "extreme-close-up": { width: 832, height: 1216 },
  "close-up":         { width: 832, height: 1216 },
  "medium-close-up":  { width: 1024, height: 1024 },
  "medium-shot":      { width: 1024, height: 1024 },
  "medium-full":      { width: 1024, height: 1024 },
  "full-body":        { width: 832, height: 1216 },
  "wide-shot":        { width: 1216, height: 832 },
  "extreme-wide":     { width: 1216, height: 832 },
};

const VALID_SHOT_SCALES: ShotScale[] = [
  "extreme-close-up", "close-up", "medium-close-up", "medium-shot",
  "medium-full", "full-body", "wide-shot", "extreme-wide",
];
const VALID_CAMERA_ANGLES: CameraAngle[] = [
  "eye-level", "low-angle", "high-angle", "birds-eye", "dutch-angle", "over-shoulder",
];
const VALID_DEPTH_STYLES: DepthStyle[] = ["shallow", "deep", "atmospheric"];

export function parseCinematography(extraction: string): CinematographyResult {
  const shotMatch = extraction.match(/SHOT_SCALE:\s*(.+)/i);
  const angleMatch = extraction.match(/CAMERA_ANGLE:\s*(.+)/i);
  const depthMatch = extraction.match(/DEPTH_STYLE:\s*(.+)/i);
  const noteMatch = extraction.match(/DIRECTOR_NOTE:\s*(.+)/i);

  const rawScale = shotMatch?.[1]?.trim().toLowerCase() ?? "";
  const rawAngle = angleMatch?.[1]?.trim().toLowerCase() ?? "";
  const rawDepth = depthMatch?.[1]?.trim().toLowerCase() ?? "";

  return {
    shotScale: VALID_SHOT_SCALES.find(s => rawScale.includes(s)) ?? "medium-shot",
    cameraAngle: VALID_CAMERA_ANGLES.find(a => rawAngle.includes(a)) ?? "eye-level",
    depthStyle: VALID_DEPTH_STYLES.find(d => rawDepth.includes(d)) ?? "deep",
    directorNote: noteMatch?.[1]?.trim() ?? "",
  };
}

/**
 * Fallback cinematography when LLM doesn't produce explicit framing decisions.
 * Uses narrative content and trigger type to make reasonable defaults.
 */
export function inferCinematographyFromContent(text: string, triggerType: TriggerType): CinematographyResult {
  const lower = text.toLowerCase();

  // Combat/action → medium-full, low angle for dynamism
  if (triggerType === "combat" || /\b(fight|attack|swing|dodge|block|charge|slash|parry)\b/.test(lower)) {
    return { shotScale: "medium-full", cameraAngle: "low-angle", depthStyle: "deep", directorNote: "" };
  }

  // Quiet, personal moments → medium-close-up, shallow depth
  if (/\b(embrac(?:e[sd]?|ing)|whisper|lips)\b/.test(lower)) {
    return { shotScale: "medium-close-up", cameraAngle: "eye-level", depthStyle: "shallow", directorNote: "" };
  }

  // Scene changes / new locations → wide shot, deep focus
  if (triggerType === "scene_change" || /\b(enter|arrive|emerge|approach|step into)\b/.test(lower)) {
    return { shotScale: "wide-shot", cameraAngle: "eye-level", depthStyle: "deep", directorNote: "" };
  }

  // Conversation/dialogue → medium shot (excluding whisper which is handled above)
  if (/\b(says?|speaks?|tells?|asks?|repl(?:y|ies)|responds?|nods?|smiles?|frowns?)\b/.test(lower)) {
    return { shotScale: "medium-shot", cameraAngle: "eye-level", depthStyle: "shallow", directorNote: "" };
  }

  // Horror/transformation → dutch angle, atmospheric
  if (/\b(transform|mutate|horror|dread|eldritch|blood|gore)\b/.test(lower)) {
    return { shotScale: "medium-shot", cameraAngle: "dutch-angle", depthStyle: "atmospheric", directorNote: "" };
  }

  // GM events → establishing shot
  if (triggerType === "gm_event") {
    return { shotScale: "wide-shot", cameraAngle: "high-angle", depthStyle: "atmospheric", directorNote: "" };
  }

  return { shotScale: "medium-shot", cameraAngle: "eye-level", depthStyle: "deep", directorNote: "" };
}

export function getShotScaleParams(shotScale: ShotScale): { cfgMod: number; stepsMod: number } {
  switch (shotScale) {
    case "extreme-close-up":
    case "close-up":
      return { cfgMod: -0.5, stepsMod: 5 };
    case "wide-shot":
    case "extreme-wide":
      return { cfgMod: 0, stepsMod: 5 };
    default:
      return { cfgMod: 0, stepsMod: 0 };
  }
}

export function getAspectLabel(dims: { width: number; height: number }): "portrait" | "landscape" | "square" {
  if (dims.width > dims.height) return "landscape";
  if (dims.height > dims.width) return "portrait";
  return "square";
}

/**
 * Intelligently select dimensions based on positive prompt content.
 * Overrides shot-scale defaults only when content strongly disagrees with the scale's orientation.
 */
export function inferDimensionsFromContent(
  positive: string,
  shotScale: ShotScale,
  customDimensions?: { width: number; height: number }
): { width: number; height: number } {
  if (customDimensions) return customDimensions;

  const lower = positive.toLowerCase();

  // Portrait indicators: single character focus, close-up, face detail
  const isPortrait = /\b(portrait|close-up|face detail|headshot|upper body|1girl|1boy|1woman|1man|solo)\b/.test(lower)
    && !/\b(wide shot|panoramic|establishing|landscape|environment|2girls|2boys|multiple|group)\b/.test(lower);

  // Landscape indicators: wide shots, environments, multiple characters
  const isLandscape = /\b(wide shot|panoramic|establishing|landscape|environment|skyline|horizon|battlefield|wide angle)\b/.test(lower);

  const scaleDims = SHOT_SCALE_DIMENSIONS[shotScale];
  const scaleIsPortrait = scaleDims.height > scaleDims.width;
  const scaleIsLandscape = scaleDims.width > scaleDims.height;

  if (isPortrait && !scaleIsPortrait) {
    return { width: 832, height: 1216 };
  }
  if (isLandscape && !scaleIsLandscape) {
    return { width: 1216, height: 832 };
  }

  return scaleDims;
}

export interface PromptWriterInput {
  finalText: string;
  genre: string;
  tone: string;
  worldDescription: string;
  characterName: string;
  characterRole: string;
  /** Pre-composed SD-ready appearance string (from composeAppearance) */
  characterAppearance: string | null;
  characterStatus: string | null;
  sceneLocation: string | null;
  timeOfDay: string | null;
  npcs: { name: string; description?: string }[];
  triggerType: TriggerType;
  styleTags: string;
  previousPrompt: string | null;
}

/**
 * Pass 1: Extract the key visual moment and elements from full narrative.
 * Uses the FULL text (not truncated) so world-building context isn't lost.
 */
export function buildExtractionPrompt(input: PromptWriterInput): string {
  const npcList = input.npcs
    .map(n => `${n.name}${n.description ? ` (${n.description})` : ""}`)
    .join(", ");

  return `Read this RPG narrative and extract the single most visually striking moment for an illustration.

NARRATIVE:
${input.finalText}

GENRE: ${input.genre}
LOCATION: ${input.sceneLocation ?? "unknown"}
TIME: ${input.timeOfDay ?? "unknown"}
MAIN CHARACTER: ${input.characterName}, ${input.characterRole}${input.characterAppearance ? `\nAPPEARANCE: ${input.characterAppearance}` : ""}${input.characterStatus ? `\nCONDITION: ${input.characterStatus}` : ""}
NPCs IN SCENE: ${npcList || "none"}

Extract these elements. Be SPECIFIC and CONCRETE — no vague or generic descriptions.
Capture what the narrative describes — action, wounds, atmosphere, horror. Accuracy to the source material is paramount.

MOMENT: [one sentence — the single most dramatic/visual instant to capture]
SUBJECT: [who is the main focus — MUST include: gender (male/female), species (human/alien type), build, clothing, weapons, wounds, distinguishing marks. Be explicit about gender.]
BODY: [body position (standing/kneeling/lying/crouching), physical state (sweating, bleeding, wounded, exhausted), muscle tension]
ACTION: [exact pose/gesture/movement — what their body is doing RIGHT NOW, include physical contact, grappling, embracing]
EXPRESSION: [facial expression in detail — eyes, mouth, brow. Pain, fury, joy, terror, determination]
ENVIRONMENT: [3-4 specific details: materials (durasteel, stone, wood), objects, architecture, weather conditions, blood splatter, debris]
LIGHTING: [specific light source (torch, neon, starlight, fire), color temperature (warm amber, cold blue), shadow direction, how light falls on the figures]
MOOD: [one or two words — the emotional core]
SECONDARY_CHARACTERS: [if 2+ people visible, describe each briefly: gender, distinctive visual feature, what they're doing. Max 2 secondary characters.]

---

You are also the CINEMATOGRAPHER. Choose how to frame this shot based on what would make
the most dramatic, beautiful, or impactful image — NOT based on generic rules.

Examples of good cinematography reasoning:
- A quiet confession in a vast cathedral → extreme-wide (show the emptiness around them)
- A world-ending explosion → extreme-close-up on the character's terrified eyes
- Entering a new location might need a close-up if the character's reaction matters more than the place
- A fight might need a wide shot if positioning matters, or close-up if it's personal
- A character revealing a hidden scar → medium-close-up with shallow depth
- An army approaching on the horizon → extreme-wide with atmospheric depth

Think like a film director. What framing tells this story best?

SHOT SCALE OPTIONS:
- extreme-close-up: eyes, mouth, single detail (intense emotion, critical small object)
- close-up: face/head (emotional reaction, dialogue, intimidation)
- medium-close-up: chest up (conversation with some body context)
- medium-shot: waist up (balanced, showing gear/wounds/gestures)
- medium-full: knees up (movement, drawing weapons, body language)
- full-body: entire figure (outfit, stance, arrival, transformation)
- wide-shot: figure + environment (action scenes, spatial relationships)
- extreme-wide: landscape dominant (vistas, travel, showing scale)

CAMERA ANGLE OPTIONS:
- eye-level: neutral, relatable
- low-angle: heroic, imposing, powerful
- high-angle: vulnerable, small, observed
- birds-eye: tactical, map-like, detached
- dutch-angle: unease, chaos, disorientation
- over-shoulder: confrontation, tension, POV

DEPTH STYLE OPTIONS:
- shallow: subject isolation, dreamy, emotional focus
- deep: everything sharp, environment matters equally
- atmospheric: fog, haze, particles, mood-heavy

SHOT_SCALE: [pick one from the options above]
CAMERA_ANGLE: [pick one from the options above]
DEPTH_STYLE: [pick one from the options above]
DIRECTOR_NOTE: [one sentence — specific framing detail that the categories above can't capture. Be concrete and visual.]`;
}

/**
 * Build scene-aware negative prompt additions based on what the positive prompt contains.
 * Appends context-specific terms to steer away from aesthetically conflicting or unsafe outputs.
 */
export function buildDynamicNegative(positive: string, baseNegative: string): string {
  const lower = positive.toLowerCase();
  const additions: string[] = [];

  if (/\b(night|dark|darkness|midnight|nocturnal|shadow|shadowy)\b/.test(lower)) {
    additions.push("overexposed, washed out");
  }

  if (/\b(blood|gore|gory|viscera|visceral|wound|severed|dismember|mutilat)\b/.test(lower)) {
    additions.push("cute, peaceful, happy");
  }

  if (/\b(anime|manga|cel.shad|jrpg)\b/.test(lower)) {
    additions.push("photorealistic, 3d render");
  }

  if (/\b(photorealistic|photograph|raw photo|hyperrealistic|lifelike)\b/.test(lower)) {
    additions.push("anime, cartoon, painting");
  }

  // Anti-generic: when specific character features are present, negate generic alternatives
  if (/\b(scar|cybernetic|tattoo|piercing|mechanical|prosthetic|patch|burn|marking)\b/.test(lower)) {
    additions.push("perfect skin, flawless, generic face, symmetrical face");
  }

  if (additions.length === 0) return baseNegative;
  return `${baseNegative}, ${additions.join(", ")}`;
}

/**
 * Single-pass prompt that combines extraction + cinematography + SD tag optimization.
 * Replaces the old 2-call pipeline (extract → optimize) with one call.
 */
export function buildSinglePassPrompt(
  input: PromptWriterInput,
  genre: string,
  styleTags: string,
  previousPrompt: string | null
): string {
  const npcList = input.npcs
    .map(n => `${n.name}${n.description ? ` (${n.description})` : ""}`)
    .join(", ");
  const genreAnchors = GENRE_ANCHORS[genre] ?? "";

  return `Analyse this RPG narrative, choose cinematography, and produce an optimal SDXL prompt.

NARRATIVE:
${input.finalText}

GENRE: ${genre} | LOCATION: ${input.sceneLocation ?? "unknown"} | TIME: ${input.timeOfDay ?? "unknown"}
CHARACTER: ${input.characterName}, ${input.characterRole}${input.characterAppearance ? ` | APPEARANCE: ${input.characterAppearance}` : ""}${input.characterStatus ? ` | CONDITION: ${input.characterStatus}` : ""}
NPCs: ${npcList || "none"}
GENRE ANCHORS: ${genreAnchors}
STYLE: ${styleTags}
${previousPrompt ? `PREVIOUS IMAGE — MAINTAIN VISUAL CONTINUITY. Reuse the same art style, color palette, and lighting feel from this prompt:\n${previousPrompt}\nIMPORTANT: Keep the same style/quality tags at the end. Change the subject/action/environment to match the new scene.` : ""}

STEP 1 — Identify the single most visually striking moment.
STEP 2 — Choose cinematography:
  SHOT_SCALE: (extreme-close-up|close-up|medium-close-up|medium-shot|medium-full|full-body|wide-shot|extreme-wide)
  CAMERA_ANGLE: (eye-level|low-angle|high-angle|birds-eye|dutch-angle|over-shoulder)
  DEPTH_STYLE: (shallow|deep|atmospheric)
STEP 3 — Convert to comma-separated SDXL tags (max 35).

Output format (exactly 4 lines):
SHOT_SCALE: <value>
CAMERA_ANGLE: <value>
DEPTH_STYLE: <value>
TAGS: <comma-separated SD tags>

Tag rules:
- FIRST: character count + gender (1man, 1woman, solo, couple). Adult characters are always 1man/1woman, never 1boy/1girl
- Include: specific appearance (clothing, wounds, body position), action/pose, 2-3 environment details, 1-2 lighting tags, end with art style
- Include TIME-SPECIFIC lighting: morning=warm golden light, soft shadows; afternoon=bright overhead sun, hard shadows; evening=orange sunset, long shadows, golden hour; night=moonlight, deep shadows, cool blue tones, artificial light sources
- Translate cinematography into concrete tags (e.g., "close-up" → "close-up portrait", "low-angle" → "from below")
- End with "extremely detailed, sharp focus"
- NEVER repeat tags, NEVER use filler
- Capture what the narrative describes, staying faithful to the scene

EXAMPLES of excellent output:

Example 1 (fantasy combat, medium-full shot):
SHOT_SCALE: medium-full
CAMERA_ANGLE: low-angle
DEPTH_STYLE: deep
TAGS: 1man, muscular warrior, battle-scarred, leather armor, greatsword raised overhead, battle stance, aggressive expression, clenched teeth, blood splatter on face, dark stone arena, scattered weapons on ground, dust particles, torch fire, warm amber rim lighting, dramatic shadows, fantasy art, (extremely detailed:1.1), (sharp focus:1.1)

Example 2 (sci-fi dialogue, close-up):
SHOT_SCALE: close-up
CAMERA_ANGLE: over-shoulder
DEPTH_STYLE: shallow
TAGS: 1woman, cyberpunk hacker, pale skin, neon blue undercut hair, glowing cybernetic eye, leather jacket with circuit patterns, smirking, holographic display reflected in eyes, dark server room background, shallow depth of field, bokeh, neon pink and blue lighting, cinematic sci-fi, (extremely detailed:1.1), (sharp focus:1.1)

Example 3 (horror scene, wide shot):
SHOT_SCALE: wide-shot
CAMERA_ANGLE: dutch-angle
DEPTH_STYLE: atmospheric
TAGS: 1man, lone figure, tattered coat, holding lantern, standing at entrance of abandoned cathedral, crumbling stone pillars, shattered stained glass, thick fog rolling across floor, moonlight through broken roof, deep shadows, unsettling atmosphere, something moving in shadows, gothic horror, high contrast chiaroscuro, (extremely detailed:1.1), (sharp focus:1.1)`;
}

/**
 * Pass 2 (optimizer): Convert extracted visual elements and cinematography into optimal SD tags.
 */
export function buildOptimizerPrompt(
  extraction: string,
  cinematography: CinematographyResult,
  genre: string,
  styleTags: string,
  previousPrompt: string | null,
  aspectRatio: "portrait" | "landscape" | "square"
): string {
  const genreAnchors = GENRE_ANCHORS[genre] ?? "";
  const cinematographyBlock = [
    `SHOT: ${cinematography.shotScale}`,
    `ANGLE: ${cinematography.cameraAngle}`,
    `DEPTH: ${cinematography.depthStyle}`,
    cinematography.directorNote ? `DIRECTOR'S NOTE: ${cinematography.directorNote}` : null,
  ].filter(Boolean).join("\n");

  return `You are an elite SDXL prompt engineer. Your job: take this scene extraction and cinematography direction and produce the single best possible Stable Diffusion prompt. Every tag must earn its place.

SCENE EXTRACTION:
${extraction}

CINEMATOGRAPHY:
${cinematographyBlock}

ASPECT RATIO: ${aspectRatio} (compose for this frame shape)
GENRE ANCHORS: ${genreAnchors}
ART STYLE: ${styleTags}
${previousPrompt ? `PREVIOUS IMAGE (maintain visual continuity): ${previousPrompt}` : ""}

Rules:
- Output ONLY comma-separated SD tags on a single line, nothing else
- Maximum 35 tags — every tag must add visual value, no filler
- FIRST tags: character count and gender (1man, 1woman, 1girl, 1boy, solo, couple)
- Translate the cinematography into concrete SD tags:
  - Shot scale → framing tags (e.g., "extreme close-up of eyes", "full body shot", "wide landscape shot")
  - Camera angle → perspective tags (e.g., "from below", "from above", "over shoulder view", "dutch angle")
  - Depth style → focus tags (e.g., "shallow depth of field, bokeh background", "deep focus", "atmospheric haze, volumetric fog")
  - Director's note → translate into 1-2 specific SD tags (e.g., "through bars", "silhouette against fire")
- Include specific physical appearance: clothing state, wounds, body position
- Include body state: sweat, blood, tears, exhaustion — whatever the scene demands
- Include 2-3 environment details (materials, objects, weather)
- Include 1-2 lighting tags that describe how light interacts with the scene
- End with art style tags
- Add "extremely detailed, sharp focus" for quality
- NEVER repeat any tag
- NEVER use vague filler tags ("wayward", "certain", "heavy" as standalone)
- Keep genre consistency — don't default to modern/real-world aesthetics
- Generate tags for what the extraction describes, with precise, concrete visual detail.
- When multiple characters are present, use numbered tags (1girl, 2girls) and describe each character's distinguishing feature`;
}

/**
 * Legacy single-pass prompt builder (kept for tests).
 */
export function buildImagePromptContext(input: PromptWriterInput): string {
  const sceneText = input.finalText.slice(-500);
  const npcList = input.npcs
    .map(n => `${n.name}${n.description ? ` (${n.description})` : ""}`)
    .join(", ");

  return `You are an expert Stable Diffusion prompt engineer for ${input.genre} ${input.tone} art.

Write a single detailed image generation prompt for this RPG scene.

SCENE: ${sceneText}
LOCATION: ${input.sceneLocation ?? "unknown"}, ${input.timeOfDay ?? "unknown time"}
CHARACTER: ${input.characterName}, ${input.characterRole}. ${input.characterStatus ?? "healthy"}
NPCs PRESENT: ${npcList || "none"}
TRIGGER: ${input.triggerType} — emphasize this in composition
WORLD: ${input.worldDescription.slice(0, 200)}
PREVIOUS IMAGE: ${input.previousPrompt ?? "none — this is the first image"}

Rules:
- Output ONLY the SD prompt, nothing else
- Include: subject, action, environment, lighting, camera angle, art style
- Use SD-optimized keyword format (comma-separated tags)
- Maintain visual continuity with previous image description
- Style: ${input.styleTags}
- Do NOT include negative prompt — handled separately`;
}

/**
 * Heuristic check: does the output look like SD comma-separated tags?
 * Returns false if it looks like a paragraph, refusal, or invalid output.
 */
export function looksLikeSdTags(text: string): boolean {
  if (!text || text.length < 10) return false;
  // SD tags are comma-separated, short segments. If average segment > 40 chars, it's prose.
  const segments = text.split(",").map(s => s.trim()).filter(Boolean);
  if (segments.length < 3) return false;
  const avgLength = segments.reduce((sum, s) => sum + s.length, 0) / segments.length;
  if (avgLength > 40) return false;
  // Check for refusal indicators
  if (/\b(sorry|apologize|cannot|can't|won't|inappropriate|unable)\b/i.test(text)) return false;
  return true;
}

/**
 * Boost character-specific distinctive features in the prompt.
 * If the character has unique traits (cybernetic eye, scar, tattoo),
 * and those traits appear in the generated prompt, boost their weight.
 */
export function boostCharacterFeatures(positive: string, characterAppearance: string | null): string {
  if (!characterAppearance) return positive;

  const traits = characterAppearance.split(",").map(t => t.trim()).filter(t => t.length >= 5);
  if (traits.length === 0) return positive;

  let result = positive;
  for (const trait of traits) {
    const lower = trait.toLowerCase();
    // Only boost truly distinctive features
    const isDistinctive = /(?:cybernetic|prosthetic|mechanical|scar|tattoo|piercing|horn|tail|wing|glowing|missing|patch|mark|brand|burn|claw|fang|antler|crystal|gem|rune|bionic|augment)/.test(lower);
    if (!isDistinctive) continue;

    // Find the trait in the positive prompt and boost it
    const escaped = trait.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![(:])(${escaped})(?![):])`, "gi");
    result = result.replace(regex, `($1:1.3)`);
  }

  return result;
}

/**
 * Reorder tags by visual importance for SDXL.
 * SDXL weights early tokens more heavily, so critical visual elements go first.
 * Priority: character count → subject → action → expression → environment → lighting → quality/style
 */
export function reorderByPriority(prompt: string): string {
  const tags = prompt.split(",").map(t => t.trim()).filter(Boolean);
  if (tags.length <= 3) return prompt;

  const priority: { tag: string; score: number }[] = tags.map(tag => {
    // Classify weighted tags by their inner text so "(masterpiece:1.2)" still sinks to the end
    const inner = tag.replace(/^\((.+):[\d.]+\)$/, "$1");
    const isWeighted = inner !== tag;
    const lower = inner.toLowerCase();
    let score = 50; // default mid-priority

    // Highest priority: character count/gender (SDXL needs this first)
    if (/^(1girl|1boy|1man|1woman|2girls|2boys|solo|multiple|couple)\b/.test(lower)) score = 100;
    else if (/\b(male|female|man|woman|girl|boy)\b/.test(lower) && lower.length < 20) score = 95;

    // High priority: character appearance (what they look like)
    else if (/\b(hair|eyes|skin|face|clothed|armor|dress|uniform)\b/.test(lower)) score = 80;
    else if (/\b(muscular|slender|tall|curvy|athletic|petite)\b/.test(lower)) score = 78;

    // Medium-high: action/pose
    else if (/\b(standing|sitting|lying|kneeling|fighting|running|embracing)\b/.test(lower)) score = 70;
    else if (/\b(expression|smile|crying|screaming|pained|ecstatic)\b/.test(lower)) score = 68;

    // Medium: environment
    else if (/\b(cave|forest|room|castle|city|bed|throne|battlefield|dungeon)\b/.test(lower)) score = 45;
    else if (/\b(rain|snow|fog|night|day|sunset|moonlight)\b/.test(lower)) score = 42;

    // Low priority: lighting descriptors
    else if (/\b(lighting|shadow|backlit|rim light|volumetric|ambient)\b/.test(lower)) score = 30;

    // Lowest priority: quality/style (these are tag-suffix material)
    else if (/\b(masterpiece|best quality|detailed|sharp focus|4k|8k|uhd)\b/.test(lower)) score = 10;
    else if (/\b(oil painting|anime|cinematic|concept art|photorealistic)\b/.test(lower)) score = 15;

    // Weighted tags without a known category were boosted deliberately (distinctive traits)
    if (isWeighted && score === 50) score = 90;

    return { tag, score };
  });

  // Stable sort by score (descending)
  priority.sort((a, b) => b.score - a.score);
  return priority.map(p => p.tag).join(", ");
}

/** Tags that should get emphasis weighting when present (improves quality) */
const EMPHASIS_TAGS: Record<string, number> = {
  "masterpiece": 1.2,
  "best quality": 1.2,
  "extremely detailed": 1.1,
  "sharp focus": 1.1,
};

/**
 * Apply (tag:weight) emphasis to quality tags for stronger effect.
 */
export function applyEmphasis(prompt: string): string {
  let result = prompt;
  for (const [tag, weight] of Object.entries(EMPHASIS_TAGS)) {
    // Only apply to standalone tags, not already weighted ones
    const regex = new RegExp(`(?<![:(])\\b${tag.replace(/\s+/g, "\\s+")}\\b(?![):])`, "gi");
    result = result.replace(regex, `(${tag}:${weight})`);
  }
  return result;
}

/**
 * Structure the positive prompt with BREAK separators for SDXL.
 * Format: [subject tags] BREAK [environment tags] BREAK [quality/style tags]
 * This prevents concept bleeding between character, setting, and style.
 */
export function structureWithBreaks(positive: string): string {
  const tags = positive.split(",").map(t => t.trim()).filter(Boolean);

  const subject: string[] = [];
  const environment: string[] = [];
  const style: string[] = [];

  // Keyword sets for classification
  const subjectKeywords = [
    "1girl", "1boy", "1man", "1woman", "2girls", "2boys", "multiple girls", "multiple boys",
    "man", "woman", "girl", "boy", "male", "female",
    "hair", "eyes", "skin", "face", "body", "clothed",
    "dress", "armor", "sword", "weapon", "shield", "blood on", "wound", "scar",
    "expression", "pose", "standing", "kneeling", "lying", "sitting", "crouching",
    "smile", "frown", "crying", "screaming", "laughing",
    "muscle", "slim", "athletic", "curvy", "tall", "short",
    "elf", "orc", "dwarf", "alien", "vampire", "demon", "angel",
    "cloak", "robe", "tunic", "chainmail", "leather",
    "dagger", "staff", "bow", "axe", "spear",
    "sweat", "tear", "blush", "exhausted",
  ];

  const environmentKeywords = [
    "cave", "forest", "jungle", "desert", "tundra",
    "room", "chamber", "hall", "corridor", "dungeon",
    "floor", "wall", "ceiling", "door", "window",
    "sky", "rain", "snow", "fog", "mist", "storm", "wind",
    "moon", "sun", "star", "cloud",
    "building", "castle", "tower", "bridge", "ruin",
    "bed", "throne", "altar", "table", "chair",
    "fire", "torch", "campfire", "lantern",
    "street", "alley", "market", "tavern",
    "tree", "grass", "rock", "stone", "water", "river", "lake", "ocean",
    "neon", "holograph", "spaceship", "debris",
    "blood splatter", "puddle", "smoke",
    "architecture",
  ];

  const styleKeywords = [
    "masterpiece", "best quality", "worst quality", "low quality",
    "extremely detailed", "highly detailed", "sharp focus", "soft focus",
    "oil painting", "watercolor", "pencil sketch", "ink illustration",
    "anime", "manga", "cel shad", "jrpg", "cartoon",
    "photorealistic", "raw photo", "photograph", "hyperrealistic",
    "cinematic", "dramatic lighting", "studio lighting", "rim light",
    "bokeh", "depth of field", "film grain", "8k", "uhd", "4k",
    "concept art", "fantasy art", "dark art", "horror art",
    "high contrast", "chiaroscuro", "volumetric",
    "intricate details", "fine art", "professional",
  ];

  function classifyTag(tag: string): "subject" | "environment" | "style" {
    const lower = tag.toLowerCase();

    // Check style first — quality/art tags are most distinctive
    for (const kw of styleKeywords) {
      if (lower.includes(kw)) return "style";
    }

    // Check environment next
    for (const kw of environmentKeywords) {
      if (lower.includes(kw)) return "environment";
    }

    // Check subject keywords
    for (const kw of subjectKeywords) {
      if (lower.includes(kw)) return "subject";
    }

    // Default: subject group (character details are the majority of ambiguous tags)
    return "subject";
  }

  for (const tag of tags) {
    const group = classifyTag(tag);
    if (group === "subject") subject.push(tag);
    else if (group === "environment") environment.push(tag);
    else style.push(tag);
  }

  // Build result — omit empty groups and their BREAK separators
  const parts: string[] = [];
  if (subject.length > 0) parts.push(subject.join(", "));
  if (environment.length > 0) parts.push(environment.join(", "));
  if (style.length > 0) parts.push(style.join(", "));

  // Only insert BREAK when there are at least two distinct non-empty groups
  if (parts.length <= 1) return positive;

  return parts.join(" BREAK ");
}

/**
 * Carry over style/quality/lighting tags from the previous prompt to maintain visual continuity.
 * Extracts style-category tags from the previous prompt and appends any missing ones.
 */
export function carryOverStyleTags(current: string, previous: string): string {
  const currentTags = new Set(current.split(",").map(t => t.trim().toLowerCase()).filter(Boolean));
  const prevTags = previous.split(",").map(t => t.trim()).filter(Boolean);

  // Style/quality keywords that should carry over for consistency
  const stylePatterns = /\b(masterpiece|best quality|extremely detailed|sharp focus|oil painting|concept art|cinematic|dramatic lighting|volumetric|chiaroscuro|cel shading|anime style|photorealistic|fantasy art|dark art|horror art|noir|painterly|ink illustration|watercolor)\b/i;
  const lightingPatterns = /\b(warm.*light|cool.*light|golden hour|rim light|backlit|neon|moonlight|candlelight|torch|firelight|ambient|volumetric fog|volumetric light|god rays)\b/i;

  const toCarry: string[] = [];
  for (const tag of prevTags) {
    const lower = tag.toLowerCase().replace(/[():\d.]/g, "").trim();
    if (!lower) continue;
    if (currentTags.has(lower)) continue; // already present
    if (stylePatterns.test(tag) || lightingPatterns.test(tag)) {
      toCarry.push(tag);
    }
  }

  if (toCarry.length === 0) return current;
  // Append carried tags before the last tag (which is usually quality)
  return current + ", " + toCarry.join(", ");
}

/**
 * Strip LLM preamble and ensure SD tag format.
 */
export function cleanSdPrompt(raw: string): string {
  let cleaned = raw.trim();

  // Strip common preamble patterns
  cleaned = cleaned.replace(/^(?:here(?:'s| is) (?:your |the |a )?(?:sd |stable diffusion )?prompt[:\s]*)/i, "");
  cleaned = cleaned.replace(/^(?:prompt[:\s]*)/i, "");

  // Strip LLM refusal/disclaimer prefixes that leak through
  cleaned = cleaned.replace(/^(?:I (?:can't|cannot|won't|will not|am not able to)[\s\S]*?(?:however|but|instead)[,:\s]*)/i, "");
  cleaned = cleaned.replace(/^(?:(?:Note|Warning|Disclaimer|Content warning)[:\s]*[^,\n]*[,\n]\s*)/i, "");
  cleaned = cleaned.replace(/^(?:(?:I'll |Let me )(?:create|generate|write)[\s\S]*?:\s*)/i, "");

  // Strip wrapping quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }

  // Strip markdown code blocks
  cleaned = cleaned.replace(/^```[\s\S]*?\n/, "").replace(/\n```\s*$/, "");

  // Strip numbered list format (1. tag, 2. tag, etc.)
  cleaned = cleaned.replace(/^\d+[.)]\s*/gm, "");

  // Strip bullet points
  cleaned = cleaned.replace(/^[-•*]\s*/gm, "");

  // Collapse multiple newlines into commas
  cleaned = cleaned.replace(/\n+/g, ", ");

  // Collapse multiple commas/spaces
  cleaned = cleaned.replace(/,\s*,+/g, ",").replace(/\s{2,}/g, " ").trim();

  // Remove trailing comma
  cleaned = cleaned.replace(/,\s*$/, "").trim();

  // Deduplicate repeated tags (LLM sometimes repeats "wayward light, wayward light, wayward light")
  const tags = cleaned.split(",").map(t => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(tag);
    }
  }

  // Second pass: remove tags that are substrings of other tags already included
  // e.g., if we have "heavy noir shadows" and "noir shadows", drop the shorter one
  const filtered = deduped.filter((tag, i) => {
    const lower = tag.toLowerCase();
    // Skip very short tags from this check
    if (lower.length < 8) return true;
    return !deduped.some((other, j) =>
      j !== i && other.toLowerCase().includes(lower) && other.length > tag.length
    );
  });

  // Cap at 35 tags max — beyond that is diminishing returns and pollution
  cleaned = filtered.slice(0, 35).join(", ");

  return cleaned;
}

/**
 * Single-pass prompt writing:
 * One LLM call extracts the visual moment, chooses cinematography, AND produces SD tags.
 * Falls back to retry with simplified prompt if output isn't valid SD tags.
 */
export async function writeImagePrompt(
  input: PromptWriterInput,
  campaignId: string,
  triggerType: TriggerType,
  imageStyle: ImageStyle | string,
  customConfig: CustomImageConfig | null,
  llmConfig: ProviderConfig
): Promise<PromptWriterResult> {
  const style = getStyleConfig(imageStyle, customConfig);

  const SYSTEM_MSG = {
    role: "system",
    content: "You are an elite visual scene analyst, cinematographer, and SDXL prompt engineer. You analyse RPG narratives, choose dramatic camera framing, and produce optimal Stable Diffusion tags — all in one step. You handle dramatic content such as combat, wounds and horror with precision. No filler tags.",
  };

  const prompt = buildSinglePassPrompt(input, input.genre, style.tags, input.previousPrompt);

  const rawResponse = await callLLM(
    llmConfig,
    [SYSTEM_MSG, { role: "user", content: prompt }],
    async () => {},
    SINGLE_PASS_OPTIONS,
    { priority: "background", retries: 1 }
  );

  // Parse cinematography + tags from single-pass output
  let cinematography = parseCinematography(rawResponse);

  // If LLM didn't produce cinematography lines (all defaults), infer from content
  const allDefaults = cinematography.shotScale === "medium-shot"
    && cinematography.cameraAngle === "eye-level"
    && cinematography.depthStyle === "deep"
    && !cinematography.directorNote;
  if (allDefaults) {
    cinematography = inferCinematographyFromContent(input.finalText, input.triggerType);
  }

  // Extract TAGS line from the response
  const tagsMatch = rawResponse.match(/TAGS:\s*(.+)/i);
  let rawPrompt = tagsMatch?.[1]?.trim() ?? rawResponse;

  // If no TAGS: line found, the whole response might be tags
  if (!tagsMatch) {
    // Strip any cinematography lines and use what remains
    rawPrompt = rawResponse
      .replace(/^SHOT_SCALE:.*$/gim, "")
      .replace(/^CAMERA_ANGLE:.*$/gim, "")
      .replace(/^DEPTH_STYLE:.*$/gim, "")
      .replace(/^DIRECTOR_NOTE:.*$/gim, "")
      .trim();
  }

  // Validate output — retry with simplified format if not SD tags
  const testCleaned = cleanSdPrompt(rawPrompt);
  if (!looksLikeSdTags(testCleaned)) {
    const retryPrompt = `Output ONLY comma-separated Stable Diffusion tags on a single line. No sentences, no explanations.\n\nScene: ${input.finalText.slice(-400)}\nStyle: ${style.tags}\n\nTags:`;
    rawPrompt = await callLLM(
      llmConfig,
      [SYSTEM_MSG, { role: "user", content: retryPrompt }],
      async () => {},
      RETRY_OPTIONS,
      { priority: "background", retries: 0 }
    );
  }

  // Post-processing pipeline — BREAK separators always improve SDXL output
  const shouldUseBreaks =
    (customConfig as CustomImageConfig & { useBreaks?: boolean })?.useBreaks !== false;

  // Reorder BEFORE emphasis so quality tags are still recognised and sink to the end
  let positive = applyEmphasis(reorderByPriority(cleanSdPrompt(rawPrompt)));

  // Carry over style/quality tags from previous prompt for visual continuity
  if (input.previousPrompt) {
    positive = carryOverStyleTags(positive, input.previousPrompt);
  }

  if (shouldUseBreaks) {
    positive = structureWithBreaks(positive);
  }
  positive = boostCharacterFeatures(positive, input.characterAppearance);

  // Dimensions: custom override → shot scale default → content override
  const dimensions = inferDimensionsFromContent(
    positive,
    cinematography.shotScale,
    customConfig?.defaultDimensions ?? style.defaultDimensions
  );

  // Negative prompt (unchanged logic)
  let baseNegative = customConfig?.negativePrompt ?? style.negativePrompt;
  const triggerNegative = TRIGGER_NEGATIVE_ADDITIONS[triggerType];
  if (triggerNegative) {
    baseNegative = `${baseNegative}, ${triggerNegative}`;
  }
  const negative = buildDynamicNegative(positive, baseNegative);

  // Adaptive CFG
  const tagCount = positive.split(",").length;
  const suggestedCfg = tagCount > 25 ? 4.5 : tagCount > 18 ? 5.5 : tagCount > 12 ? 6.5 : 7.0;

  return {
    positive,
    negative,
    width: dimensions.width,
    height: dimensions.height,
    shotScale: cinematography.shotScale,
    suggestedCfg,
  };
}

export async function getLastImagePrompt(campaignId: string): Promise<string | null> {
  // Check in-memory cache first
  const cached = lastPromptCache.get(campaignId);
  if (cached) return cached;

  const [lastImage] = await db
    .select({ sdPrompt: sceneImages.sdPrompt })
    .from(sceneImages)
    .where(
      and(
        eq(sceneImages.campaignId, campaignId),
        eq(sceneImages.status, "completed")
      )
    )
    .orderBy(desc(sceneImages.createdAt))
    .limit(1);

  const prompt = lastImage?.sdPrompt ?? null;
  if (prompt) {
    // Evict oldest if cache full
    if (lastPromptCache.size >= CACHE_MAX) {
      const firstKey = lastPromptCache.keys().next().value;
      if (firstKey) lastPromptCache.delete(firstKey);
    }
    lastPromptCache.set(campaignId, prompt);
  }
  return prompt;
}

/** Update the prompt cache after a successful generation. */
export function updatePromptCache(campaignId: string, prompt: string): void {
  if (lastPromptCache.size >= CACHE_MAX) {
    const firstKey = lastPromptCache.keys().next().value;
    if (firstKey) lastPromptCache.delete(firstKey);
  }
  lastPromptCache.set(campaignId, prompt);
}
