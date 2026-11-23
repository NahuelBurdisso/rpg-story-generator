import { callLLM, LLMAbortedError, type LLMMessage, type LLMOptions, type ProviderConfig } from "../llm/providers";
import { streamBeforeMarker } from "./utils";

const NON_TRANSIENT = new Set(["auth_failed", "model_not_found", "context_too_long"]);

export interface NarrateArgs {
  primary: ProviderConfig;
  /** Tried once after the primary's attempts; null = no fallback (cloud users). */
  fallback: ProviderConfig | null;
  messages: LLMMessage[];
  options: LLMOptions;
  /** Streamed text up to the first control marker. Omit for a silent call. */
  onToken?: (token: string) => void;
  /** Called before a new attempt when the failed one already streamed text. */
  onReset?: () => void;
  signal?: AbortSignal;
  /** Extra attempts on the primary (default 1). */
  retries?: number;
  retryDelayMs?: number;
}

/** Sleep that ends early, rejecting with LLMAbortedError, when the signal aborts. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMAbortedError());
    const onAbort = () => { clearTimeout(timer); reject(new LLMAbortedError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Streaming narrator call with retry-then-fallback. Every attempt gets a fresh
 * marker-aware sink and is made with callLLM retries disabled, so a failed
 * attempt's partial text is never mixed into the next one; the client is told
 * to discard it via onReset. Aborts propagate immediately.
 */
export async function narrate(a: NarrateArgs, call: typeof callLLM = callLLM): Promise<string> {
  const retries = a.retries ?? 1;
  const attempts: ProviderConfig[] = [
    ...Array.from({ length: retries + 1 }, () => a.primary),
    ...(a.fallback ? [a.fallback] : []),
  ];
  let lastErr: unknown;
  let streamed = false;
  let skipPrimary = false;

  for (let i = 0; i < attempts.length; i++) {
    const config = attempts[i];
    const isPrimary = i <= retries;
    if (isPrimary && skipPrimary) continue;
    if (a.signal?.aborted) throw new LLMAbortedError();
    // Drop the dead partial text right away, not after the retry delay.
    if (streamed) {
      a.onReset?.();
      streamed = false;
    }
    if (i > 0 && isPrimary) await abortableDelay(a.retryDelayMs ?? 1500, a.signal);
    const onToken = a.onToken;
    const sink = onToken
      ? streamBeforeMarker((t) => { streamed = true; onToken(t); })
      : async () => {};
    try {
      return await call(config, a.messages, sink, a.options, { priority: "streaming", retries: 0, signal: a.signal });
    } catch (err) {
      if (err instanceof LLMAbortedError) throw err;
      lastErr = err;
      const type = (err as { errorType?: string }).errorType;
      if (isPrimary && type && NON_TRANSIENT.has(type)) skipPrimary = true;
    }
  }
  throw lastErr;
}
