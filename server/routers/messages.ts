import { z } from "zod";
import { eq, desc, lt, and, or } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { messages } from "../db/schema";

/** The oldest message already shown: the next page holds the messages strictly before it in (createdAt, id) order. */
const cursorSchema = z.object({ createdAt: z.number(), id: z.string() });

export const messagesRouter = router({
  listBySession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().min(1).max(100).default(30),
        cursor: cursorSchema.nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { sessionId, limit, cursor } = input;

      const conditions = [eq(messages.sessionId, sessionId)];
      if (cursor) {
        // Keyset on (createdAt, id): a page boundary inside one millisecond neither skips nor repeats a row.
        conditions.push(
          or(
            lt(messages.createdAt, cursor.createdAt),
            and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id))
          )!
        );
      }

      const items = await ctx.db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1); // one extra to detect an older page

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const oldest = page[page.length - 1];

      return {
        messages: page.reverse(), // chronological order
        nextCursor: hasMore ? { createdAt: oldest.createdAt, id: oldest.id } : undefined,
      };
    }),
});
