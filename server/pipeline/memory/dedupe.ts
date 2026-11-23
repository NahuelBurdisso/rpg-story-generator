import type { NPCMemoryEntry } from "@/types/index";

const STOP = new Set(["the","a","an","of","to","and","in","on","at","is","it","you","your","player","my","with"]);
function toks(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** Symmetric token-set overlap (Jaccard). 0..1. */
export function similarity(a: string, b: string): number {
  const ta = toks(a), tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export const REINFORCE_SIMILARITY_THRESHOLD = 0.5;

/**
 * Find an existing active memory the candidate should REINFORCE rather than duplicate:
 * same subject (`about`, case-insensitive) and content similarity over threshold.
 */
export function findReinforceTarget(
  existing: NPCMemoryEntry[],
  candidate: { about: string; content: string }
): NPCMemoryEntry | null {
  const aboutKey = candidate.about.trim().toLowerCase();
  let best: NPCMemoryEntry | null = null;
  let bestSim = REINFORCE_SIMILARITY_THRESHOLD;
  for (const m of existing) {
    if (m.status !== "active") continue;
    if (m.about.trim().toLowerCase() !== aboutKey) continue;
    const sim = similarity(m.content, candidate.content);
    if (sim >= bestSim) { best = m; bestSim = sim; }
  }
  return best;
}
