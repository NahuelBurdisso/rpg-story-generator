import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { npcMemory } from "../db/schema";

const MAX_MEMORY_LOG = 20;
const MIN_DISPOSITION = -100;
const MAX_DISPOSITION = 100;

const relationshipSchema = z.object({
  target: z.string(),
  disposition: z.number().min(MIN_DISPOSITION).max(MAX_DISPOSITION),
  lastInteraction: z.string(),
});

const memoryLogEntrySchema = z.object({
  sessionId: z.string(),
  summary: z.string(),
  emotionalShift: z.string(),
});

export const npcMemoryRouter = router({
  getByCampaign: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(npcMemory)
        .where(eq(npcMemory.campaignId, input.campaignId));
    }),

  upsert: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        name: z.string().min(1),
        personality: z.string(),
        location: z.string(),
        relationships: z.array(relationshipSchema).default([]),
        secrets: z.array(z.string()).default([]),
        revealedInfo: z.array(z.string()).default([]),
        memoryLog: z.array(memoryLogEntrySchema).default([]),
        deepHistory: z.string().optional(),
        currentState: z.string(),
        lastInteractedAt: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Clamp all relationship dispositions
      const relationships = input.relationships.map((r) => ({
        ...r,
        disposition: Math.max(
          MIN_DISPOSITION,
          Math.min(MAX_DISPOSITION, r.disposition)
        ),
      }));

      // Cap memory log at 20 entries (keep the most recent)
      const memoryLog = input.memoryLog.slice(-MAX_MEMORY_LOG);

      const values = {
        ...input,
        relationships,
        memoryLog,
        lastInteractedAt: input.lastInteractedAt ?? Date.now(),
      };

      // Case/whitespace-insensitive match, same key as uq_npc_memory_campaign_lname.
      const findExisting = () =>
        ctx.db
          .select()
          .from(npcMemory)
          .where(
            and(
              eq(npcMemory.campaignId, input.campaignId),
              sql`lower(trim(${npcMemory.name})) = lower(trim(${input.name}))`
            )
          )
          .then((rows) => rows[0]);

      const updateExisting = async (id: string) => {
        const [updated] = await ctx.db
          .update(npcMemory)
          .set(values)
          .where(eq(npcMemory.id, id))
          .returning();
        return updated;
      };

      const existing = await findExisting();
      if (existing) return updateExisting(existing.id);

      try {
        const [created] = await ctx.db
          .insert(npcMemory)
          .values(values)
          .returning();
        return created;
      } catch (err) {
        // A concurrent upsert inserted the same NPC between our select and insert
        // (uq_npc_memory_campaign_lname). Upsert semantics: fold into an update.
        if ((err as { code?: string }).code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
        const winner = await findExisting();
        if (!winner) throw err;
        return updateExisting(winner.id);
      }
    }),
});
