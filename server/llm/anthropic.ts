import { linkSignal, readStream } from "./streamLoop";
import type { LLMMessage, LLMOptions } from "./providers";

/** SSE `data:` line -> text delta (`content_block_delta` / `text_delta`). Throws on malformed JSON. */
function parseAnthropicLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) return null;
  const parsed = JSON.parse(trimmed.slice(6));
  if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
    return parsed.delta.text || null;
  }
  return null;
}

export async function callAnthropic(
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  systemPrompt: string,
  onChunk: (text: string) => Promise<void>,
  options?: LLMOptions,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  const unlink = linkSignal(signal, controller);

  const anthropicMessages = messages.filter((m) => m.role !== "system");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: anthropicMessages,
        stream: true,
        max_tokens: options?.maxTokens ?? 4096,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.topP !== undefined && { top_p: options.topP }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Invalid or missing Anthropic API key"), {
          errorType: "auth_failed",
          errorMessage: errorBody,
        });
      }
      if (response.status === 404) {
        throw Object.assign(new Error(`Model not found: ${model}`), {
          errorType: "model_not_found",
          errorMessage: errorBody,
        });
      }
      if (response.status === 429) {
        throw Object.assign(new Error("Anthropic rate limit exceeded"), {
          errorType: "rate_limited",
          errorMessage: errorBody,
        });
      }
      if (response.status === 400) {
        const lower = errorBody.toLowerCase();
        if (lower.includes("too long") || lower.includes("context")) {
          throw Object.assign(new Error("Context length exceeded"), {
            errorType: "context_too_long",
            errorMessage: errorBody,
          });
        }
      }
      throw Object.assign(
        new Error(
          `Anthropic error: ${response.status} ${response.statusText}`
        ),
        { errorType: "connection_failed", errorMessage: errorBody }
      );
    }

    if (!response.body) {
      throw Object.assign(new Error("No response body from Anthropic"), {
        errorType: "connection_failed",
      });
    }

    return await readStream(response.body, parseAnthropicLine, onChunk);
  } finally {
    clearTimeout(timeoutId);
    unlink();
  }
}
