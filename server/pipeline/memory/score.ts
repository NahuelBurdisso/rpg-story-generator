import type { NPCMemoryEntry } from "@/types/index";

/** Tunable scorer weights. Overlap (scene relevance) is king — surface what's contextually relevant. */
export const SCORE_WEIGHTS = { valence: 0.25, recency: 0.25, overlap: 0.40, source: 0.10 };
/** Turns over which salience halves (turn-based, mirrors the director clock). */
export const DECAY_HALF_LIFE_TURNS = 15;

/** Effective salience: base, halved every DECAY_HALF_LIFE_TURNS of staleness. Never negative. */
export function effectiveSalience(m: NPCMemoryEntry, currentTurn: number): number {
  const age = Math.max(0, currentTurn - m.lastReinforcedTurn);
  const decayed = m.salienceBase * Math.pow(0.5, age / DECAY_HALF_LIFE_TURNS);
  return Math.max(0, decayed);
}

/** Pluggable relevance scorer (the only piece an embedding ranker would replace). */
export interface RelevanceRanker {
  score(sceneText: string, memory: NPCMemoryEntry): number; // 0..1
}

const STOP = new Set(["the","a","an","of","to","and","in","on","at","is","it","you","your","player","with","for"]);
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

/** Jaccard-ish overlap of significant words between the scene and the memory content. 0..1. */
export function tagOverlap(sceneText: string, memory: NPCMemoryEntry): number {
  const a = tokens(sceneText);
  const b = tokens(memory.content);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of b) if (a.has(w)) inter++;
  return inter / Math.min(a.size, b.size);
}

export class KeywordRanker implements RelevanceRanker {
  score(sceneText: string, memory: NPCMemoryEntry): number {
    return tagOverlap(sceneText, memory);
  }
}

function sourceWeight(m: NPCMemoryEntry): number {
  const base = m.source === "witnessed" ? 1 : m.source === "heard" ? 0.7 : 0.5;
  return base * (m.confidence / 100);
}

/** Composite retrieval score for ranking a memory in the current scene. */
export function scoreMemory(
  m: NPCMemoryEntry,
  currentTurn: number,
  sceneText: string,
  ranker: RelevanceRanker
): number {
  const w = SCORE_WEIGHTS;
  const salience = effectiveSalience(m, currentTurn) / 100;     // 0..1
  const valence = Math.abs(m.valence) / 100;                    // 0..1
  const overlap = ranker.score(sceneText, m);                   // 0..1
  return w.valence * valence + w.recency * salience + w.overlap * overlap + w.source * sourceWeight(m);
}
