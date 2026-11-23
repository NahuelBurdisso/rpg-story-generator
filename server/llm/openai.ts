import { linkSignal, readStream } from "./streamLoop";
import type { LLMMessage, LLMOptions } from "./providers";

/** SSE `data:` line -> text delta (`choices[0].delta.content`). Throws on malformed JSON. */
function parseOpenAILine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]") return null;
  if (!trimmed.startsWith("data: ")) return null;
  return JSON.parse(trimmed.slice(6)).choices?.[0]?.delta?.content || null;
}

export async function callOpenAI(
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  onChunk: (text: string) => Promise<void>,
  options?: LLMOptions,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  const unlink = linkSignal(signal, controller);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options?.topP !== undefined && { top_p: options.topP }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Invalid or missing OpenAI API key"), {
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
        throw Object.assign(new Error("OpenAI rate limit exceeded"), {
          errorType: "rate_limited",
          errorMessage: errorBody,
        });
      }
      if (response.status === 400 && errorBody.includes("context_length")) {
        throw Object.assign(new Error("Context length exceeded"), {
          errorType: "context_too_long",
          errorMessage: errorBody,
        });
      }
      throw Object.assign(
        new Error(`OpenAI error: ${response.status} ${response.statusText}`),
        { errorType: "connection_failed", errorMessage: errorBody }
      );
    }

    if (!response.body) {
      throw Object.assign(new Error("No response body from OpenAI"), {
        errorType: "connection_failed",
      });
    }

    return await readStream(response.body, parseOpenAILine, onChunk);
  } finally {
    clearTimeout(timeoutId);
    unlink();
  }
}
