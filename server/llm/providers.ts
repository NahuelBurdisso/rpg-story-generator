import { config as appConfig } from "../config";
import type { LLMProvider } from "@/lib/enums";
import { callOllama, DEFAULT_OLLAMA_MODEL } from "./ollama";
import { callOpenAI } from "./openai";
import { callAnthropic } from "./anthropic";

export { DEFAULT_OLLAMA_MODEL };

export interface LLMMessage {
  role: string;
  content: string;
}

export interface ClassifiedError {
  errorType: string;
  errorMessage: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
}

export type { LLMProvider };

/** The caller's AbortSignal fired (e.g. the client disconnected). Never retried. */
export class LLMAbortedError extends Error {
  readonly errorType = "aborted";
  constructor() {
    super("LLM request aborted by caller");
    this.name = "LLMAbortedError";
  }
}

// ---------------------------------------------------------------------------
// Unified provider dispatcher
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  provider: LLMProvider;
  model: string;
  // Ollama
  ollamaBaseUrl?: string;
  // OpenAI / Anthropic
  apiKey?: string;
}

/**
 * Unified LLM call dispatcher. Routes to the correct provider based on config.
 * Supports retry-with-delay before falling back to a fallback model (Ollama only).
 */
export async function callLLM(
  config: ProviderConfig,
  messages: LLMMessage[],
  onChunk: (text: string) => Promise<void>,
  options?: LLMOptions,
  opts?: { priority?: "streaming" | "background"; retries?: number; retryDelayMs?: number; signal?: AbortSignal }
): Promise<string> {
  const { provider, model, ollamaBaseUrl, apiKey } = config;
  const priority = opts?.priority ?? "background";
  const retries = opts?.retries ?? 1;
  const retryDelayMs = opts?.retryDelayMs ?? 1500;
  const signal = opts?.signal;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }

    if (signal?.aborted) throw new LLMAbortedError();

    try {
      switch (provider) {
        case "ollama":
          return await callOllama(
            ollamaBaseUrl ?? appConfig.ollamaUrl,
            model,
            messages,
            onChunk,
            options,
            priority,
            signal
          );

        case "openai":
          if (!apiKey) throw Object.assign(new Error("Missing OpenAI API key"), { errorType: "auth_failed" });
          return await callOpenAI(apiKey, model, messages, onChunk, options, signal);

        case "anthropic": {
          if (!apiKey) throw Object.assign(new Error("Missing Anthropic API key"), { errorType: "auth_failed" });
          // Extract system prompt from messages for Anthropic
          const systemMsg = messages.find((m) => m.role === "system");
          const systemPrompt = systemMsg?.content ?? "";
          return await callAnthropic(apiKey, model, messages, systemPrompt, onChunk, options, signal);
        }

        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (err) {
      if (signal?.aborted) throw new LLMAbortedError();
      lastError = err;
      // Don't retry on non-transient errors
      const typed = err as Error & { errorType?: string };
      if (typed.errorType && ["auth_failed", "model_not_found", "context_too_long"].includes(typed.errorType)) {
        throw err;
      }
      // Last attempt — throw
      if (attempt === retries) throw err;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Post-processing: gibberish detection
// ---------------------------------------------------------------------------

/**
 * Detect gibberish tokens and truncate at last clean sentence.
 * Catches patterns like "mereget orget", "thjis", broken token fragments.
 */
export function cleanGibberish(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const cleaned: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const words = trimmed.replace(/[>*_#`~[\\]()]/g, "").split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) {
      cleaned.push(trimmed);
      continue;
    }

    let garbageCount = 0;
    for (const word of words) {
      const w = word.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length < 3) continue;
      if (/[^aeiou]{4,}/.test(w) && w.length < 8) {
        garbageCount++;
      }
      if (/(.)\1{2,}/.test(w)) {
        garbageCount++;
      }
    }

    const garbageRatio = garbageCount / words.length;
    if (garbageRatio > 0.3 && words.length > 4) {
      break;
    }

    cleaned.push(trimmed);
  }

  return cleaned.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token count estimate (~4 chars/token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyError(
  error: unknown,
  _provider: string
): ClassifiedError {
  if (error instanceof Error) {
    if (error instanceof LLMAbortedError) return { errorType: "aborted", errorMessage: error.message };

    const typedError = error as Error & {
      errorType?: string;
      errorMessage?: string;
    };

    if (typedError.errorType) {
      return {
        errorType: typedError.errorType,
        errorMessage: typedError.errorMessage ?? typedError.message,
      };
    }

    const message = error.message.toLowerCase();

    if (
      error.name === "AbortError" ||
      message.includes("abort") ||
      message.includes("timeout")
    ) {
      return { errorType: "timeout", errorMessage: error.message };
    }

    if (
      message.includes("failed to fetch") ||
      message.includes("fetch failed") || // undici (Node fetch)
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("etimedout")
    ) {
      return { errorType: "connection_failed", errorMessage: error.message };
    }

    if (
      message.includes("unauthorized") ||
      message.includes("api key") ||
      message.includes("auth")
    ) {
      return { errorType: "auth_failed", errorMessage: error.message };
    }

    if (
      message.includes("rate limit") ||
      message.includes("too many requests")
    ) {
      return { errorType: "rate_limited", errorMessage: error.message };
    }

    if (message.includes("model") && message.includes("not found")) {
      return { errorType: "model_not_found", errorMessage: error.message };
    }

    if (
      message.includes("context") ||
      message.includes("token") ||
      message.includes("too long")
    ) {
      return { errorType: "context_too_long", errorMessage: error.message };
    }

    return { errorType: "unknown", errorMessage: error.message };
  }

  return { errorType: "unknown", errorMessage: String(error) };
}
