import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { NPCMemoryEntry, RetrievedMemory } from "@/types/index";
import type { ExtractedMemory } from "@/server/pipeline/narrativeExtractor";
import { prepareMemoryRows, type SceneNpcRef, type FormationCtx } from "./prepare";
import { findReinforceTarget } from "./dedupe";
import { scoreMemory, effectiveSalience, KeywordRanker, type RelevanceRanker } from "./score";

const ranker: RelevanceRanker = new KeywordRanker(); // swap to an EmbeddingRanker later — no caller change

/** Form memories from this turn's extract: reinforce near-duplicates, insert the rest. Best-effort. */
export async function formMemories(extracted: ExtractedMemory[], sceneNpcs: SceneNpcRef[], ctx: FormationCtx): Promise<void> {
  try {
    const rows = prepareMemoryRows(extracted, sceneNpcs, ctx);
    if (rows.length === 0) return;
    // Pre-load existing active memories per holder once.
    const holderIds = [...new Set(rows.map((r) => r.npcId))];
    const existingByNpc = new Map<string, NPCMemoryEntry[]>();
    for (const id of holderIds) {
      existingByNpc.set(id, (await db.select().from(memories)
        .where(and(eq(memories.npcId, id), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[]);
    }
    for (const row of rows) {
      const target = findReinforceTarget(existingByNpc.get(row.npcId) ?? [], { about: row.about, content: row.content });
      if (target) {
        await db.update(memories)
          .set({ salienceBase: Math.min(100, target.salienceBase + 15), lastReinforcedTurn: ctx.turn })
          .where(eq(memories.id, target.id));
      } else {
        await db.insert(memories).values(row);
      }
    }
  } catch (err) {
    console.warn("[memory.form] failed:", err instanceof Error ? err.message : err);
  }
}

/** Retrieve top-k memories for an NPC in the current scene. Semantic impressions are always considered. */
export async function retrieveMemories(args: {
  npcId: string; currentTurn: number; sceneText: string; k?: number;
}): Promise<RetrievedMemory[]> {
  const { npcId, currentTurn, sceneText, k = 3 } = args;
  try {
    const rows = (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
    return rows
      .map((m) => ({ m, score: scoreMemory(m, currentTurn, sceneText, ranker) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ m }) => ({
        id: m.id, about: m.about, kind: m.kind, content: m.content, valence: m.valence,
        source: m.source, confidence: m.confidence, effectiveSalience: effectiveSalience(m, currentTurn),
      }));
  } catch (err) {
    console.warn("[memory.retrieve] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Load an NPC's active memories (used by seed-derivation and consolidation in the orchestrator). */
export async function loadActiveMemories(npcId: string): Promise<NPCMemoryEntry[]> {
  try {
    return (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
  } catch { return []; }
}
