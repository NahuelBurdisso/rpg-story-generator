import { DICE_TYPES, type DiceType } from "./enums";

export type { DiceType };

export interface DiceNotation {
  count: number;
  sides: number;
}

/**
 * Parses a dice notation string like "2d6" or "d20".
 * Throws if the notation is invalid.
 */
export function parseDiceNotation(notation: string): DiceNotation {
  const trimmed = notation.trim().toLowerCase();

  // Match patterns like "2d6", "d20", "1d4"
  const match = /^(\d+)?d(\d+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid dice notation: "${notation}"`);
  }

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);

  if (count < 1) throw new Error(`Dice count must be at least 1`);
  if (sides < 2) throw new Error(`Dice sides must be at least 2`);

  return { count, sides };
}

/**
 * Rolls a single die given its type string (e.g. "d20").
 * Returns a random integer in [1, sides].
 */
export function rollDice(diceType: string): number {
  const { sides } = parseDiceNotation(diceType);
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Rolls multiple dice given a notation string like "2d6".
 * Returns the sum of all dice.
 */
export function rollMultiple(notation: string): number {
  const { count, sides } = parseDiceNotation(notation);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}

/**
 * Formats a dice result into the standard display format.
 * e.g. formatDiceResult("d20", 15) => "[ROLL: d20 = 15]"
 */
export function formatDiceResult(dice: string, result: number): string {
  return `[ROLL: ${dice} = ${result}]`;
}

/** Drops the trailing roll that formatDiceResult appended for the narrator (the dice card shows it). */
export function stripRollSuffix(text: string): string {
  return text.replace(/\s*\[(?:ROLL|DADO|DICE): [^\]]*\]\s*$/, "");
}

/**
 * Returns the valid set of standard dice types.
 */
export function getStandardDiceTypes(): DiceType[] {
  return [...DICE_TYPES];
}

/**
 * Checks whether a string is a valid standard dice type.
 */
export function isValidDiceType(value: string): value is DiceType {
  return getStandardDiceTypes().includes(value as DiceType);
}
