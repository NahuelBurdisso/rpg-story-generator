/**
 * HP stat-key resolution. Characters store stats in a free-form record, and
 * both the "HP"/"MaxHP" and "hp"/"maxHp" spellings exist in the wild; the
 * capitalised one wins when both are present.
 */

/** The stat key holding current HP ("HP" or "hp"), if the character tracks it. */
export function hpKey(stats: Record<string, number>): "HP" | "hp" | null {
  return stats.HP !== undefined ? "HP" : stats.hp !== undefined ? "hp" : null;
}

/** The stat key holding max HP ("MaxHP" or "maxHp"), if any. */
export function maxHpKey(stats: Record<string, number>): "MaxHP" | "maxHp" | null {
  return stats.MaxHP !== undefined ? "MaxHP" : stats.maxHp !== undefined ? "maxHp" : null;
}

/** Current HP, or undefined when the character does not track it. */
export function hpValue(stats: Record<string, number>): number | undefined {
  const key = hpKey(stats);
  return key ? stats[key] : undefined;
}

/** Max HP, or undefined when the character does not track it. */
export function maxHpValue(stats: Record<string, number>): number | undefined {
  const key = maxHpKey(stats);
  return key ? stats[key] : undefined;
}
