import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";

export interface CandidateSeed { trigger: string; echo: string; threadId?: string; }

export const SEED_SALIENCE_FLOOR = 55;   // must still be "hot"
export const SEED_VALENCE_CEILING = -40; // must be meaningfully negative
export const SEED_VALENCE_FLOOR_POSITIVE = 40; // must be meaningfully positive

/** Derive AT MOST one consequence seed from a hot, unresolved player memory. Prefers negative. Pure. */
export function memoriesToSeed(memories: NPCMemoryEntry[], currentTurn: number): CandidateSeed | null {
  const hotMemories = memories
    .filter((m) => m.status === "active" && m.about.trim().toLowerCase() === "player")
    .map((m) => ({ m, s: effectiveSalience(m, currentTurn) }))
    .filter((x) => x.s >= SEED_SALIENCE_FLOOR);

  // Try negative first (more dramatic)
  const negative = hotMemories
    .filter((x) => x.m.valence <= SEED_VALENCE_CEILING)
    .sort((a, b) => b.m.valence - a.m.valence === 0 ? b.s - a.s : a.m.valence - b.m.valence);

  if (negative.length > 0) {
    const top = negative[0].m;
    return {
      trigger: top.content,
      echo: buildNegativeEcho(top),
      ...(top.threadId ? { threadId: top.threadId } : {}),
    };
  }

  // Fall back to strongly positive (favors and debts)
  const positive = hotMemories
    .filter((x) => x.m.valence >= SEED_VALENCE_FLOOR_POSITIVE)
    .sort((a, b) => b.m.valence - a.m.valence === 0 ? b.s - a.s : b.m.valence - a.m.valence);

  if (positive.length > 0) {
    const top = positive[0].m;
    return {
      trigger: top.content,
      echo: buildPositiveEcho(top),
      ...(top.threadId ? { threadId: top.threadId } : {}),
    };
  }

  return null;
}

/** Turn a negative memory into a dramatic consequence echo. */
function buildNegativeEcho(m: NPCMemoryEntry): string {
  const intensity = Math.abs(m.valence);
  if (intensity >= 80) {
    return `the consequences of "${m.content}" come back hard — someone who remembers has acted`;
  }
  if (intensity >= 60) {
    return `an echo of "${m.content}" resurfaces — word spread and someone responds`;
  }
  return `a quiet reminder of "${m.content}" — the past catches up unexpectedly`;
}

/** Turn a positive memory into a consequence echo — favors returned, debts repaid. */
function buildPositiveEcho(m: NPCMemoryEntry): string {
  const intensity = m.valence;
  if (intensity >= 80) {
    return `someone remembers "${m.content}" and returns the favor — unexpected help arrives at a crucial moment`;
  }
  if (intensity >= 60) {
    return `gratitude for "${m.content}" pays off — a door opens, a warning arrives, a gift appears`;
  }
  return `a small kindness returned for "${m.content}" — someone does a favor in kind`;
}
