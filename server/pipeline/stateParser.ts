import { hpValue, maxHpValue } from "@/lib/stats";
import { splitStateUpdate } from "@/lib/narrative";

export interface StateUpdate {
  characters: Record<
    string,
    {
      addInventory?: string[];
      removeInventory?: string[];
      statusNotes?: string;
      statChanges?: Record<string, number>;
    }
  >;
}

export interface ParseResult {
  cleanedContent: string;
  stateUpdate: StateUpdate | null;
}

export function parseStateUpdate(response: string): ParseResult {
  const { cleanedContent, payloads } = splitStateUpdate(response);

  // Parse ALL matched blocks and merge characters
  let merged: StateUpdate | null = null;

  for (const jsonString of payloads) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && typeof parsed === "object" && "characters" in parsed) {
        if (!merged) {
          merged = parsed as StateUpdate;
        } else {
          // Merge characters from subsequent blocks into the first
          for (const [charName, changes] of Object.entries((parsed as StateUpdate).characters)) {
            if (!merged.characters[charName]) {
              merged.characters[charName] = changes;
            } else {
              const existing = merged.characters[charName];
              if (changes.addInventory) {
                existing.addInventory = [...(existing.addInventory ?? []), ...changes.addInventory];
              }
              if (changes.removeInventory) {
                existing.removeInventory = [...(existing.removeInventory ?? []), ...changes.removeInventory];
              }
              if (changes.statusNotes !== undefined) {
                existing.statusNotes = changes.statusNotes;
              }
              if (changes.statChanges) {
                existing.statChanges = existing.statChanges ?? {};
                for (const [stat, delta] of Object.entries(changes.statChanges)) {
                  existing.statChanges[stat] = (existing.statChanges[stat] ?? 0) + delta;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[stateParser] Malformed STATE_UPDATE JSON:", jsonString, e);
    }
  }

  if (merged) {
    for (const changes of Object.values(merged.characters)) {
      if (changes.addInventory) changes.addInventory = cleanItems(changes.addInventory);
      if (changes.removeInventory) changes.removeInventory = cleanItems(changes.removeInventory);
    }
  }

  return { cleanedContent, stateUpdate: merged };
}

/**
 * Models fill inventory arrays with placeholders ("Ninguno") and notes
 * ("estado: contenido desconocido"); keep only plausible item names.
 */
/**
 * Identity of an inventory item for duplicate checks: the model renames what
 * it already gave ("antique data slate" vs "data slate (antique)").
 */
export function inventoryKey(item: string): string {
  return item
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "of", "some"].includes(w))
    .sort()
    .join(" ");
}

/**
 * Whether `item` is already in `inventory`: same words, or one name is the
 * other plus qualifiers ("plasma cutter (active)" vs "plasma cutter"). Single
 * words don't absorb longer names — "key" and "brass key" stay apart.
 */
export function isHeld(inventory: string[], item: string): boolean {
  const words = inventoryKey(item).split(" ").filter(Boolean);
  return inventory.some((held) => {
    const heldWords = inventoryKey(held).split(" ").filter(Boolean);
    const [short, long] = words.length <= heldWords.length ? [words, heldWords] : [heldWords, words];
    if (short.length === long.length) return short.join(" ") === long.join(" ");
    return short.length >= 2 && short.every((w) => long.includes(w));
  });
}

/**
 * A status note that calls the PC healthy while HP says otherwise — the model
 * wrote "Uninjured." at 11/20 HP. Such a note is ignored.
 */
export function claimsHealthyWhileHurt(note: string, stats: Record<string, number>): boolean {
  const hp = hpValue(stats);
  const max = maxHpValue(stats);
  if (hp === undefined || !max) return false;
  return hp < max * 0.75 && /\b(uninjured|unharmed|unhurt|healthy|unscathed|fine|no injuries|full health)\b/i.test(note);
}

function cleanItems(items: unknown[]): string[] {
  return items
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.trim())
    .filter((i) => i.length > 0 && !i.includes(":") && !/^(ningun[oa]|nada|none|n\/a|vac[ií]o|-+)$/i.test(i))
    // Things learned aren't things carried: "recess observation (volatile energy source)".
    .filter((i) => !/\b(observations?|knowledge|information|intel|memory|memories|clues?|leads?|suspicions?|feelings?|insights?|awareness|understanding|rumou?rs?)\b/i.test(i));
}
