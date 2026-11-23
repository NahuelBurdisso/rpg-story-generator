import type { ExtractedMemory } from "@/server/pipeline/narrativeExtractor";

export interface SceneNpcRef { id: string; name: string; }
export interface FormationCtx { campaignId: string; sessionId: string; messageId: string; turn: number; }

/** Insert-ready memory row (no id/createdAt — DB defaults those). */
export interface NewMemoryRow {
  campaignId: string; npcId: string; about: string; kind: "episodic";
  content: string; valence: number; salienceBase: number; source: "witnessed";
  confidence: number; threadId: string | null; sessionId: string; messageId: string;
  introducedTurn: number; lastReinforcedTurn: number; status: "active";
}

/** Turn extracted memories + the scene NPC list into insert-ready rows. Drops unresolved holders. Pure. */
export function prepareMemoryRows(
  extracted: ExtractedMemory[],
  sceneNpcs: SceneNpcRef[],
  ctx: FormationCtx
): NewMemoryRow[] {
  const byName = new Map(sceneNpcs.map((n) => [n.name.trim().toLowerCase(), n.id]));
  const rows: NewMemoryRow[] = [];
  for (const m of extracted) {
    const npcId = byName.get(m.npc.trim().toLowerCase());
    if (!npcId) continue;
    rows.push({
      campaignId: ctx.campaignId, npcId, about: m.about, kind: "episodic",
      content: m.content, valence: m.valence, salienceBase: m.salience, source: "witnessed",
      confidence: 100, threadId: m.threadId ?? null, sessionId: ctx.sessionId, messageId: ctx.messageId,
      introducedTurn: ctx.turn, lastReinforcedTurn: ctx.turn, status: "active",
    });
  }
  return rows;
}
