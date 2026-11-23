import { type MechanicMarker, type Resolution, type StatCheckParams, type DamageParams, type ContestParams } from "@/types";

const DICE_NOTATION = /^(\d+)?d(\d+)(?:([+-])(\d+))?$/i;

export function parseMarkers(text: string): MechanicMarker[] {
  const regex = /\[MECHAN\w*:([^\]]+)\]/gi;
  const markers: MechanicMarker[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    // Smaller models copy the prompt's format line verbatim
    // ("[MECHANIC:damage:{dice}]") — a placeholder is not a marker.
    if (/[{}]/.test(match[1])) continue;
    const parts = match[1].split(":");
    const type = parts[0] as MechanicMarker["type"];
    let params: MechanicMarker["params"];

    switch (type) {
      case "stat_check":
      case "save":
        if (parts.length < 3 || !parts[1] || !parts[2]) continue;
        params = { stat: parts[1], dc: parseInt(parts[2].replace("DC", "")) || 10 } as StatCheckParams;
        break;
      case "damage":
        // Unparseable dice would roll 0 damage — drop the marker instead.
        if (!parts[1] || !DICE_NOTATION.test(parts[1].trim())) continue;
        params = { dice: parts[1].trim() } as DamageParams;
        break;
      case "contest":
        if (parts.length < 4 || !parts[1]) continue;
        params = { stat: parts[1], modifier: parseInt(parts[3]) || 0 } as ContestParams;
        break;
      default:
        continue;
    }

    markers.push({
      index,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      fullMatch: match[0],
      type,
      params,
    });
    index++;
  }

  return markers;
}

/**
 * Keep only the first valid marker and delete the rest. The prompt allows one
 * per turn; with two, everything between them was written blind to the first
 * roll and the snippets restate each other. The outcome-aware ending covers
 * whatever the later markers were for.
 */
export function keepFirstMarker(draft: string): string {
  const first = parseMarkers(draft)[0];
  if (!first) return draft;
  const head = draft.slice(0, first.endIndex);
  const rest = draft.slice(first.endIndex).replace(/[ \t]*\[MECHAN\w*:[^\]]*\]/gi, "");
  return head + rest;
}

export function cryptoRoll(min: number, max: number): number {
  const range = max - min + 1;
  const limit = Math.floor(0x100000000 / range) * range;
  const array = new Uint32Array(1);
  do {
    crypto.getRandomValues(array);
  } while (array[0] >= limit);
  return min + (array[0] % range);
}

function rollDiceNotation(notation: string): { rolls: number[]; total: number } {
  const match = notation.match(DICE_NOTATION);
  if (!match) return { rolls: [0], total: 0 };

  const count = parseInt(match[1] || "1");
  const sides = parseInt(match[2]);
  if (count <= 0 || sides <= 0) return { rolls: [0], total: 0 };
  const bonus = match[3] === "-" ? -parseInt(match[4] || "0") : parseInt(match[4] || "0");

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(cryptoRoll(1, sides));
  }
  const total = rolls.reduce((sum, r) => sum + r, 0) + bonus;
  return { rolls, total };
}

/**
 * Stat names that mean the same thing across systems. The narrator often asks
 * for a stat the campaign doesn't define ("Willpower" on a sheet with no such
 * stat), which used to roll at +0 under a name the player never saw.
 */
const STAT_FAMILIES: string[][] = [
  ["strength", "might", "power", "brawn", "str", "athletics"],
  ["dexterity", "agility", "reflexes", "dex", "agi", "speed", "stealth", "finesse", "acrobatics"],
  ["constitution", "endurance", "toughness", "vitality", "stamina", "con", "fortitude"],
  ["intelligence", "intellect", "logic", "knowledge", "int", "reason", "investigation", "lore"],
  ["wisdom", "perception", "willpower", "will", "insight", "awareness", "spirit", "wis", "resolve", "sanity", "survival"],
  ["charisma", "presence", "persuasion", "cha", "influence", "deception", "intimidation", "performance"],
  ["tech", "technology", "engineering", "hacking", "computers", "mechanics", "electronics", "piloting"],
];
/** Families to borrow from, in order, when the sheet has no stat of a family. */
const FAMILY_FALLBACK: number[][] = [[2], [], [0], [6, 4], [3, 5], [4], [3]];

/** Resolve a marker's stat to the character's own stat key, or null if nothing fits. */
export function matchStat(stat: string, keys: string[]): string | null {
  const want = stat.trim().toLowerCase();
  const exact = keys.find((k) => k.toLowerCase() === want);
  if (exact) return exact;
  const family = STAT_FAMILIES.findIndex((f) => f.includes(want));
  if (family === -1) return null;
  for (const f of [family, ...FAMILY_FALLBACK[family]]) {
    const key = keys.find((k) => STAT_FAMILIES[f].includes(k.toLowerCase()));
    if (key) return key;
  }
  return null;
}

