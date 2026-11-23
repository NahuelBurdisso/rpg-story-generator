import { db } from "../db";
import { sceneImages, messages, sessions, campaigns } from "../db/schema";
import type { CampaignRow, CharacterRow, SessionRow, NpcMemoryRow } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { writeImagePrompt, getLastImagePrompt, updatePromptCache, detectSceneArchetype, getArchetypeParams, getShotScaleParams } from "./promptWriter";
import { appendFile } from "fs/promises";
import { join } from "path";

import { acquireForImageGen } from "./vramManager";
import { generateImage, isComfyUIAvailable, probeAvailableNodes, hasFaceDetailer, hasIPAdapter } from "./comfyuiClient";
import { getStyleConfig, TRIGGER_SAMPLER_OVERRIDE, shouldUseFaceDetailer, shouldUseHiresFix, getFaceDetailerDenoise, resolveImageStyle as resolveStyle } from "./stylePresets";
import type { ProviderConfig } from "../llm/providers";

import { getCharacterRef, ensureCharacterRef } from "./referenceManager";
import { composeAppearance, composeDamageState } from "./appearanceComposer";
import type { ShotScale, TriggerType } from "./types";
import { findAffectedCharacter } from "../pipeline/utils";
import { config } from "../config";

/** Typed as the full TriggerType union so the (parked) per-trigger branches still typecheck. */
function playerTrigger(): TriggerType {
  return "player_request";
}

/**
 * Adaptive IP-Adapter weight based on shot scale.
 * Closer shots demand higher character fidelity; wider shots allow more composition freedom.
 */
function getAdaptiveIpaWeight(shotScale: ShotScale): number {
  switch (shotScale) {
    case "extreme-close-up": return 0.8;
    case "close-up":         return 0.7;
    case "medium-close-up":  return 0.6;
    case "medium-shot":      return 0.55;
    case "medium-full":      return 0.5;
    case "full-body":        return 0.45;
    case "wide-shot":        return 0.35;
    case "extreme-wide":     return 0.25;
    default:                 return 0.5;
  }
}

/**
 * True when the prompt depicts two or more people. IP-Adapter applies the reference to the
 * whole model, so in multi-person shots every face drifts toward the player character.
 */
export function isMultiSubject(positive: string): boolean {
  const lower = positive.toLowerCase();
  if (/\b([2-9]\s?(?:girls|boys|women|men|people|persons)|couple|group of|crowd|multiple (?:girls|boys|women|men|people))\b/.test(lower)) return true;
  const singles = lower.match(/\b1(?:girl|boy|woman|man|person|other)\b/g) ?? [];
  return singles.length >= 2;
}

/** Shot scales tight enough for the face to be a usable IP-Adapter reference */
const REF_SHOT_SCALES = new Set<ShotScale>(["close-up", "medium-close-up", "medium-shot"]);

/**
 * Only clean single-subject, close shots become the auto reference.
 * IPA PLUS copies body and clothing too, so a crowded first image would
 * bleed into every later scene.
 */
export function isGoodAutoReference(positive: string, shotScale: ShotScale | undefined): boolean {
  return !!shotScale && REF_SHOT_SCALES.has(shotScale) && !isMultiSubject(positive);
}

export interface Img2ImgFrame {
  location: string | null;
  width: number;
  height: number;
}

/**
 * img2img only continues a shot: same known location and same
 * orientation. Center-cropping a portrait into a landscape frame (or vice versa) cuts
 * heads/feet off, and denoise 0.7 keeps that crop.
 */
export function isImg2ImgCompatible(prev: Img2ImgFrame, next: Img2ImgFrame): boolean {
  const orientation = (f: Img2ImgFrame) => Math.sign(f.width - f.height);
  return next.location !== null
    && prev.location === next.location
    && orientation(prev) === orientation(next);
}

