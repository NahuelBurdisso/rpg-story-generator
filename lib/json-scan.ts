/** JSON-ish text scanning shared by the STATE_UPDATE parser and the narrative extractor. Client-safe (no server imports). */

export interface BalancedScan {
  /** Index just past the bracket that closes the one at `start`, or -1 if it never closes. */
  end: number;
  /** When `end` is -1: the closing brackets needed to balance the input, innermost first. */
  unclosed: string;
}

/**
 * Walks `text` from `start` (an opening `{`, or `[` in "any" mode), honouring
 * JSON strings and backslash escapes, and finds where that bracket closes.
 *
 * - "object": only `{` / `}` are counted (a stray `[` or `]` is ignored).
 * - "any": `{`/`[` and `}`/`]` are all counted; a closer pops whatever is open
 *   regardless of kind, so a mismatched `]` still closes a `{`.
 */
export function scanBalanced(text: string, start: number, mode: "object" | "any"): BalancedScan {
  const closers: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{" || (mode === "any" && ch === "[")) {
      closers.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || (mode === "any" && ch === "]")) {
      closers.pop();
      if (closers.length === 0) return { end: i + 1, unclosed: "" };
    }
  }
  return { end: -1, unclosed: closers.reverse().join("") };
}
