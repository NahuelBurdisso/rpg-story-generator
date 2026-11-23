import type { UserSettingsRow } from "../db/schema";
import { DEFAULT_OLLAMA_MODEL, type ProviderConfig } from "./providers";
import { config } from "../config";

/** Resolved lazily: a bad OLLAMA_URL must not throw at import time. */
export function defaultOllamaUrl(): string {
  return config.ollamaUrl;
}
/** Smaller local model tried when the user's Ollama model fails. */
export const FALLBACK_OLLAMA_MODEL = "mistral:7b-instruct";

/** The user's chosen provider/model, from the settings row. */
export function buildProviderConfig(settings: UserSettingsRow | undefined): ProviderConfig {
  const provider = settings?.provider ?? "ollama";
  return {
    provider,
    model: settings?.selectedModel ?? DEFAULT_OLLAMA_MODEL,
    ollamaBaseUrl: settings?.ollamaBaseUrl ?? defaultOllamaUrl(),
    apiKey: provider === "openai"
      ? settings?.openaiApiKey ?? undefined
      : provider === "anthropic"
        ? settings?.anthropicApiKey ?? undefined
        : undefined,
  };
}

/**
 * Fallback narrator for Ollama users. Null for cloud providers: a cloud user
 * may not run Ollama at all, so a silent switch to a local model would fail
 * (or worse, quietly change the narrator) — retry the same provider instead.
 */
export function buildFallbackConfig(settings: UserSettingsRow | undefined): ProviderConfig | null {
  const primary = buildProviderConfig(settings);
  if (primary.provider !== "ollama") return null;
  return { provider: "ollama", model: FALLBACK_OLLAMA_MODEL, ollamaBaseUrl: primary.ollamaBaseUrl };
}

/** Local Ollama config for GPU-side work: the user's model if they use Ollama, else the default. */
export function buildLocalConfig(settings: UserSettingsRow | undefined): ProviderConfig {
  const primary = buildProviderConfig(settings);
  return {
    provider: "ollama",
    model: primary.provider === "ollama" ? primary.model : DEFAULT_OLLAMA_MODEL,
    ollamaBaseUrl: primary.ollamaBaseUrl,
  };
}