export interface ImagePipelineContext {
  messageId: string;
  sessionId: string;
  campaignId: string;
  campaign: CampaignRow;
  characters: CharacterRow[];
  session: SessionRow;
  finalText: string;
  relevantNPCs: NpcMemoryRow[];
  llmConfig: ProviderConfig;
  /** Ollama base URL — only used for the VRAM handoff */
  baseUrl: string;
  targetCharacterId?: string | null;
  _regenerateImageId?: string;
  _customPositive?: string;
  _customNegative?: string;
  /** Called once the "generating" row and message metadata are written (normal path only). */
  onRecordCreated?: (imageId: string) => void;
}

export async function generateSceneImage(ctx: ImagePipelineContext): Promise<void> {
  await checkImageGenHealth();
  // Skip if image gen not enabled
  if (!ctx.campaign.imageEnabled) return;

  // For regeneration path, ComfyUI check happens after prompt writing
  // so the prompt is still saved even if ComfyUI is unavailable.
  // For regular path, check before creating the image record to avoid orphans.
  if (!ctx._regenerateImageId && !(await isComfyUIAvailable())) return;

  // Regeneration path — skip beat detector and record creation
  if (ctx._regenerateImageId) {
    const imageId = ctx._regenerateImageId;
    const startTime = Date.now();

    try {
      // Select character
      let char: CharacterRow | null = null;
      if (ctx.targetCharacterId) {
        char = ctx.characters.find((c) => c.id === ctx.targetCharacterId) ?? ctx.characters[0];
      } else {
        char = ctx.characters[0];
      }

      const regenAppearance = [composeAppearance(char?.appearance), composeDamageState(char?.statusNotes)].filter(Boolean).join(", ") || null;
      let promptResult;
      if (ctx._customPositive) {
        // Use custom prompt directly
        const style = getStyleConfig(resolveStyle(ctx.campaign), ctx.campaign.customImageConfig);
        const { getDimensionsForTrigger } = await import("./promptWriter");
        const dims = getDimensionsForTrigger("player_request", style.defaultDimensions);
        promptResult = {
          positive: ctx._customPositive,
          negative: ctx._customNegative ?? style.negativePrompt,
          width: dims.width,
          height: dims.height,
        };
      } else {
        // Re-run prompt writer
        const previousPrompt = await getLastImagePrompt(ctx.campaignId);
        const style = getStyleConfig(resolveStyle(ctx.campaign), ctx.campaign.customImageConfig);
        promptResult = await writeImagePrompt(
          {
            finalText: ctx.finalText,
            genre: ctx.campaign.genre,
            tone: ctx.campaign.tone,
            worldDescription: ctx.campaign.worldDescription,
            characterName: char?.name ?? "Adventurer",
            characterRole: char?.role ?? "hero",
            characterAppearance: regenAppearance,
            characterStatus: char?.statusNotes ?? null,
            sceneLocation: ctx.session.sceneState?.location ?? null,
            timeOfDay: ctx.session.sceneState?.timeOfDay ?? null,
            npcs: ctx.relevantNPCs.map((n) => ({ name: n.name, description: n.personality })),
            triggerType: "player_request",
            styleTags: style.tags,
            previousPrompt,
          },
          ctx.campaignId, "player_request", resolveStyle(ctx.campaign),
          ctx.campaign.customImageConfig ?? null, ctx.llmConfig
        );
      }

      // Update sceneImages with prompt data
      const contextSnapshot = {
        location: ctx.session.sceneState?.location ?? null,
        timeOfDay: ctx.session.sceneState?.timeOfDay ?? null,
        activeNPCs: ctx.session.sceneState?.activeNPCs?.map((n) => n.name) ?? [],
        situation: ctx.session.sceneState?.situation ?? null,
        characterName: char?.name ?? null,
        characterStatus: char?.statusNotes ?? null,
      };

      await db.update(sceneImages).set({
        sdPrompt: promptResult.positive,
        sdNegativePrompt: promptResult.negative,
        width: promptResult.width,
        height: promptResult.height,
        contextSnapshot,
      }).where(eq(sceneImages.id, imageId));

      // Check ComfyUI availability (after prompt is saved)
      if (!(await isComfyUIAvailable())) {
        await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, imageId));
        console.warn("[ImageGen] ComfyUI not available for regeneration", imageId.slice(0, 8));
        return;
      }

      // VRAM handoff
      const lease = await acquireForImageGen(ctx.baseUrl);
      if (!lease) {
        await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, imageId));
        return;
      }

      try {
        const style = getStyleConfig(resolveStyle(ctx.campaign), ctx.campaign.customImageConfig);
        const charName = char?.name ?? "Adventurer";
        const referenceImagePath = (hasIPAdapter() && !isMultiSubject(promptResult.positive))
          ? await getCharacterRef(ctx.campaignId, charName) : null;

        let lastProgress = 0;
        let lastPhase = "";
        const effectiveStyle = resolveStyle(ctx.campaign);
        // IP-Adapter negative compensation
        let regenNegative = promptResult.negative;
        if (referenceImagePath) {
          regenNegative += ", wrong character, different person, different face";
        }
        const { filePath, seed } = await generateImage(
          { ...promptResult, negative: regenNegative,
            checkpoint: style.checkpoint, lora: style.lora ?? undefined,
            referenceImagePath: referenceImagePath ?? undefined, ipaWeight: getAdaptiveIpaWeight(promptResult.shotScale ?? "medium-shot"),
            cfg: style.cfg, steps: style.steps,
            sampler: style.sampler, scheduler: style.scheduler,
            clipSkip: style.clipSkip,
            vae: style.vae,
            faceDetailer: hasFaceDetailer() && shouldUseFaceDetailer(style.faceDetailer, promptResult.shotScale ?? "medium-shot"),
            faceDetailerDenoise: getFaceDetailerDenoise(effectiveStyle),
            hiresFix: shouldUseHiresFix(effectiveStyle, promptResult.shotScale ?? "medium-shot") || undefined,
            },
          ctx.campaignId, imageId,
          (info) => {
            const phaseChanged = info.phase !== lastPhase;
            const progressJumped = info.percent - lastProgress >= 10;
            if (phaseChanged || progressJumped || info.percent === 100) {
              lastProgress = info.percent;
              lastPhase = info.phase;
              // Progress is cosmetic: a failed write must not fail (or crash, as an unhandled rejection) the render.
              try {
                db.update(sceneImages).set({ progress: info.percent, progressPhase: info.phase })
                  .where(eq(sceneImages.id, imageId)).run();
              } catch (e) {
                console.warn("[image] progress update failed:", e);
              }
            }
          }
        );

        await db.update(sceneImages).set({
          filePath, seed, status: "completed", generationTimeMs: Date.now() - startTime,
        }).where(eq(sceneImages.id, imageId));

      } finally {
        await lease.release();
      }
    } catch (err) {
      console.error("[ImageGen] regeneration failed for image", ctx._regenerateImageId, err);
      await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, ctx._regenerateImageId));
    }
    return;
  }

  // 4a. Every generation is an explicit player request (illustrate), so there is no
  // automatic beat detection: the trigger is always "player_request".
  const [{ count: msgCount }] = await db.select({ count: sql<number>`count(*)` })
    .from(messages).where(eq(messages.sessionId, ctx.sessionId));

  // img2img continuity (the useImg2Img branch below) is parked until
  // turn-triggered images return; images are player-triggered only, so this
  // is always "player_request" and that branch is currently unreachable.
  const triggerType: TriggerType = playerTrigger();
  const startTime = Date.now();

  // 4b. Create image record + update message metadata
  const imageId = crypto.randomUUID();
  await db.insert(sceneImages).values({
    id: imageId, messageId: ctx.messageId, campaignId: ctx.campaignId,
    sessionId: ctx.sessionId, triggerType, sdPrompt: "", sdNegativePrompt: "",
    status: "generating", width: 1024, height: 1024,
    characterId: ctx.targetCharacterId ?? null,
  });

  try {
    const [msg] = await db.select().from(messages).where(eq(messages.id, ctx.messageId));
    const existingMeta = msg?.metadata ?? {};
    await db.update(messages).set({ metadata: { ...existingMeta, imageId } }).where(eq(messages.id, ctx.messageId));
  } catch (err) {
    // Never leave a "generating" row nobody reports: the caller answers "unavailable" when the job throws before onRecordCreated.
    await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, imageId));
    throw err;
  }
  ctx.onRecordCreated?.(imageId);

  try {
    // 4c. Prompt Writer
    const previousPrompt = await getLastImagePrompt(ctx.campaignId);

    // Select target character
    let char: CharacterRow | null;
    if (ctx.targetCharacterId === null) {
      // Explicit "Scene (no focus)" — skip character
      char = null;
    } else if (ctx.targetCharacterId) {
      // Specific character requested
      char = ctx.characters.find((c) => c.id === ctx.targetCharacterId) ?? ctx.characters[0];
    } else {
      // Auto-select from narrative
      char = findAffectedCharacter(ctx.finalText, ctx.characters);
    }

    const style = getStyleConfig(resolveStyle(ctx.campaign), ctx.campaign.customImageConfig);
    // Same composition as the regeneration path: traits + visible damage state
    const characterAppearance = [composeAppearance(char?.appearance), composeDamageState(char?.statusNotes)].filter(Boolean).join(", ") || null;

    const promptResult = await writeImagePrompt(
      {
        finalText: ctx.finalText, genre: ctx.campaign.genre, tone: ctx.campaign.tone,
        worldDescription: ctx.campaign.worldDescription,
        characterName: char?.name ?? "Adventurer", characterRole: char?.role ?? "hero",
        characterAppearance,
        characterStatus: char?.statusNotes ?? null,
        sceneLocation: ctx.session.sceneState?.location ?? null,
        timeOfDay: ctx.session.sceneState?.timeOfDay ?? null,
        npcs: ctx.relevantNPCs.map((n) => ({ name: n.name, description: n.personality })),
        triggerType, styleTags: style.tags, previousPrompt,
      },
      ctx.campaignId, triggerType, resolveStyle(ctx.campaign),
      ctx.campaign.customImageConfig ?? null, ctx.llmConfig
    );

    const contextSnapshot = {
      location: ctx.session.sceneState?.location ?? null,
      timeOfDay: ctx.session.sceneState?.timeOfDay ?? null,
      activeNPCs: ctx.session.sceneState?.activeNPCs?.map((n) => n.name) ?? [],
      situation: ctx.session.sceneState?.situation ?? null,
      characterName: char?.name ?? null,
      characterStatus: char?.statusNotes ?? null,
    };

    await db.update(sceneImages).set({
      sdPrompt: promptResult.positive, sdNegativePrompt: promptResult.negative,
      width: promptResult.width, height: promptResult.height,
      contextSnapshot,
    }).where(eq(sceneImages.id, imageId));

    // 4d. VRAM Handoff
    console.log("[ImageGen]", imageId.slice(0, 8), "prompt done, starting VRAM handoff");
    await db.update(sceneImages).set({ progressPhase: "vram_handoff" }).where(eq(sceneImages.id, imageId));
    const lease = await acquireForImageGen(ctx.baseUrl);
    if (!lease) {
      console.warn("[ImageGen]", imageId.slice(0, 8), "VRAM handoff failed — could not free GPU");
      await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, imageId));
      return;
    }
    console.log("[ImageGen]", imageId.slice(0, 8), "VRAM acquired, dispatching to ComfyUI");

    try {
      // 4e. ComfyUI Dispatch — with IP-Adapter character consistency (if available)
      const charName = char?.name ?? null;
      const referenceImagePath = (charName && hasIPAdapter() && !isMultiSubject(promptResult.positive))
        ? await getCharacterRef(ctx.campaignId, charName) : null;

      // img2img continuity: use the previous scene image as init for visual coherence.
      // Only when the shot continues the same place — a new location would inherit the wrong
      // composition from the init image.
      const useImg2Img = triggerType !== "combat" && triggerType !== "player_request" && triggerType !== "scene_change";
      const lastImage = useImg2Img ? await getLastImage(ctx.sessionId) : null;
      const currentLocation = ctx.session.sceneState?.location ?? null;
      const lastImageAbsPath = (lastImage && isImg2ImgCompatible(
        lastImage,
        { location: currentLocation, width: promptResult.width, height: promptResult.height }
      )) ? lastImage.absPath : null;
      let initImageFilename: string | null = null;
      if (lastImageAbsPath) {
        // Stage the init image into ComfyUI's input directory
        const COMFYUI_INPUT = config.comfyuiInputDir;
        const { copyFile, mkdir: mkdirFs } = await import("fs/promises");
        const initName = `init_${ctx.sessionId.slice(0, 8)}_${Date.now().toString(36)}.png`;
        try {
          await mkdirFs(COMFYUI_INPUT, { recursive: true });
          await copyFile(lastImageAbsPath, join(COMFYUI_INPUT, initName));
          initImageFilename = initName;
        } catch {
          // Best effort — fall back to no img2img
        }
      }
      // Denoise 0.7 = keep the previous image's palette/lighting, free the composition for the new beat
      const initDenoise = initImageFilename ? 0.7 : undefined;

      let lastProgress = 0;
      let lastPhase = "";
      const activeStyle = resolveStyle(ctx.campaign);
      const triggerOverride = TRIGGER_SAMPLER_OVERRIDE[triggerType];
      const effectiveSampler = (triggerOverride && style.sampler !== "dpmpp_2m_sde")
        ? triggerOverride.sampler : style.sampler;
      const effectiveScheduler = (triggerOverride && style.sampler !== "dpmpp_2m_sde")
        ? triggerOverride.scheduler : style.scheduler;
      // Scene archetype detection for adaptive params
      const archetype = detectSceneArchetype(promptResult.positive);
      const archetypeParams = getArchetypeParams(archetype);
      const shotParams = getShotScaleParams(promptResult.shotScale ?? "medium-shot");
      const baseCfg = Math.min(style.cfg, promptResult.suggestedCfg ?? style.cfg);
      const cfgMod = Math.min(archetypeParams.cfgMod, shotParams.cfgMod);
      const stepsMod = Math.max(archetypeParams.stepsMod, shotParams.stepsMod);

      // Add IP-Adapter compensation to negative prompt when reference active
      let effectiveNegative = promptResult.negative;
      if (referenceImagePath) {
        effectiveNegative += ", wrong character, different person, different face";
      }

      const { filePath, seed } = await generateImage(
        { positive: promptResult.positive, negative: effectiveNegative,
          width: promptResult.width, height: promptResult.height,
          checkpoint: style.checkpoint, lora: style.lora ?? undefined,
          cfg: Math.max(3, baseCfg + cfgMod),
          steps: style.steps + stepsMod,
          sampler: effectiveSampler, scheduler: effectiveScheduler,
          referenceImagePath: referenceImagePath ?? undefined,
          ipaWeight: getAdaptiveIpaWeight(promptResult.shotScale ?? "medium-shot"),
          clipSkip: style.clipSkip,
          vae: style.vae,
          faceDetailer: hasFaceDetailer() && shouldUseFaceDetailer(style.faceDetailer, promptResult.shotScale),
          faceDetailerDenoise: getFaceDetailerDenoise(activeStyle),
          hiresFix: (() => {
            const ss = promptResult.shotScale ?? "medium-shot";
            if (ss === "extreme-wide" || ss === "wide-shot") return shouldUseHiresFix(activeStyle, ss) || undefined;
            return true;
          })(),
          hiresFixScale: 1.5,
          hiresFixDenoise: 0.35,
          initImagePath: initImageFilename ?? undefined,
          initDenoise,
          },
        ctx.campaignId, imageId,
        (info) => {
          const phaseChanged = info.phase !== lastPhase;
          const progressJumped = info.percent - lastProgress >= 10;
          if (phaseChanged || progressJumped || info.percent === 100) {
            lastProgress = info.percent;
            lastPhase = info.phase;
            // Progress is cosmetic: a failed write must not fail (or crash, as an unhandled rejection) the render.
            try {
              db.update(sceneImages).set({
                progress: info.percent,
                progressPhase: info.phase,
              }).where(eq(sceneImages.id, imageId)).run();
            } catch (e) {
              console.warn("[image] progress update failed:", e);
            }
          }
        }
      );

      // 4g. Update DB
      await db.update(sceneImages).set({
        filePath, seed, status: "completed", generationTimeMs: Date.now() - startTime,
        characterId: char?.id ?? ctx.targetCharacterId ?? null,
      }).where(eq(sceneImages.id, imageId));

      // NOTE: lastImageMessageCount is written but never read (kept for future beat spacing).
      await db.update(sessions).set({ lastImageMessageCount: msgCount }).where(eq(sessions.id, ctx.sessionId));

      // Update prompt cache for visual continuity
      updatePromptCache(ctx.campaignId, promptResult.positive);

      // Auto-save as character reference — only from a clean close single-subject shot
      if (charName && isGoodAutoReference(promptResult.positive, promptResult.shotScale)) {
        ensureCharacterRef(ctx.campaignId, charName, filePath.replace(/^rpg\//, "")).catch((err) => console.warn("[ImageGen] auto-reference failed", err));
      }

    } finally {
      // 4f. VRAM Restore
      await lease.release();
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const errMsg = `[${new Date().toISOString()}] Image ${imageId}\nName: ${e.name}\nMessage: ${e.message}\nStack: ${e.stack?.split("\n").slice(0, 8).join("\n") ?? ""}\n---\n`;
    console.error("[ImageGen] generation failed:", errMsg);
    try { await appendFile(join(config.outputDir, "error.log"), errMsg); } catch { /* logging the log failure would loop */ }
    await db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, imageId));
  }
}

