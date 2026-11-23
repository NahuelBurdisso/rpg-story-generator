import { waitForGpu } from "./gpuGate";
import { config as appConfig } from "../config";
import { linkSignal, readStream } from "./streamLoop";
import type { LLMMessage, LLMOptions } from "./providers";

// ---------------------------------------------------------------------------
// Ollama request semaphore — serializes background calls, streaming bypasses
// ---------------------------------------------------------------------------
//
// Only background calls wait. Streaming calls bypass the semaphore entirely so
// the user-facing narrator is never blocked by fire-and-forget extractors.

type QueueEntry = { resolve: () => void };
let activeBackgroundRequest = false;
const backgroundQueue: QueueEntry[] = [];

function acquireOllamaSemaphore(priority: "streaming" | "background"): Promise<void> {
  // Streaming always proceeds immediately
  if (priority === "streaming") return Promise.resolve();

  if (!activeBackgroundRequest) {
    activeBackgroundRequest = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    backgroundQueue.push({ resolve });
  });
}

function releaseOllamaSemaphore(priority: "streaming" | "background"): void {
  // Streaming calls don't hold the lock, so nothing to release
  if (priority === "streaming") return;

  if (backgroundQueue.length > 0) {
    const next = backgroundQueue.shift()!;
    next.resolve();
  } else {
    activeBackgroundRequest = false;
  }
}

// ---------------------------------------------------------------------------
// Ollama provider
// ---------------------------------------------------------------------------

/**
 * Narrator model when the user hasn't picked one. Any instruction-following
 * Ollama model works; it must follow the extractor JSON and dice-marker
 * instructions reliably. Override it in-app under Settings -> Model.
 */
export const DEFAULT_OLLAMA_MODEL = "gemma3:12b";

/** NDJSON line → text delta (`message.content`). Throws on malformed JSON. */
function parseOllamaLine(line: string): string | null {
  if (!line.trim()) return null;
  return JSON.parse(line).message?.content || null;
}

export async function callOllama(
  baseUrl: string,
  model: string,
  messages: LLMMessage[],
  onChunk: (text: string) => Promise<void>,
  options?: LLMOptions,
  priority: "streaming" | "background" = "background",
  signal?: AbortSignal
): Promise<string> {
  // An image render holds the GPU; loading the model now would evict it or OOM.
  await waitForGpu(undefined, signal);
  await acquireOllamaSemaphore(priority);

  const isStreaming = priority === "streaming";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), isStreaming ? 180_000 : 90_000);
  const unlink = linkSignal(signal, controller);

  let fullResponse: string;

  try {
    // If the abort arrived while waiting for the semaphore, the controller is already
    // aborted (linkSignal) and fetch below rejects at once.
    const ollamaOptions: Record<string, unknown> = {
      num_ctx: appConfig.ollamaNumCtx,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens !== undefined && { num_predict: options.maxTokens }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.topK !== undefined && { top_k: options.topK }),
    };
    // Only apply repetition penalty for streaming (narrator) — background calls are short/structured
    if (isStreaming) {
      ollamaOptions.repeat_last_n = options?.repeatLastN ?? 256;
      if (options?.repeatPenalty !== undefined) ollamaOptions.repeat_penalty = options.repeatPenalty;
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: isStreaming,
        think: false,
        options: ollamaOptions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw Object.assign(new Error(`Model not found: ${model}`), {
          errorType: "model_not_found",
        });
      }
      throw Object.assign(
        new Error(`Ollama error: ${response.status} ${response.statusText}`),
        { errorType: "connection_failed" }
      );
    }

    if (!response.body) {
      throw Object.assign(new Error("No response body from Ollama"), {
        errorType: "connection_failed",
      });
    }

    // Non-streaming path: single JSON response, no chunk parsing
    if (!isStreaming) {
      const body = await response.json();
      fullResponse = body.message?.content ?? "";
    } else {
      fullResponse = await readStream(response.body, parseOllamaLine, onChunk);
    }
  } finally {
    clearTimeout(timeoutId);
    unlink();
    releaseOllamaSemaphore(priority);
  }

  // Strip <think>...</think> tags
  fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  return fullResponse;
}
