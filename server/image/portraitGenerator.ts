import { join } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import type { AppearanceTraits } from "./appearanceComposer";
import { composeAppearance } from "./appearanceComposer";
import { getStyleConfig } from "./stylePresets";
import { acquireForImageGen } from "./vramManager";
import { generateImage, isComfyUIAvailable, hasFaceDetailer } from "./comfyuiClient";
import { saveCharacterRef } from "./referenceManager";
import type { CustomImageConfig } from "./types";
import { config } from "../config";

// ── In-memory portrait generation tracking ──────────────────────────────────

export interface PortraitStatusEntry {
  status: "generating" | "completed" | "failed";
  progress: number;
  phase: string;
  filePath?: string;
  seed?: number;
  error?: string;
}

const gp = globalThis as typeof globalThis & { __rpgPortraitStatus?: Map<string, PortraitStatusEntry> };
// survives Next dev HMR
export const portraitStatus = (gp.__rpgPortraitStatus ??= new Map<string, PortraitStatusEntry>());

// ── Portrait generation ─────────────────────────────────────────────────────

/** Classify a gender trait value ("1woman", "1girl", "1man", ...) by whole word. */
export function genderOf(gender: string): "female" | "male" | null {
  const lower = gender.toLowerCase();
  if (/\b(1?woman|1?girl|female)\b/.test(lower)) return "female";
  if (/\b(1?man|1?boy|male)\b/.test(lower)) return "male";
  return null;
}

export async function generateCharacterPortrait(args: {
  campaignId: string;
  characterId: string;
  characterName: string;
  appearance: AppearanceTraits | null;
  imageStyle: string;
  customImageConfig?: CustomImageConfig | null;
  /** Ollama base URL for VRAM handoff */
  ollamaBaseUrl: string;
  onProgress?: (phase: string, progress: number) => void;
}): Promise<{ filePath: string; seed: number } | null> {
  const {
    campaignId, characterId, characterName, appearance,
    imageStyle, customImageConfig, ollamaBaseUrl,
    onProgress,
  } = args;

  // Get style config for prompt construction
  const style = getStyleConfig(imageStyle, customImageConfig);

  // Extract gender for maximum prompt weight — MUST be the very first token.
  // Composed without gender so it isn't repeated at a weaker weight.
  const gender = appearance?.gender ?? "";
  const appearanceWithoutGender = composeAppearance(appearance ? { ...appearance, gender: undefined } : null);

  // Build portrait-specific positive prompt — gender FIRST with emphasis
  const positiveParts: string[] = [];
  if (gender) {
    positiveParts.push(`(${gender}:1.4)`); // strong emphasis on gender
  }
  positiveParts.push("portrait", "upper body", "character portrait", "looking at viewer", "detailed face");
  if (appearanceWithoutGender) positiveParts.push(appearanceWithoutGender);
  positiveParts.push(style.tags);
  const positive = positiveParts.join(", ");

  // Build portrait-specific negative prompt — explicitly negate wrong gender
  const negativeParts = [
    style.negativePrompt,
    "blurry, bad anatomy, deformed, multiple people, crowd, text, watermark",
  ];
  // Female check first: "1woman".includes("man") would otherwise negate the subject's own gender
  const genderKind = genderOf(gender);
  if (genderKind === "female") {
    negativeParts.push("male, man, boy, masculine, beard, stubble");
  } else if (genderKind === "male") {
    negativeParts.push("female, woman, girl, feminine");
  }
  const negative = negativeParts.join(", ");

  // Portrait-optimized params
  const useFaceDetailer = hasFaceDetailer();

  onProgress?.("preparing", 0);

  // Check ComfyUI availability
  if (!(await isComfyUIAvailable())) {
    console.warn("[PortraitGen] ComfyUI not available");
    return null;
  }

  // VRAM handoff: unload Ollama before image gen
  const lease = await acquireForImageGen(ollamaBaseUrl);
  if (!lease) {
    console.warn("[PortraitGen] Could not acquire VRAM");
    return null;
  }

  try {
    onProgress?.("generating", 5);

    const uniqueSuffix = Date.now().toString(36);
    const imageId = `portrait_${characterId}_${uniqueSuffix}`;
    const { seed } = await generateImage(
      {
        positive,
        negative,
        width: 832,
        height: 1216,
        checkpoint: customImageConfig?.checkpoint ?? style.checkpoint,
        lora: customImageConfig?.lora ?? style.lora ?? undefined,
        cfg: 4.0,
        steps: 40,
        sampler: style.sampler ?? "dpmpp_2m",
        scheduler: style.scheduler ?? "karras",
        clipSkip: style.clipSkip,
        vae: style.vae,
        hiresFix: true,
        hiresFixScale: 1.5,
        hiresFixDenoise: 0.4,
        faceDetailer: useFaceDetailer,
        faceDetailerDenoise: 0.3,
      },
      campaignId,
      imageId,
      (info) => {
        onProgress?.(info.phase, info.percent);
      },
    );

    onProgress?.("saving", 95);

    // Read the generated image from the output path
    const generatedPath = join(config.outputDir, campaignId, `${imageId}.png`);
    const imageBuffer = await readFile(generatedPath);

    // Save as IP-Adapter reference for future scene consistency
    await saveCharacterRef(campaignId, characterName, imageBuffer);

    // Also save to the portraits subdirectory
    const portraitsDir = join(config.outputDir, campaignId, "portraits");
    await mkdir(portraitsDir, { recursive: true });
    const portraitPath = join(portraitsDir, `${characterId}.png`);
    await writeFile(portraitPath, imageBuffer);

    const servingPath = `rpg/${campaignId}/portraits/${characterId}.png?v=${Date.now()}`;

    onProgress?.("done", 100);

    return { filePath: servingPath, seed };
  } finally {
    await lease.release();
  }
}
