import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { characters } from "../db/schema";
import { TRPCError } from "@trpc/server";

export const charactersRouter = router({
  listByCampaign: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(characters)
        .where(eq(characters.campaignId, input.campaignId));
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [character] = await ctx.db
        .select()
        .from(characters)
        .where(eq(characters.id, input.id));

      if (!character) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      }

      return character;
    }),

  create: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        name: z.string().min(1),
        role: z.string().min(1),
        backstory: z.string(),
        stats: z.record(z.string(), z.number()),
        inventory: z.array(z.string()),
        appearance: z.object({
          gender: z.string().optional(),
          build: z.string().optional(),
          height: z.string().optional(),
          age: z.string().optional(),
          skinTone: z.string().optional(),
          hairColor: z.string().optional(),
          hairStyle: z.string().optional(),
          eyeColor: z.string().optional(),
          eyeFeature: z.string().optional(),
          clothing: z.string().optional(),
          features: z.string().optional(),
        }).optional().nullable(),
        statusNotes: z.string().optional(),
        portraitUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(characters)
        .values(input)
        .returning();

      return created;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        backstory: z.string().optional(),
        stats: z.record(z.string(), z.number()).optional(),
        inventory: z.array(z.string()).optional(),
        appearance: z.object({
          gender: z.string().optional(),
          build: z.string().optional(),
          height: z.string().optional(),
          age: z.string().optional(),
          skinTone: z.string().optional(),
          hairColor: z.string().optional(),
          hairStyle: z.string().optional(),
          eyeColor: z.string().optional(),
          eyeFeature: z.string().optional(),
          clothing: z.string().optional(),
          features: z.string().optional(),
        }).optional().nullable(),
        statusNotes: z.string().optional(),
        portraitUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      const [updated] = await ctx.db
        .update(characters)
        .set(fields)
        .where(eq(characters.id, id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      }

      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(characters)
        .where(eq(characters.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      }

      return { success: true };
    }),
});
