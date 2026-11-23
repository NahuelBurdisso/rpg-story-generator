import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { userSettings } from "../db/schema";
import type { DB } from "../db";
import { TRPCError } from "@trpc/server";
import { config, SETTINGS_ID } from "../config";
import { LLM_PROVIDERS } from "@/lib/enums";

/** A function, not a constant: config is read when called, never at import. */
const defaultSettings = () => ({
  id: SETTINGS_ID,
  provider: "ollama" as const,
  ollamaBaseUrl: config.ollamaUrl,
  openaiApiKey: null,
  anthropicApiKey: null,
  selectedModel: null,
  maxContextMessages: 20,
});

async function getOrCreateSettings(ctx: { db: DB }) {
  const [existing] = await ctx.db
    .select()
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID));

  if (existing) return existing;

  const [created] = await ctx.db
    .insert(userSettings)
    .values(defaultSettings())
    .returning();

  return created;
}

export const userSettingsRouter = router({
  get: publicProcedure.query(async ({ ctx }) => {
    const settings = await getOrCreateSettings(ctx);

    // Strip API keys from public response
    const { openaiApiKey, anthropicApiKey, ...safe } = settings;

    return {
      ...safe,
      hasOpenaiKey: !!openaiApiKey,
      hasAnthropicKey: !!anthropicApiKey,
    };
  }),


  listModels: publicProcedure
    .input(
      z.object({
        provider: z.enum(LLM_PROVIDERS).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const settings = await getOrCreateSettings(ctx);
      const provider = input.provider ?? settings.provider;

      if (provider === "ollama") {
        const baseUrl = settings.ollamaBaseUrl ?? config.ollamaUrl;

        try {
          const response = await fetch(`${baseUrl}/api/tags`);

          if (!response.ok) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Ollama returned ${response.status}`,
            });
          }

          const data = (await response.json()) as { models?: { name: string }[] };
          const models: string[] = (data.models ?? []).map((m) => m.name);

          return { provider: "ollama" as const, models };
        } catch (err) {
          if (err instanceof TRPCError) throw err;

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not reach Ollama. Make sure it is running.",
          });
        }
      }

      if (provider === "openai") {
        return {
          provider: "openai" as const,
          models: [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            "gpt-4",
            "gpt-3.5-turbo",
          ],
        };
      }

      if (provider === "anthropic") {
        return {
          provider: "anthropic" as const,
          models: [
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
          ],
        };
      }

      return { provider, models: [] };
    }),

  update: publicProcedure
    .input(
      z.object({
        provider: z.enum(LLM_PROVIDERS).optional(),
        ollamaBaseUrl: z.string().url().optional(),
        openaiApiKey: z.string().optional(),
        anthropicApiKey: z.string().optional(),
        selectedModel: z.string().optional(),
        maxContextMessages: z.number().int().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure the singleton exists before updating
      await getOrCreateSettings(ctx);

      const [updated] = await ctx.db
        .update(userSettings)
        .set(input)
        .where(eq(userSettings.id, SETTINGS_ID))
        .returning();

      // Strip API keys from response
      const { openaiApiKey, anthropicApiKey, ...safe } = updated;

      return {
        ...safe,
        hasOpenaiKey: !!openaiApiKey,
        hasAnthropicKey: !!anthropicApiKey,
      };
    }),
});
