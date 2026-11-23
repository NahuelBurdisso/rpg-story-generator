import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";

export const CONSOLIDATION_THRESHOLD = 12; // active episodics per NPC before sleep triggers
export const CONSOLIDATION_FLOOR = 20;     // effective salience below which an episodic is foldable

/** Given an NPC's active episodics, return the faint tail to fold (empty if under threshold). Pure. */
export function selectForConsolidation(active: NPCMemoryEntry[], currentTurn: number): NPCMemoryEntry[] {
  const episodics = active.filter((m) => m.kind === "episodic" && m.status === "active");
  if (episodics.length <= CONSOLIDATION_THRESHOLD) return [];
  return episodics.filter((m) => effectiveSalience(m, currentTurn) < CONSOLIDATION_FLOOR);
}

/**
 * Thin DB runner: for one NPC, fold faint episodics into a single semantic impression and
 * mark the raws "consolidated". Best-effort; never throws to the caller.
 * Summary is deterministic (no guaranteed LLM call) — see spec §8/§15.
 */
export async function runConsolidation(npcId: string, campaignId: string, currentTurn: number): Promise<void> {
  try {
    const rows = (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
    const fold = selectForConsolidation(rows, currentTurn);
    if (fold.length === 0) return;

    // Group the folded raws by subject and synthesize one semantic line per subject.
    const bySubject = new Map<string, NPCMemoryEntry[]>();
    for (const m of fold) {
      const key = m.about.trim().toLowerCase();
      (bySubject.get(key) ?? bySubject.set(key, []).get(key)!).push(m);
    }
    for (const [, group] of bySubject) {
      const avgValence = Math.round(group.reduce((s, m) => s + m.valence, 0) / group.length);
      const summary = buildConsolidationSummary(group[0].about, avgValence, group);
      await db.insert(memories).values({
        campaignId, npcId, about: group[0].about, kind: "semantic",
        content: summary,
        valence: avgValence, salienceBase: 60, source: "witnessed", confidence: 100,
        threadId: null, sessionId: null, messageId: null,
        introducedTurn: currentTurn, lastReinforcedTurn: currentTurn, status: "active",
      });
    }
    for (const m of fold) {
      await db.update(memories).set({ status: "consolidated" }).where(eq(memories.id, m.id));
    }
  } catch (err) {
    console.warn("[memory.consolidate] failed:", err instanceof Error ? err.message : err);
  }
}

/** Build a richer consolidation summary from the folded episodic memories. */
function buildConsolidationSummary(about: string, avgValence: number, group: NPCMemoryEntry[]): string {
  // Extract the most salient memory's content as a representative example
  const bestMemory = group.reduce((best, m) => m.salienceBase > best.salienceBase ? m : best, group[0]);
  const snippet = bestMemory.content.slice(0, 80);

  if (avgValence >= 30) {
    return `trusts ${about} after ${group.length} interactions — especially: "${snippet}"`;
  }
  if (avgValence >= 10) {
    return `thinks well of ${about} after ${group.length} encounters — remembers: "${snippet}"`;
  }
  if (avgValence <= -30) {
    return `holds a deep grudge against ${about} after ${group.length} encounters — above all: "${snippet}"`;
  }
  if (avgValence <= -10) {
    return `distrusts ${about} after ${group.length} interactions — particularly: "${snippet}"`;
  }
  return `has mixed feelings about ${about} after ${group.length} encounters — including: "${snippet}"`;
}
