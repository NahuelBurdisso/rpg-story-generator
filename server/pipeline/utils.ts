import type { CharacterRow } from "../db/schema";

/**
 * Find which character is most relevant to a given narrative context.
 * Matches character names against the text. Falls back to first character.
 */
export function findAffectedCharacter(narrativeContext: string, chars: CharacterRow[]): CharacterRow {
  if (chars.length <= 1) return chars[0];
  const lower = narrativeContext.toLowerCase();
  for (const char of chars) {
    if (lower.includes(char.name.toLowerCase())) return char;
  }
  return chars[0];
}

const STREAM_STOP_TOKENS = ["[MECHAN", "<!--", "STATE_UPDATE", "[DIRECTOR"];

/**
 * Wrap a token sink so it forwards text only up to the first mechanic marker
 * or control block (STATE_UPDATE, [DIRECTOR]) — the player shouldn't watch
 * those stream in before the stored message replaces them. A tail that may be
 * the start of one is held back until it can be decided.
 */
export function streamBeforeMarker(onToken: (token: string) => void): (chunk: string) => Promise<void> {
  let full = "";
  let sent = 0;
  let stopped = false;
  return async (chunk: string) => {
    if (stopped) return;
    full += chunk;
    const upper = full.toUpperCase();
    const hits = STREAM_STOP_TOKENS.map((t) => upper.indexOf(t)).filter((i) => i !== -1);
    let until = full.length;
    if (hits.length > 0) {
      stopped = true;
      until = Math.min(...hits);
    } else {
      for (let k = Math.max(...STREAM_STOP_TOKENS.map((t) => t.length)) - 1; k > 0; k--) {
        const tail = upper.slice(-k);
        if (STREAM_STOP_TOKENS.some((t) => t.startsWith(tail))) {
          until = full.length - k;
          break;
        }
      }
    }
    if (until > sent) {
      onToken(full.slice(sent, until));
      sent = until;
    }
  };
}

/**
 * Keep only the recap from a session-summary reply. Models sometimes answer
 * with a preamble and several options ("Acá te van un par de opciones:
 * **Opción 1** > ... **Opción 2** ..."): keep the first option's text.
 */
export function cleanRecap(raw: string): string {
  let text = raw.trim();
  // "Acá te van un par de opciones...:" preamble line
  text = text.replace(/^[^\n]*:\s*\n+/, "");
  // Everything from a second option on
  text = text.split(/\n\s*(?:\*\*)?\s*(?:Opci[oó]n|Option)\s*2/i)[0];
  return text
    .replace(/^\s*(?:\*\*)?\s*(?:Opci[oó]n|Option)\s*1[^\n]*\n+/i, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}

/** Content of the newest `n` assistant messages, oldest first. Input must be chronological. */
export function lastAssistantContents(chronological: { role: string; content: string }[], n = 3): string[] {
  return chronological.filter((m) => m.role === "assistant").slice(-n).map((m) => m.content);
}

/**
 * Messages [start, end) the next rolling summary should cover, or null while
 * fewer than `minNew` are pending. The cursor only advances past what was
 * actually summarized, so a large backlog drains over several calls.
 */
export function nextSummaryWindow(
  total: number, lastSummaryAt: number, minNew = 10, maxBatch = 20,
): { start: number; end: number } | null {
  if (total - lastSummaryAt < minNew) return null;
  return { start: lastSummaryAt, end: Math.min(total, lastSummaryAt + maxBatch) };
}

/** How many recent messages feed the narrator, from the user's setting. */
export function historyLimit(setting: number | null | undefined): number {
  return Math.min(Math.max(setting ?? 14, 4), 40);
}

/** Remove consecutively repeated phrases from content */
export function deduplicateContent(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const dedupedParagraphs: string[] = [];
  let prevParagraph = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z">*])/);
    const dedupedSentences: string[] = [];
    let prevSentence = "";
    for (const sentence of sentences) {
      const key = sentence.trim().toLowerCase();
      if (!key) continue;
      if (key === prevSentence) continue;
      prevSentence = key;
      dedupedSentences.push(sentence);
    }

    const result = dedupedSentences.join(" ");
    if (result.toLowerCase() === prevParagraph) continue;
    prevParagraph = result.toLowerCase();
    dedupedParagraphs.push(result);
  }

  return dedupedParagraphs.join("\n\n");
}

/** True when at least `every` turns passed since `lastTurn` (never run = turn 0). */
export function isDue(turn: number, lastTurn: number | undefined, every: number): boolean {
  return turn - (lastTurn ?? 0) >= every;
}