function getStatModifier(
  character: { stats?: Record<string, number>; statModifiers?: Record<string, number> },
  stat: string
): number {
  // Case-insensitive stat lookup — handles LLM generating "voluntad" vs "Voluntad"
  const statLower = stat.toLowerCase();
  if (character.statModifiers) {
    const key = Object.keys(character.statModifiers).find((k) => k.toLowerCase() === statLower);
    if (key !== undefined) return character.statModifiers[key];
  }
  if (character.stats) {
    const key = Object.keys(character.stats).find((k) => k.toLowerCase() === statLower);
    if (key !== undefined) return Math.floor((character.stats[key] - 10) / 2);
  }
  return 0;
}

/** DC modifier based on campaign difficulty. */
const DIFFICULTY_DC_MOD: Record<string, number> = {
  easy: -3,
  normal: 0,
  hard: 2,
  nightmare: 5,
};

export function resolveMechanics(
  draft: string,
  character: {
    stats?: Record<string, number>;
    statModifiers?: Record<string, number>;
    resolveStatsForMarker?: (startIndex: number, endIndex: number) => Record<string, number>;
    difficulty?: string;
  }
): { markers: MechanicMarker[]; resolutions: Resolution[] } {
  const dcMod = DIFFICULTY_DC_MOD[character.difficulty ?? "normal"] ?? 0;
  const markers = parseMarkers(draft);
  const resolutions: Resolution[] = markers.map((marker) => {
    // Use per-marker stats if available (multi-character support), otherwise fall back to default
    const markerChar = character.resolveStatsForMarker
      ? { stats: character.resolveStatsForMarker(marker.startIndex, marker.endIndex) }
      : character;
    const statKeys = [...Object.keys(markerChar.stats ?? {}), ...Object.keys(markerChar.statModifiers ?? {})];
    const statOf = (stat: string) => matchStat(stat, statKeys) ?? stat;

    switch (marker.type) {
      case "stat_check":
      case "save": {
        const p = marker.params as StatCheckParams;
        const stat = statOf(p.stat);
        const effectiveDC = Math.max(1, p.dc + dcMod);
        const roll = cryptoRoll(1, 20);
        const mod = getStatModifier(markerChar, stat);
        const total = roll + mod;
        const success = total >= effectiveDC;
        return {
          index: marker.index,
          roll: [roll],
          modifier: mod,
          total,
          success,
          description: `${stat} check DC${effectiveDC}: rolled ${roll}${mod >= 0 ? "+" : ""}${mod}=${total}`,
        };
      }
      case "damage": {
        const p = marker.params as DamageParams;
        const { rolls, total } = rollDiceNotation(p.dice);
        // On hard/nightmare, damage gets a flat bonus
        const damageBonus = Math.max(0, dcMod);
        const finalDamage = total + damageBonus;
        return {
          index: marker.index,
          roll: rolls,
          modifier: damageBonus,
          total: finalDamage,
          description: damageBonus > 0 ? `Damage ${p.dice}+${damageBonus}: ${finalDamage}` : `Damage ${p.dice}: ${total}`,
        };
      }
      case "contest": {
        const p = marker.params as ContestParams;
        const stat = statOf(p.stat);
        const playerBase = cryptoRoll(1, 20);
        const playerMod = getStatModifier(markerChar, stat);
        const playerTotal = playerBase + playerMod;
        const npcTotal = cryptoRoll(1, 20) + p.modifier + dcMod;
        const success = playerTotal >= npcTotal;
        return {
          index: marker.index,
          roll: [playerBase, npcTotal],
          modifier: playerMod,
          total: playerTotal,
          success,
          description: `Contest ${stat}: ${playerTotal} vs ${npcTotal}`,
        };
      }
    }
  });

  return { markers, resolutions };
}

/** Split prose into sentences, keeping a quoted line of dialogue whole. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "“" || ch === "”") inQuote = ch === "“" ? true : ch === "”" ? false : !inQuote;
    if (inQuote || !/[.!?"”*]/.test(ch)) continue;
    const next = text.slice(i + 1).match(/^\s+(?=["'“>*]?[A-Z])/);
    if (next && /[.!?]["”*]?$/.test(text.slice(start, i + 1))) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1 + next[0].length;
      i = start - 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const contentWords = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

/**
 * Drop sentences of a snippet that restate the text right before it — the
 * writer often copies its context window back, sometimes stitching two
 * sentences together ("...overlaid with human handwriting" twice in a row).
 * A sentence counts as an echo when nearly all its content words are already
 * in the context. Paragraph breaks are kept; if every sentence is an echo the
 * snippet is returned as-is.
 */
