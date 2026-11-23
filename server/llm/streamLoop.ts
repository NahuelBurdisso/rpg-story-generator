/**
 * Shared streaming-response reader for the LLM providers: line splitting,
 * delta accumulation, the repetition guard and the trailing-buffer flush live
 * here once instead of three times.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Abort `controller` when `signal` fires; returns the unlink function. */
export function linkSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) controller.abort();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

interface RepetitionState {
  fullResponse: string;
  repeatWindow: string;
}

const REPEAT_WINDOW_SIZE = 400;

/**
 * Check for repetition in streaming output. Returns { abort: true, trimmed }
 * if repetition detected, with the response trimmed to the last clean point.
 */
function checkRepetition(state: RepetitionState): { abort: false } | { abort: true; trimmed: string } {
  const { fullResponse, repeatWindow } = state;

  if (fullResponse.length <= 100) return { abort: false };

  // Check 0: Consecutive word repetition
  const tail = fullResponse.slice(-150).toLowerCase();
  const tailWords = tail.split(/\s+/).filter(Boolean);
  if (tailWords.length >= 5) {
    let consecutiveCount = 1;
    for (let wi = tailWords.length - 2; wi >= 0; wi--) {
      if (tailWords[wi] === tailWords[tailWords.length - 1]) {
        consecutiveCount++;
      } else {
        break;
      }
    }
    if (consecutiveCount >= 4) {
      const repeatedWord = tailWords[tailWords.length - 1];
      const pattern = new RegExp(`(\\s${escapeRegex(repeatedWord)}){3,}`, "i");
      const match = fullResponse.match(pattern);
      if (match && match.index !== undefined) {
        return { abort: true, trimmed: fullResponse.slice(0, match.index).trimEnd() };
      }
      return { abort: true, trimmed: fullResponse.trimEnd() };
    }
  }

  // Check 0b: Repeated bigrams
  if (tailWords.length >= 8) {
    const bigrams = new Map<string, number>();
    for (let bi = 0; bi < tailWords.length - 1; bi++) {
      const bg = `${tailWords[bi]} ${tailWords[bi + 1]}`;
      bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
    }
    const maxBigram = Math.max(...bigrams.values());
    if (maxBigram >= 4) {
      const [repeatedBg] = [...bigrams.entries()].find(([, v]) => v >= 4)!;
      const bgPattern = new RegExp(`(${escapeRegex(repeatedBg)}\\s*){2,}`, "i");
      const match = fullResponse.match(bgPattern);
      if (match && match.index !== undefined) {
        return { abort: true, trimmed: fullResponse.slice(0, match.index).trimEnd() };
      }
      return { abort: true, trimmed: fullResponse.trimEnd() };
    }
  }

  // Check 1+2: Window-based ratio checks (only when window is full and response is substantial)
  if (repeatWindow.length >= REPEAT_WINDOW_SIZE && fullResponse.length > 200) {
    const words = repeatWindow.toLowerCase().split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words);
    const wordRatio = words.length > 0 ? uniqueWords.size / words.length : 1;

    const chars = repeatWindow.slice(-200);
    const trigrams = new Set<string>();
    for (let ci = 0; ci < chars.length - 2; ci++) {
      trigrams.add(chars.slice(ci, ci + 3));
    }
    const trigramRatio = chars.length > 10 ? trigrams.size / (chars.length - 2) : 1;

    if (wordRatio < 0.25 || trigramRatio < 0.1) {
      const sentences = fullResponse.split(/(?<=[.!?\n])\s+/);
      const seen = new Set<string>();
      let cutIdx = fullResponse.length;
      for (let si = sentences.length - 1; si >= 0; si--) {
        const key = sentences[si].trim().toLowerCase().slice(0, 40);
        if (key.length < 10) continue;
        if (seen.has(key)) {
          cutIdx = fullResponse.lastIndexOf(sentences[si]);
          break;
        } else {
          seen.add(key);
          if (seen.size > 8) break;
        }
      }
      return { abort: true, trimmed: fullResponse.slice(0, cutIdx).trimEnd() };
    }
  }

  return { abort: false };
}

/**
 * Read a streaming HTTP body line by line. `parseLine` returns the text delta
 * for a line (or null for lines that carry none); it may throw on malformed
 * input, which is ignored. Calls `onChunk` per delta and stops early (cancelling
 * the reader) when the repetition guard trips. Returns the accumulated text,
 * trimmed to the last clean point on a repetition cut.
 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  parseLine: (line: string) => string | null,
  onChunk: (text: string) => Promise<void>
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullResponse = "";
  let repeatWindow = "";
  let aborted = false;

  // Returns true when the repetition guard tripped.
  const handleLine = async (line: string): Promise<boolean> => {
    try {
      const delta = parseLine(line);
      if (!delta) return false;
      fullResponse += delta;
      await onChunk(delta);

      repeatWindow += delta;
      if (repeatWindow.length > REPEAT_WINDOW_SIZE) {
        repeatWindow = repeatWindow.slice(-REPEAT_WINDOW_SIZE);
      }

      const result = checkRepetition({ fullResponse, repeatWindow });
      if (result.abort) {
        fullResponse = result.trimmed;
        void reader.cancel().catch(() => {});
        return true;
      }
    } catch {
      // Skip malformed lines
    }
    return false;
  };

  while (!aborted) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (await handleLine(line)) {
        aborted = true;
        break;
      }
    }
  }

  // A final line without a trailing newline (not after a repetition cut).
  if (!aborted && buffer.trim()) await handleLine(buffer);

  return fullResponse;
}
