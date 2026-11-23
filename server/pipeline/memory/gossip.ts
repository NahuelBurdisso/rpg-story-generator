import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { inArray } from "drizzle-orm";
import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";
import { similarity, REINFORCE_SIMILARITY_THRESHOLD } from "./dedupe";
import type { NewMemoryRow } from "./prepare";

export const GOSSIP_SALIENCE_FLOOR = 70;   // only strong memories travel
export const GOSSIP_CONFIDENCE_FACTOR = 0.6;
export const GOSSIP_MAX_PER_PAIR = 1;      // bound per pair per pass

export interface GossipRow extends Omit<NewMemoryRow, "source" | "sessionId" | "messageId"> {
  source: "heard" | "rumor"; sessionId: null; messageId: null;
}

/** Plan which of holder's hot player-memories should copy to recipient as hearsay. Pure. */
export function planGossip(args: {
  holderId: string; holderMemories: NPCMemoryEntry[];
  recipientId: string; recipientMemories: NPCMemoryEntry[];
  currentTurn: number;
}): GossipRow[] {
  const { holderMemories, recipientId, recipientMemories, currentTurn } = args;
  const out: GossipRow[] = [];
  // Gossip about the player AND about other NPCs — creates a richer social web
  const candidates = holderMemories
    .filter((m) => m.status === "active")
    .filter((m) => effectiveSalience(m, currentTurn) >= GOSSIP_SALIENCE_FLOOR)
    .sort((a, b) => effectiveSalience(b, currentTurn) - effectiveSalience(a, currentTurn));

  for (const m of candidates) {
    if (out.length >= GOSSIP_MAX_PER_PAIR) break;
    const aboutKey = m.about.trim().toLowerCase();
    const known = recipientMemories.some(
      (r) => r.about.trim().toLowerCase() === aboutKey && similarity(r.content, m.content) >= REINFORCE_SIMILARITY_THRESHOLD
    );
    if (known) continue;
    const source: "heard" | "rumor" = m.source === "witnessed" ? "heard" : "rumor";
    // Gossip degrades and distorts content slightly — hearsay isn't perfect recall
    const gossipContent = source === "rumor"
      ? `heard a rumor that ${m.content.charAt(0).toLowerCase()}${m.content.slice(1)}`
      : m.content;
    out.push({
      campaignId: m.campaignId, npcId: recipientId, about: m.about, kind: "episodic",
      content: gossipContent, valence: Math.round(m.valence * 0.85),
      salienceBase: Math.round(effectiveSalience(m, currentTurn) * 0.7),
      confidence: Math.round(m.confidence * GOSSIP_CONFIDENCE_FACTOR),
      threadId: m.threadId, sessionId: null, messageId: null,
      introducedTurn: currentTurn, lastReinforcedTurn: currentTurn, status: "active",
      source,
    });
  }
  return out;
}

/** Thin DB runner: gossip player-memories between co-present NPC ids. Best-effort; never throws. */
export async function runGossip(npcIds: string[], currentTurn: number): Promise<void> {
  try {
    if (npcIds.length < 2) return;
    // Scope the load to just the co-present NPCs — avoids reading the whole table.
    const all = (await db.select().from(memories).where(inArray(memories.npcId, npcIds))) as unknown as NPCMemoryEntry[];
    const byNpc = new Map<string, NPCMemoryEntry[]>();
    for (const id of npcIds) byNpc.set(id, all.filter((m) => m.npcId === id));
    const inserts: GossipRow[] = [];
    for (const holderId of npcIds) {
      for (const recipientId of npcIds) {
        if (holderId === recipientId) continue;
        inserts.push(...planGossip({
          holderId, holderMemories: byNpc.get(holderId) ?? [],
          recipientId, recipientMemories: byNpc.get(recipientId) ?? [], currentTurn,
        }));
      }
    }
    for (const row of inserts) await db.insert(memories).values(row);
  } catch (err) {
    console.warn("[memory.gossip] failed:", err instanceof Error ? err.message : err);
  }
}