export function dropEchoedSentences(snippet: string, context: string): string {
  const seen = new Set(contentWords(context));
  const isEcho = (s: string) => {
    const words = contentWords(s);
    return words.length >= 6 && words.filter((w) => seen.has(w)).length / words.length >= 0.85;
  };
  const paragraphs = snippet
    .split(/\n\s*\n/)
    .map((p) => {
      const sentences = splitSentences(p.trim());
      const kept = sentences.filter((s) => !isEcho(s));
      // Untouched paragraphs keep their exact formatting.
      return kept.length === sentences.length ? p.trim() : kept.join(" ");
    })
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : snippet;
}

export function substituteMarkers(
  draft: string,
  markers: MechanicMarker[],
  snippets: Map<number, string>,
  opts: { rewriteTail?: boolean } = {}
): string {
  let result = draft;
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    // Only the text before counts as context: the ending rewrite is meant to
    // reuse parts of the draft ending it replaces.
    const raw = snippets.get(marker.index)?.trim();
    const written = raw ? dropEchoedSentences(raw, result.slice(Math.max(0, marker.startIndex - 600), marker.startIndex)) : raw;

    // The last marker's snippet was asked to replace the rest of the draft
    // (written before the roll). Only trust it when it's a real passage.
    if (opts.rewriteTail && i === markers.length - 1 && written && written.split(/\s+/).length >= 8) {
      const head = result.slice(0, marker.startIndex);
      let before = head.replace(/\s+$/, "");
      const startsSentence = /^["'*(]?[A-Z]/.test(written);
      if (/[,;:]$/.test(before)) before = before.slice(0, -1) + (startsSentence ? "." : ",");
      else if (/[\w)]$/.test(before) && startsSentence) before += ".";
      const newParagraph = /\n\s*\n\s*$/.test(head) || written.startsWith(">");
      result = before ? before + (newParagraph ? "\n\n" : " ") + written : written;
      continue;
    }

    let snippet = (written ?? "The outcome hung in the air for a moment.").replace(/\s+/g, " ");

    // Deduplicate: if snippet starts with text that already exists before the marker,
    // trim the overlapping prefix to prevent "X happened X happened" duplication
    const contextBefore = result.slice(Math.max(0, marker.startIndex - 60), marker.startIndex).trim();
    if (contextBefore.length > 15) {
      // Check if the last sentence fragment before the marker appears at the start of the snippet
      const lastClause = contextBefore.split(/[,.!?]/).pop()?.trim() ?? "";
      if (lastClause.length > 10 && snippet.toLowerCase().startsWith(lastClause.toLowerCase())) {
        snippet = snippet.slice(lastClause.length).replace(/^[,.\s]+/, "");
      }
    }

    let before = result.slice(0, marker.startIndex).replace(/\s+$/, "");
    let after = result.slice(marker.endIndex);

    // Same on the other side: the snippet writer sometimes echoes its
    // contextAfter window (cut mid-word) at the end of the snippet, which then
    // runs into the real text — "...mientras s. El metal ... mientras salís".
    const afterHead = after.trim().slice(0, 24);
    if (afterHead.length === 24) {
      const echoAt = snippet.indexOf(afterHead);
      if (echoAt > 0) snippet = snippet.slice(0, echoAt).trim();
    }

    const snippetStartsSentence = /^["'*(]?[A-Z]/.test(snippet);

    // Normalize the join BEFORE the snippet. The model usually writes the snippet
    // as a standalone capitalized sentence, but markers are placed mid-sentence —
    // so without a break we get run-ons like "rough wood of the table Sera squinted".
    if (/[,;:]$/.test(before)) {
      // Stranded comma/semicolon before a new sentence -> clean break.
      before = before.replace(/[,;:]$/, snippetStartsSentence ? ". " : ", ");
    } else if (/[.!?]["'*]?$/.test(before)) {
      before = before + " ";
    } else if (/[\w)"']$/.test(before)) {
      // A word with no trailing punctuation meets the snippet.
      before = snippetStartsSentence ? before + ". " : before + " ";
    } else if (before.length > 0) {
      before = before + " ";
    }

    // Normalize the join AFTER the snippet.
    if (/[.!?]$/.test(snippet)) {
      // Snippet ends a sentence — drop a stray leading "." / "," the draft left.
      after = after.replace(/^\s*[.,;:!?]+(?=\s|$)/, "");
    }
    // Ensure a single separating space when the snippet runs straight into a word,
    // but never pad a leading punctuation mark.
    if (after && !/^\s/.test(after) && !/^[.,;:!?)]/.test(after)) {
      after = " " + after;
    }

    result = before + snippet + after;
  }
  return result;
}
