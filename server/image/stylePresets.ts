// ── Model Download Instructions ──────────────────────────────────────────────
//
// REQUIRED (all styles):
//   JuggernautXL v9 → D:/ai-models/sdxl/juggernautXL_v9.safetensors
//   SDXL VAE        → D:/ai-models/sdxl-vae/sdxl_vae.safetensors
//
// RECOMMENDED for better quality per style (set via campaign customImageConfig):
//   Anime styles    → animagineXL_v31.safetensors
//   Photorealistic  → RealVisXL_V4.0.safetensors
//   Horror          → juggernautXL_v9.safetensors (already good at horror)
//
// RECOMMENDED LoRAs:
//   Detail Tweaker XL   → add_detail.safetensors (strength 0.5-0.8, any style)
//   Skin texture         → detailed_skin_texture.safetensors (strength 0.4, realistic)
//
// ComfyUI extra_model_paths.yaml:
//   rpg:
//     checkpoints: /models/sdxl/
//     loras: /models/sdxl-lora/
//     vae: /models/sdxl-vae/
// ─────────────────────────────────────────────────────────────────────────────
import type { StylePreset, ImageStyle, CustomImageConfig, TriggerType } from "./types";

const QUALITY_NEGATIVE =
  "worst quality, low quality, normal quality, lowres, watermark, text, signature, blurry, out of frame, cropped, jpeg artifacts, compression artifacts";

const ANATOMY_NEGATIVE =
  "extra fingers, mutated hands, poorly drawn hands, poorly drawn face, extra limbs, fused fingers, too many fingers, long neck";

const SHARED_NEGATIVE = `${QUALITY_NEGATIVE}, ${ANATOMY_NEGATIVE}`;

// ── Optional LoRAs ──
// To use a LoRA, download to D:/ai-models/sdxl-lora/ and update the preset:
//   lora: { name: "filename.safetensors", strength: 0.7 }
//   - Detail Tweaker XL: enhances fine details (strength 0.5-0.8)
//   - Add More Details: increases overall detail level (strength 0.5-1.0)
//   - Anime styles: Flat Color Anime (strength 0.5-0.7)

export const STYLE_PRESETS: Record<string, StylePreset> = {
  "painterly-fantasy": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE,
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, oil painting, fantasy art, detailed environment, dramatic lighting, painterly brushstrokes, rich color palette, concept art, extremely detailed",
    cfg: 4.5,
    steps: 40,
    sampler: "dpmpp_2m_sde",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "cinematic-scifi": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", medieval, fantasy, sword, magic, horse, castle",
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, cinematic sci-fi concept art, neon lighting, cyberpunk atmosphere, holographic elements, volumetric fog, detailed technology, chrome and steel, cinematic composition, extremely detailed",
    cfg: 4.0,
    steps: 40,
    sampler: "dpmpp_2m_sde",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "dark-ink": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", colorful, bright, cheerful",
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, dark fantasy ink illustration, heavy shadows, high contrast, muted desaturated palette, gritty texture, fine lineart, sharp edges, noir aesthetic, extremely detailed",
    cfg: 5.0,
    steps: 40,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "anime-rpg": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", photorealistic, photograph",
    defaultDimensions: { width: 1024, height: 1024 },
    tags: "masterpiece, best quality, anime style, vibrant colors, detailed, JRPG concept art, cel shading, clean lines, expressive eyes",
    cfg: 5.5,
    steps: 30,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    clipSkip: 2,
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "sketch-parchment": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", photorealistic, colorful",
    defaultDimensions: { width: 1024, height: 1024 },
    tags: "masterpiece, pencil sketch on parchment paper, sepia tones, hand-drawn, journal illustration, crosshatching, detailed linework",
    cfg: 4.5,
    steps: 30,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "grimdark-horror": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", colorful, bright, cheerful, cute, happy",
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, dark horror illustration, eldritch atmosphere, deep shadows, desaturated sickly palette, dread, visceral detail, unsettling composition, high contrast chiaroscuro, extremely detailed",
    cfg: 5.0,
    steps: 40,
    sampler: "dpmpp_2m_sde",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "photorealistic": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", painting, illustration, drawing, cartoon, anime",
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, photorealistic, RAW photo, cinematic lighting, 8k uhd, detailed skin texture, film grain, depth of field, bokeh",
    cfg: 3.5,
    steps: 40,
    sampler: "dpmpp_2m_sde",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
  "extreme-horror": {
    checkpoint: "juggernautXL_v9.safetensors",
    lora: null,
    negativePrompt: SHARED_NEGATIVE + ", cheerful, bright, cute, happy, cartoon",
    defaultDimensions: { width: 1216, height: 832 },
    tags: "masterpiece, best quality, extremely detailed, horror art, visceral detail, graphic, disturbing imagery, dark atmosphere, photorealistic gore, body horror, nightmarish, sharp focus, high contrast, dramatic shadows",
    cfg: 3.5,
    steps: 45,
    sampler: "dpmpp_2m_sde",
    scheduler: "karras",
    vae: "sdxl_vae.safetensors",
    faceDetailer: true,
  },
};

