import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { campaigns } from "../db/schema";
import { TRPCError } from "@trpc/server";
import { GENRES, TONES, DIFFICULTIES, IMAGE_STYLES } from "@/lib/enums";
import type { CustomImageConfig } from "../db/jsonTypes";

const customImageConfigSchema: z.ZodType<CustomImageConfig> = z.object({
  checkpoint: z.string().optional(),
  lora: z.object({ name: z.string(), strength: z.number() }).optional(),
  negativePrompt: z.string().optional(),
  defaultDimensions: z.object({ width: z.number(), height: z.number() }).optional(),
});

export const campaignsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.lastPlayedAt));
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [campaign] = await ctx.db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.id));

      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      return campaign;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        genre: z.enum(GENRES),
        customGenre: z.string().optional(),
        tone: z.enum(TONES),
        difficulty: z.enum(DIFFICULTIES),
        worldDescription: z.string().default(""),
        customRules: z.string().optional(),
        campaignJournal: z.string().optional(),
        statDefinitions: z.array(z.string()).default([]),
        quickActions: z
          .array(z.object({ label: z.string(), prompt: z.string() }))
          .default([]),
        plotHooks: z.array(z.string()).optional(),
        imageEnabled: z.boolean().optional().default(false),
        imageStyle: z
          .enum(IMAGE_STYLES)
          .optional(),
        customImageConfig: customImageConfigSchema.optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(campaigns)
        .values({
          ...input,
          lastPlayedAt: Date.now(),
        })
        .returning();

      return created;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        genre: z
          .enum(GENRES)
          .optional(),
        customGenre: z.string().optional(),
        tone: z.enum(TONES).optional(),
        difficulty: z.enum(DIFFICULTIES).optional(),
        worldDescription: z.string().optional(),
        customRules: z.string().optional(),
        campaignJournal: z.string().optional(),
        statDefinitions: z.array(z.string()).optional(),
        quickActions: z
          .array(z.object({ label: z.string(), prompt: z.string() }))
          .optional(),
        plotHooks: z.array(z.string()).optional(),
        lastPlayedAt: z.number().optional(),
        imageEnabled: z.boolean().optional(),
        imageStyle: z
          .enum(IMAGE_STYLES)
          .optional(),
        customImageConfig: customImageConfigSchema.optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      const [updated] = await ctx.db
        .update(campaigns)
        .set(fields)
        .where(eq(campaigns.id, id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(campaigns)
        .where(eq(campaigns.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      return { success: true };
    }),
});
