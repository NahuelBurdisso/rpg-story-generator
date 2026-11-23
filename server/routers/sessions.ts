import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { sessions } from "../db/schema";
import { TRPCError } from "@trpc/server";
import { endSession as endSessionService, SessionNotFoundError } from "../pipeline/sessionEnd";
import { tryAcquireSessionLock, releaseSessionLock, startLockKeepAlive } from "../pipeline/sessionLock";
import { SESSION_STATUSES } from "@/lib/enums";

export const sessionsRouter = router({
  listByCampaign: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.campaignId, input.campaignId))
        .orderBy(desc(sessions.startedAt));
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id));

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return session;
    }),

  create: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        title: z.string().min(1),
        summary: z.string().optional(),
        contextSummary: z.string().optional(),
        status: z.enum(SESSION_STATUSES).default("active"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(sessions)
        .values(input)
        .returning();

      return created;
    }),

  endSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Take the same lock a turn holds, so we can't close the session under an
      // in-flight turn (whose step 3 isn't queued yet) and can't be raced by a new one.
      if (!tryAcquireSessionLock(ctx.db, input.sessionId)) {
        const exists = ctx.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, input.sessionId)).get();
        throw exists
          ? new TRPCError({
              code: "CONFLICT",
              message: "A turn is still in progress — wait for it to finish before ending the session.",
            })
          : new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }
      // The summary call can outlast the stale window; keep the stamp fresh.
      const stopKeepAlive = startLockKeepAlive(ctx.db, input.sessionId);
      try {
        return await endSessionService(ctx.db, input.sessionId);
      } catch (err) {
        if (err instanceof SessionNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      } finally {
        stopKeepAlive();
        releaseSessionLock(ctx.db, input.sessionId);
      }
    }),
});
