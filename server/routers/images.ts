import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { sceneImages, messages, sessions, characters, campaigns, userSettings } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { isImageGenActive } from "../image/vramManager";
import { buildImageContext } from "../image/buildImageContext";
import { generateSceneImage } from "../image/imageOrchestrator";
import { saveCharacterRef, getCharacterRef } from "../image/referenceManager";
import { generateCharacterPortrait, portraitStatus } from "../image/portraitGenerator";
import { isComfyUIAvailable } from "../image/comfyuiClient";
import { buildLocalConfig } from "../llm/config";
import { resolveImageStyle } from "../image/stylePresets";
import { failStaleImageJobs } from "../image/recovery";
import { sanitizeName, imageKind } from "../image/paths";
import { waitForBackground, turnStateKey } from "../pipeline/backgroundQueue";
import { SETTINGS_ID } from "../config";

export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/**
 * Sessions whose illustrate/regenerate is between "accepted" and "generating row exists".
 * The step-3 wait below widens that window, so a double click must not start two jobs.
 * On globalThis so Next dev HMR keeps it.
 */
const gs = globalThis as typeof globalThis & { __rpgIllustrateStarting?: Set<string> };
const illustrateStarting = (gs.__rpgIllustrateStarting ??= new Set<string>());

export const imagesRouter = router({
  illustrate: publicProcedure
    .input(z.object({ sessionId: z.string(), characterId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (illustrateStarting.has(input.sessionId)) {
        return { status: "already_generating" as const };
      }
      illustrateStarting.add(input.sessionId);
      let job: Promise<void> | undefined;
      try {
        failStaleImageJobs(ctx.db);
        if (isImageGenActive()) {
          return { status: "already_generating" as const };
        }

        const [pending] = await ctx.db.select().from(sceneImages)
          .where(and(eq(sceneImages.sessionId, input.sessionId), eq(sceneImages.status, "generating")));
        if (pending) {
          return { status: "already_generating" as const, imageId: pending.id };
        }

        // Let the last turn's extractors finish: the prompt must see the fresh sceneState,
        // and their Ollama calls must not hold the GPU while the render starts.
        await waitForBackground(turnStateKey(input.sessionId));

        const context = await buildImageContext(input.sessionId);
        if (!context) {
          return { status: "no_content" as const };
        }

        let createdId: string | undefined;
        let markCreated!: () => void;
        const created = new Promise<void>((resolve) => { markCreated = resolve; });
        job = generateSceneImage({
          messageId: context.messageId,
          sessionId: input.sessionId,
          campaignId: context.campaign.id,
          campaign: { ...context.campaign, imageEnabled: true },
          characters: context.chars,
          session: context.session,
          finalText: context.finalText,
          relevantNPCs: context.relevantNPCs,
          llmConfig: context.llmConfig,
          baseUrl: context.baseUrl,
          targetCharacterId: input.characterId,
          onRecordCreated: (id) => { createdId = id; markCreated(); },
        });
        job.catch((err) => console.error("[ImageGen] job crashed", err));

        // Answer once the row exists (or the job gave up before creating one): the client then shows progress right away.
        await Promise.race([created, job.then(() => undefined, () => undefined)]);
        return createdId
          ? { status: "started" as const, imageId: createdId }
          : { status: "unavailable" as const };
      } finally {
        // generateSceneImage inserts its "generating" row asynchronously, so hold the guard
        // until it settles (the row-based check covers the rest of the render).
        if (job) void job.catch(() => {}).finally(() => illustrateStarting.delete(input.sessionId));
        else illustrateStarting.delete(input.sessionId);
      }
    }),

  regenerate: publicProcedure
    .input(z.object({
      imageId: z.string(),
      customPositive: z.string().optional(),
      customNegative: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      failStaleImageJobs(ctx.db);
      if (isImageGenActive()) {
        return { status: "already_generating" as const };
      }

      // Load original record
      const [original] = await ctx.db.select().from(sceneImages).where(eq(sceneImages.id, input.imageId));
      if (!original) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Image not found: ${input.imageId}` });
      }

      if (illustrateStarting.has(original.sessionId)) {
        return { status: "already_generating" as const };
      }
      illustrateStarting.add(original.sessionId);
      try {
        // Same reason as illustrate: fresh sceneState, and no step-3 Ollama calls during the render.
        await waitForBackground(turnStateKey(original.sessionId));

        // Perform replace atomically: create new record, mark old as replaced, update message
        const newImageId = crypto.randomUUID();
        try {
          await ctx.db.insert(sceneImages).values({
            id: newImageId,
            messageId: original.messageId,
            campaignId: original.campaignId,
            sessionId: original.sessionId,
            triggerType: original.triggerType,
            characterId: original.characterId ?? null,
            sdPrompt: "",
            sdNegativePrompt: "",
            status: "generating",
            width: original.width,
            height: original.height,
          });

          await ctx.db.update(sceneImages).set({ status: "replaced" }).where(eq(sceneImages.id, input.imageId));

          const [msg] = await ctx.db.select().from(messages).where(eq(messages.id, original.messageId));
          if (msg) {
            const existingMeta = msg.metadata ?? {};
            await ctx.db.update(messages).set({ metadata: { ...existingMeta, imageId: newImageId } })
              .where(eq(messages.id, original.messageId));
          }
        } catch (_err) {
          // Rollback: clean up the new record if it was created
          await ctx.db.delete(sceneImages).where(eq(sceneImages.id, newImageId)).catch((err) => console.error("[ImageGen] regenerate rollback failed", err));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to regenerate image" });
        }

        // Build context and fire-and-forget
        const context = await buildImageContext(original.sessionId);
        if (!context) {
          await ctx.db.update(sceneImages).set({ status: "failed" }).where(eq(sceneImages.id, newImageId));
          return { status: "started" as const, newImageId };
        }

        generateSceneImage({
          messageId: original.messageId,
          sessionId: original.sessionId,
          campaignId: original.campaignId,
          campaign: { ...context.campaign, imageEnabled: true },
          characters: context.chars,
          session: context.session,
          finalText: context.finalText,
          relevantNPCs: context.relevantNPCs,
          llmConfig: context.llmConfig,
          baseUrl: context.baseUrl,
          _regenerateImageId: newImageId,
          _customPositive: input.customPositive,
          _customNegative: input.customNegative,
          targetCharacterId: original.characterId ?? undefined,
        }).catch((err) => console.error("[ImageGen] job crashed", err));

        return { status: "started" as const, newImageId };
      } finally {
        illustrateStarting.delete(original.sessionId);
      }
    }),

  status: publicProcedure
    .input(z.object({ imageId: z.string() }))
    .query(async ({ ctx, input }) => {
      failStaleImageJobs(ctx.db);
      const [image] = await ctx.db.select().from(sceneImages).where(eq(sceneImages.id, input.imageId));
      return image ?? null;
    }),

  listBySessionWithContext: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: sceneImages.id,
          messageId: sceneImages.messageId,
          sessionId: sceneImages.sessionId,
          campaignId: sceneImages.campaignId,
          triggerType: sceneImages.triggerType,
          sdPrompt: sceneImages.sdPrompt,
          sdNegativePrompt: sceneImages.sdNegativePrompt,
          filePath: sceneImages.filePath,
          width: sceneImages.width,
          height: sceneImages.height,
          contextSnapshot: sceneImages.contextSnapshot,
          characterId: sceneImages.characterId,
          generationTimeMs: sceneImages.generationTimeMs,
          createdAt: sceneImages.createdAt,
          narrativeText: messages.content,
          messageCreatedAt: messages.createdAt,
        })
        .from(sceneImages)
        .innerJoin(messages, eq(sceneImages.messageId, messages.id))
        .where(
          and(
            eq(sceneImages.sessionId, input.sessionId),
            eq(sceneImages.status, "completed")
          )
        )
        .orderBy(desc(sceneImages.createdAt));

      return rows;
    }),

  listByCampaignGrouped: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: sceneImages.id,
          messageId: sceneImages.messageId,
          sessionId: sceneImages.sessionId,
          campaignId: sceneImages.campaignId,
          triggerType: sceneImages.triggerType,
          sdPrompt: sceneImages.sdPrompt,
          sdNegativePrompt: sceneImages.sdNegativePrompt,
          filePath: sceneImages.filePath,
          width: sceneImages.width,
          height: sceneImages.height,
          contextSnapshot: sceneImages.contextSnapshot,
          characterId: sceneImages.characterId,
          generationTimeMs: sceneImages.generationTimeMs,
          createdAt: sceneImages.createdAt,
          narrativeText: messages.content,
          messageCreatedAt: messages.createdAt,
          sessionTitle: sessions.title,
        })
        .from(sceneImages)
        .innerJoin(messages, eq(sceneImages.messageId, messages.id))
        .innerJoin(sessions, eq(sceneImages.sessionId, sessions.id))
        .where(
          and(
            eq(sceneImages.campaignId, input.campaignId),
            eq(sceneImages.status, "completed")
          )
        )
        .orderBy(desc(sceneImages.createdAt))
        .limit(100);

      return rows;
    }),

  uploadReference: publicProcedure
    .input(z.object({
      campaignId: z.string(),
      characterName: z.string().min(1).max(100),
      imageBase64: z.string().max(Math.ceil(MAX_REFERENCE_BYTES * 4 / 3) + 4),
    }))
    .mutation(async ({ ctx, input }) => {
      const [campaign] = await ctx.db.select({ id: campaigns.id }).from(campaigns)
        .where(eq(campaigns.id, input.campaignId));
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      const imageData = Buffer.from(input.imageBase64, "base64");
      if (imageData.length > MAX_REFERENCE_BYTES || imageKind(imageData) === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reference must be a PNG or JPEG up to 10 MB" });
      }
      await saveCharacterRef(input.campaignId, input.characterName, imageData);
      return { status: "saved" as const };
    }),

  getReference: publicProcedure
    .input(z.object({
      campaignId: z.string(),
      characterName: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [campaign] = await ctx.db.select({ id: campaigns.id }).from(campaigns)
        .where(eq(campaigns.id, input.campaignId));
      if (!campaign) {
        return { exists: false, url: null };
      }
      const filePath = await getCharacterRef(input.campaignId, input.characterName);
      if (!filePath) {
        return { exists: false, url: null };
      }
      const sanitized = sanitizeName(input.characterName);
      const url = `/api/images/rpg/${input.campaignId}/refs/${sanitized}.png?v=${Date.now()}`;
      return { exists: true, url };
    }),

  generatePortrait: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Load character
      const [character] = await ctx.db.select().from(characters)
        .where(eq(characters.id, input.characterId));
      if (!character) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Personaje no encontrado" });
      }

      // Load campaign
      const [campaign] = await ctx.db.select().from(campaigns)
        .where(eq(campaigns.id, character.campaignId));
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campa\u00f1a no encontrada" });
      }

      // Check ComfyUI availability
      if (!(await isComfyUIAvailable())) {
        return { status: "unavailable" as const };
      }

      // Check if already generating
      const existing = portraitStatus.get(input.characterId);
      if (existing?.status === "generating") {
        return { status: "already_generating" as const };
      }

      // Load user settings for Ollama config
      const [settings] = await ctx.db.select().from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID));
      const local = buildLocalConfig(settings);

      // Initialize status tracking
      const portraitId = crypto.randomUUID();
      portraitStatus.set(input.characterId, {
        status: "generating",
        progress: 0,
        phase: "preparing",
      });

      // Fire-and-forget portrait generation
      generateCharacterPortrait({
        campaignId: character.campaignId,
        characterId: input.characterId,
        characterName: character.name,
        appearance: character.appearance ?? null,
        imageStyle: resolveImageStyle(campaign),
        customImageConfig: campaign.customImageConfig ?? null,
        ollamaBaseUrl: local.ollamaBaseUrl!,
        onProgress: (phase, progress) => {
          portraitStatus.set(input.characterId, {
            status: "generating",
            progress,
            phase,
          });
        },
      }).then(async (result) => {
        if (result) {
          // Update character's portraitUrl in the DB
          const servingUrl = `/api/images/${result.filePath}`;
          await ctx.db.update(characters)
            .set({ portraitUrl: servingUrl })
            .where(eq(characters.id, input.characterId));

          portraitStatus.set(input.characterId, {
            status: "completed",
            progress: 100,
            phase: "done",
            filePath: servingUrl,
            seed: result.seed,
          });
        } else {
          portraitStatus.set(input.characterId, {
            status: "failed",
            progress: 0,
            phase: "error",
            error: "La generaci\u00f3n del retrato fall\u00f3",
          });
        }
      }).catch((err) => {
        console.error("[PortraitGen] failed for character", input.characterId, err);
        portraitStatus.set(input.characterId, {
          status: "failed",
          progress: 0,
          phase: "error",
          error: err instanceof Error ? err.message : "Error desconocido",
        });
      });

      return { status: "started" as const, portraitId };
    }),

  portraitStatus: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(({ input }) => {
      return portraitStatus.get(input.characterId) ?? null;
    }),
});
