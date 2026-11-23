/**
 * Narration text helpers shared by the pipeline (server/pipeline/text.ts,
 * stateParser.ts) and the chat UI. Client-safe: imports only lib/.
 */
import { scanBalanced } from "./json-scan";

/** A complete `[MECHANIC:...]` marker (non-global: safe for .test()/.exec()) (also matches truncated keywords like `[MECHAN_:...]`). */
export const MECHANIC_MARKER_RE = /\[MECHAN\w*:[^\]]*\]/i;

/** Global twin of MECHANIC_MARKER_RE for replace-all; kept private so nobody calls .test()/.exec() on it. */
const MECHANIC_MARKER_GLOBAL = new RegExp(MECHANIC_MARKER_RE.source, "gi");

/** Removes complete mechanic markers and tidies the whitespace they leave behind. */
export function stripMechanicMarkers(text: string): string {
  return text
    .replace(MECHANIC_MARKER_GLOBAL, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes markers including truncated ones (no colon or closing bracket), for
 * history where a marker may have been cut off. Does not touch whitespace.
 */
export function stripMechanicMarkersLoose(text: string): string {
  return text.replace(/\[MECHAN[^\]]*\]?/g, "");
}

/** Index just past the JSON object starting at `start` (a "{"), or -1 if unclosed. */
function endOfJsonObject(text: string, start: number): number {
  return scanBalanced(text, start, "object").end;
}

/**
 * Cut every STATE_UPDATE block out of `text`, returning the remaining prose and
 * the JSON payloads. The canonical shape is
 * `<!-- STATE_UPDATE {json} STATE_UPDATE -->`, but models also emit
 * `<!-- STATE_UPDATE {json}-->`, `[STATE_UPDATE {json} STATE_UPDATE -->`,
 * a bare `STATE_UPDATE\n{json}` and empty `<!-- STATE_UPDATE -->` tags.
 */
function extractStateBlocks(text: string): { prose: string; payloads: string[] } {
  const payloads: string[] = [];
  const tag = /(?:<!--|\[)?[ \t]*STATE_UPDATE\b\]?:?/gi;
  let prose = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(text)) !== null) {
    let end = match.index + match[0].length;
    const jsonStart = text.slice(end).search(/\S/) + end;
    if (text[jsonStart] === "{") {
      const jsonEnd = endOfJsonObject(text, jsonStart);
      if (jsonEnd !== -1) {
        payloads.push(text.slice(jsonStart, jsonEnd));
        end = jsonEnd;
      } else {
        // Unclosed JSON: drop it up to its closing tag, else to the paragraph end.
        const rest = text.slice(jsonStart);
        const stop = rest.search(/STATE_UPDATE|-->|\n\s*\n/i);
        end = jsonStart + (stop === -1 ? rest.length : stop);
      }
    }
    // Swallow the closing half: stray extra braces, an optional repeated tag,
    // then "-->" or "]".
    const closer = /^\s*\}*\s*(?:STATE_UPDATE\b)?\s*(?:-->|\])?/i.exec(text.slice(end));
    end += closer ? closer[0].length : 0;
    prose += text.slice(cursor, match.index);
    cursor = end;
    tag.lastIndex = end;
  }
  prose += text.slice(cursor);
  return { prose, payloads };
}

export interface StateUpdateSplit {
  /** The prose with every STATE_UPDATE block removed. */
  cleanedContent: string;
  /** Raw JSON payloads, in order (not parsed). */
  payloads: string[];
}

export function splitStateUpdate(response: string): StateUpdateSplit {
  // Safety net: models sometimes emit STATE_UPDATE as prose
  // (e.g. "[STATE_UPDATE]\nInventory: ...") that has no JSON to parse.
  // Strip those first so the marker never leaks into the narration.
  const withoutProseBlocks = response
    .replace(/\[STATE_UPDATE\][\s\S]*?(?=\n\s*\n|$)/gi, "")
    .replace(/^\s*STATE_UPDATE\s*:.*$/gim, "");

  const { prose, payloads } = extractStateBlocks(withoutProseBlocks);
  const cleanedContent = prose
    .replace(/\n\s*[{}]+\s*$/, "") // a lone brace left on the last line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedContent, payloads };
}

/** What the chat shows for a stored narrator message (older rows were saved with markers / STATE_UPDATE blocks). */
export function narrationForDisplay(content: string): string {
  return splitStateUpdate(stripMechanicMarkersLoose(content)).cleanedContent;
}