/**
 * Get the last completed scene image in a session (absolute path + where/what it showed).
 * Used for img2img continuity — each new image uses the previous as init.
 */
async function getLastImage(sessionId: string): Promise<(Img2ImgFrame & { absPath: string }) | null> {
  const [row] = await db
    .select({ filePath: sceneImages.filePath, contextSnapshot: sceneImages.contextSnapshot, width: sceneImages.width, height: sceneImages.height })
    .from(sceneImages)
    .where(
      and(
        eq(sceneImages.sessionId, sessionId),
        eq(sceneImages.status, "completed")
      )
    )
    .orderBy(sql`created_at DESC`)
    .limit(1);
  if (!row?.filePath) return null;
  // filePath is like "rpg/campaignId/imageId.png" — resolve to absolute
  const { join } = await import("path");
  const abs = join(config.outputDir, row.filePath.replace(/^rpg\//, ""));
  // Verify file exists
  try {
    const { stat } = await import("fs/promises");
    await stat(abs);
    return { absPath: abs, location: row.contextSnapshot?.location ?? null, width: row.width, height: row.height };
  } catch {
    return null;
  }
}

let healthChecked = false;

export async function checkImageGenHealth(): Promise<void> {
  if (healthChecked) return;
  healthChecked = true;

  const enabledCampaigns = await db.select().from(campaigns).where(eq(campaigns.imageEnabled, true));
  if (enabledCampaigns.length > 0) {
    const available = await isComfyUIAvailable();
    if (!available) {
      console.warn("[Image Gen] ComfyUI not reachable — scene illustrations will be skipped");
    } else {
      // Probe installed nodes so we can skip unavailable features proactively
      const nodes = await probeAvailableNodes();
      const features = [
        hasFaceDetailer() ? "FaceDetailer" : null,
        hasIPAdapter() ? "IP-Adapter" : null,
      ].filter(Boolean);
      console.log(`[Image Gen] ComfyUI available. ${enabledCampaigns.length} campaign(s). Features: ${features.length > 0 ? features.join(", ") : "base only"} (${nodes.size} nodes)`);
    }
  }
}