/**
 * Sampler overrides for trigger types that benefit from more dynamic sampling.
 * Applied in imageOrchestrator when the preset does not already use dpmpp_2m_sde.
 */
export const TRIGGER_SAMPLER_OVERRIDE: Partial<Record<TriggerType, { sampler: string; scheduler: string }>> = {
  combat: { sampler: "dpmpp_2m_sde", scheduler: "karras" }, // more dynamic/detailed
  consequence: { sampler: "dpmpp_2m_sde", scheduler: "karras" }, // fine detail
};

/** Genre-specific visual anchors to prevent SDXL from defaulting to generic/modern aesthetics */
export const GENRE_ANCHORS: Record<string, string> = {
  "fantasy": "medieval fantasy world, swords and sorcery, magical realm",
  "sci-fi": "chrome, holographic, neon lighting, lens flare, futuristic technology, starship interior, control panels, viewport, durasteel, circuit patterns",
  "space-opera": "epic space backdrop, starfield, massive starship, galactic scale, dramatic nebula lighting, chrome and steel corridors, viewport to space, dramatic cinematic composition",
  "horror": "dark horror atmosphere, dread, shadows, eldritch, macabre, visceral, body horror",
  "extreme-horror": "extreme horror, gore, visceral detail, body horror, nightmarish, disturbing, graphic violence",
  "post-apocalyptic": "post-apocalyptic wasteland, ruins, decay, survival, makeshift technology",
  "custom": "",
};

/** Map campaign genre to a sensible default style when no explicit style is chosen */
export const GENRE_DEFAULT_STYLE: Record<string, string> = {
  "fantasy": "painterly-fantasy",
  "sci-fi": "cinematic-scifi",
  "horror": "grimdark-horror",
  "extreme-horror": "extreme-horror",
  "post-apocalyptic": "dark-ink",
  "custom": "painterly-fantasy",
};

/** Resolve effective image style: explicit campaign choice, or genre default fallback */
export function resolveImageStyle(campaign: { imageStyle: string | null; genre: string }): string {
  if (campaign.imageStyle) return campaign.imageStyle;
  return GENRE_DEFAULT_STYLE[campaign.genre] ?? "painterly-fantasy";
}

export function getStyleConfig(style: ImageStyle | string, custom?: CustomImageConfig | null): StylePreset {
  const base = STYLE_PRESETS[style] ?? STYLE_PRESETS["painterly-fantasy"];
  if (!custom) return base;
  return {
    checkpoint: custom.checkpoint ?? base.checkpoint,
    lora: custom.lora ?? base.lora,
    negativePrompt: custom.negativePrompt ?? base.negativePrompt,
    defaultDimensions: custom.defaultDimensions ?? base.defaultDimensions,
    tags: base.tags,
    cfg: base.cfg,
    steps: base.steps,
    sampler: base.sampler,
    scheduler: base.scheduler,
    clipSkip: base.clipSkip,
    vae: base.vae,
    faceDetailer: base.faceDetailer,
  };
}

/**
 * Determine if face detailer should run for this generation.
 * Enables dynamically for close-up/portrait shots regardless of style preset,
 * since SDXL struggles with faces at all resolutions.
 */
export function shouldUseFaceDetailer(
  styleFaceDetailer: boolean | undefined,
  shotScale: string | undefined
): boolean {
  // If style explicitly enables it, always use
  if (styleFaceDetailer) return true;

  // Enable for close-up through medium-full shots where face quality matters
  const closeShots = new Set(["extreme-close-up", "close-up", "medium-close-up", "medium-shot", "medium-full"]);
  if (shotScale && closeShots.has(shotScale)) return true;

  return false;
}

/**
 * Determine if hires fix should run for this generation.
 * Enables dynamically for close-up shots and high-detail styles,
 * since the second KSampler pass significantly improves fine detail.
 */
export function shouldUseHiresFix(
  styleKey: string,
  shotScale: string | undefined
): boolean {
  // Styles that always get hires fix
  const hiresStyles = new Set([
    "extreme-horror", "photorealistic",
  ]);
  if (hiresStyles.has(styleKey)) return true;

  // Close-up shots benefit from hires fix in any style
  const closeShots = new Set(["extreme-close-up", "close-up"]);
  if (shotScale && closeShots.has(shotScale)) return true;

  return false;
}

/**
 * Adaptive face detailer denoise based on style.
 * Painterly/anime styles need lower denoise to preserve artistic style.
 * Photorealistic styles can handle more re-generation.
 */
export function getFaceDetailerDenoise(styleKey: string): number {
  // Anime/painterly — gentle touch, preserve art style
  if (["anime-rpg", "painterly-fantasy", "dark-ink", "sketch-parchment"].includes(styleKey)) {
    return 0.25;
  }
  // Horror — moderate, preserve atmosphere
  if (["grimdark-horror", "extreme-horror"].includes(styleKey)) {
    return 0.30;
  }
  // Photorealistic — full re-generation for maximum face quality
  return 0.35;
}

/** Exported for tests */
export { QUALITY_NEGATIVE, ANATOMY_NEGATIVE };
