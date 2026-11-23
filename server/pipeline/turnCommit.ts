import { eq } from "drizzle-orm";
import type { DB, DbOrTx } from "../db";
import { campaigns, characters, messages, npcMemory, sessions } from "../db/schema";
import type { CharacterRow, MessageRow, NpcMemoryRow } from "../db/schema";
import type { CampaignStoryState, ConsequenceSeed, MechanicMarker, Resolution, SceneState, SessionStoryState, StateUpdate, StoryThread } from "@/types";
import type { NpcUpdate } from "./narrativeExtractor";
import { isHeld, claimsHealthyWhileHurt } from "./stateParser";
import { findAffectedCharacter } from "./utils";
import { sameName } from "./text";
import { hpKey, maxHpKey, maxHpValue } from "@/lib/stats";

type Mechanics = NonNullable<NonNullable<MessageRow["metadata"]>["mechanics"]>;

/** Apply STATE_UPDATE character mutations. */
export function applyStateUpdate(tx: DbOrTx, stateUpdate: StateUpdate, chars: CharacterRow[]): void {
  for (const [charName, changes] of Object.entries(stateUpdate.characters ?? {})) {
    const char = chars.find((c) => sameName(c.name, charName));
    if (!char) continue;
    const fresh = tx.select().from(characters).where(eq(characters.id, char.id)).get() ?? char;
    const updates: Partial<Pick<CharacterRow, "stats" | "inventory" | "statusNotes">> = {};

    if (changes.statChanges) {
      const newStats = { ...fresh.stats };
      for (const [stat, delta] of Object.entries(changes.statChanges)) {
        newStats[stat] = (newStats[stat] ?? 0) + delta;
      }
      const hpK = hpKey(newStats);
      const maxHpK = maxHpKey(newStats);
      if (hpK) {
        const cap = maxHpK ? newStats[maxHpK] : Infinity;
        newStats[hpK] = Math.min(Math.max(0, newStats[hpK]), cap);
      }
      updates.stats = newStats;
    }

    if (changes.addInventory) {
      // Skip items already carried — the model re-adds them on later turns.
      const inventory = [...(fresh.inventory ?? [])];
      for (const item of changes.addInventory) {
        if (!isHeld(inventory, item)) inventory.push(item);
      }
      updates.inventory = inventory;
    }
    if (changes.removeInventory) {
      const currentInv = updates.inventory ?? fresh.inventory ?? [];
      updates.inventory = currentInv.filter((i: string) => !changes.removeInventory!.some((r) => isHeld([i], r)));
    }
    if (changes.statusNotes !== undefined && !claimsHealthyWhileHurt(changes.statusNotes, updates.stats ?? fresh.stats)) {
      updates.statusNotes = changes.statusNotes;
    }
    if (Object.keys(updates).length > 0) {
      tx.update(characters).set(updates).where(eq(characters.id, char.id)).run();
    }
  }
}

/** Apply dice damage to affected characters. */
export function applyDiceDamage(
  tx: DbOrTx,
  damageResolutions: Resolution[],
  markers: MechanicMarker[],
  narratorDraft: string,
  chars: CharacterRow[]
): void {
  const damageByCharId = new Map<string, number>();
  const bodyParts =
    "(?:arm|forearm|side|chest|leg|shoulder|flesh|skin|gut|belly|back|face|hand|head|throat|neck|thigh|wrist|hip)";
  const playerVictimRe = new RegExp(
    `\\b(?:into|across|through|in|down) your\\b|\\byour (?:own )?${bodyParts}\\b|\\byou (?:take|takes|suffer|suffers|feel|feels|reel|reels)\\b`,
    "i"
  );
  const npcVictimRe = new RegExp(
    `\\b(?:into|across|through|in|down) (?:their|its|his|her|the)\\b|\\b(?:their|its|his|her) (?:own )?${bodyParts}\\b`,
    "i"
  );
  for (const res of damageResolutions) {
    const marker = markers[res.index];
    const windowStart = Math.max(0, marker.startIndex - 120);
    const windowEnd = Math.min(narratorDraft.length, marker.endIndex + 120);
    const context = narratorDraft.slice(windowStart, windowEnd).toLowerCase();
    if (npcVictimRe.test(context) && !playerVictimRe.test(context)) continue;
    const affected = findAffectedCharacter(context, chars);
    const prev = damageByCharId.get(affected.id) ?? 0;
    damageByCharId.set(affected.id, prev + res.total);
  }
  for (const [charId, totalDamage] of damageByCharId.entries()) {
    const freshChar = tx.select().from(characters).where(eq(characters.id, charId)).get();
    if (!freshChar) continue;
    const freshStats = freshChar.stats ?? {};
    const hpK = hpKey(freshStats);
    if (!hpK) continue;
    const currentHp = freshStats[hpK] ?? 0;
    const newHp = Math.max(0, currentHp - totalDamage);
    const updates: Partial<Pick<CharacterRow, "stats" | "statusNotes">> = { stats: { ...freshStats, [hpK]: newHp } };
    if (newHp === 0) {
      const maxHp = maxHpValue(freshStats) ?? freshStats.HP ?? 20;
      if (totalDamage >= maxHp) {
        updates.statusNotes = "gravely wounded — massive trauma, barely alive";
      } else if (totalDamage >= maxHp * 0.5) {
        updates.statusNotes = "collapsed — serious wounds, unconscious and bleeding";
      } else {
        updates.statusNotes = "incapacitated — at 0 HP, cannot act";
      }
    } else if (newHp <= (maxHpValue(freshStats) ?? 20) * 0.25) {
      const existing = freshChar.statusNotes ?? "";
      if (!existing.includes("herido") && !existing.includes("sangr") && !existing.includes("wounded") && !existing.includes("bleeding")) {
        updates.statusNotes = (existing ? existing + "; " : "") + "badly wounded — visibly struggling";
      }
    }
    tx.update(characters).set(updates).where(eq(characters.id, charId)).run();
  }
}

/**
 * Apply NPC state/speech/disposition/agenda updates from the combined
 * extraction, and insert newly discovered NPCs.
 */
export function applyNpcUpdates(tx: DbOrTx, campaignId: string, updates: NpcUpdate[], allNPCs: NpcMemoryRow[]): void {
  for (const upd of updates) {
    if (!upd.name) continue;

    const existing = allNPCs.find((n) => sameName(n.name, upd.name));

    if (existing) {
      const dbUpdates: Partial<NpcMemoryRow> = {};
      if (upd.newState) {
        dbUpdates.currentState = upd.newState;
        dbUpdates.lastInteractedAt = Date.now();
      }
      if (upd.speechPattern) dbUpdates.speechPattern = upd.speechPattern;
      if (upd.vocabulary) dbUpdates.vocabulary = upd.vocabulary;
      if (typeof upd.goal === "string") dbUpdates.goal = upd.goal;
      if (typeof upd.agenda === "string") dbUpdates.agenda = upd.agenda;
      if (typeof upd.agendaThreadId === "string") dbUpdates.agendaThreadId = upd.agendaThreadId;

      // Apply disposition delta to player relationship
      const rels = (existing.relationships ?? []).map((r) => ({ ...r }));
      let relsChanged = false;
      if (typeof upd.dispositionDelta === "number" && upd.dispositionDelta !== 0) {
        const playerRel = rels.find((r) => r.target === "player");
        if (playerRel) {
          playerRel.disposition = Math.max(-100, Math.min(100, playerRel.disposition + upd.dispositionDelta));
          playerRel.lastInteraction = upd.newState ?? playerRel.lastInteraction;
        } else {
          rels.push({ target: "player", disposition: upd.dispositionDelta, lastInteraction: upd.newState ?? "" });
        }
        relsChanged = true;
      }

      // Track NPC-to-NPC interactions (creates a social web)
      if (upd.interactedWith && upd.interactedWith.length > 0) {
        for (const otherName of upd.interactedWith) {
          const existingRel = rels.find((r) => sameName(r.target, otherName));
          if (existingRel) {
            existingRel.lastInteraction = upd.newState ?? existingRel.lastInteraction;
          } else {
            rels.push({ target: otherName, disposition: 0, lastInteraction: upd.newState ?? "interacted" });
          }
          relsChanged = true;
        }
      }

      if (relsChanged) dbUpdates.relationships = rels;

      if (Object.keys(dbUpdates).length > 0) {
        tx.update(npcMemory).set(dbUpdates).where(eq(npcMemory.id, existing.id)).run();
      }
    } else if (upd.name) {
      // Insert newly discovered NPCs with as much personality as we can extract
      const initialDisposition = typeof upd.dispositionDelta === "number" ? upd.dispositionDelta : 0;
      const personality = [
        upd.newState ?? "encountered in passing",
        upd.speechPattern ? `Speaks: ${upd.speechPattern}` : null,
        upd.goal ? `Wants: ${upd.goal}` : null,
      ].filter((s): s is string => !!s).map((s) => s.replace(/[.\s]+$/, "")).join(". ");
      tx.insert(npcMemory).values({
        campaignId,
        name: upd.name,
        personality,
        location: "unknown",
        relationships: initialDisposition !== 0
          ? [{ target: "player", disposition: initialDisposition, lastInteraction: upd.newState ?? "" }]
          : [],
        secrets: [],
        revealedInfo: [],
        memoryLog: [],
        currentState: upd.newState ?? "encountered",
        speechPattern: upd.speechPattern ?? null,
        vocabulary: upd.vocabulary ?? null,
        lastInteractedAt: Date.now(),
      }).onConflictDoNothing().run();
    }
  }
}

/** Point each thread an NPC's agenda now pushes on at that NPC. Last update wins. */
export function assignThreadOwners(threads: StoryThread[], updates: NpcUpdate[], allNPCs: NpcMemoryRow[]): StoryThread[] {
  const next = [...threads];
  for (const upd of updates) {
    if (!upd.name || typeof upd.agendaThreadId !== "string" || !upd.agendaThreadId) continue;
    const row = allNPCs.find((n) => sameName(n.name, upd.name));
    const idx = next.findIndex((t) => t.id === upd.agendaThreadId);
    if (row && idx !== -1) next[idx] = { ...next[idx], ownerNpcId: row.id };
  }
  return next;
}

export interface TurnCommit {
  sessionId: string;
  campaignId: string;
  content: string;
  mechanics: Mechanics;
  chars: CharacterRow[];
  stateUpdate: StateUpdate | null;
  damage: { resolutions: Resolution[]; markers: MechanicMarker[]; narratorDraft: string } | null;
  /** Trivial path only: it has no step 3, so it advances storyState here. */
  storyState?: SessionStoryState;
}

/**
 * Persist a narrated turn — character changes, assistant message, campaign
 * timestamp — atomically. STATE_UPDATE runs before dice damage, and dice
 * damage re-reads HP, so both paths stack instead of overwriting each other.
 * Returns the assistant message id.
 */
export function commitTurn(db: DB, t: TurnCommit): string {
  return db.transaction((tx) => {
    if (t.stateUpdate && t.chars.length > 0) applyStateUpdate(tx, t.stateUpdate, t.chars);
    if (t.damage && t.damage.resolutions.length > 0 && t.chars.length > 0) {
      applyDiceDamage(tx, t.damage.resolutions, t.damage.markers, t.damage.narratorDraft, t.chars);
    }
    const msg = tx.insert(messages).values({
      sessionId: t.sessionId,
      role: "assistant",
      content: t.content,
      metadata: t.mechanics.length > 0 ? { mechanics: t.mechanics } : undefined,
    }).returning({ id: messages.id }).get();
    tx.update(campaigns).set({ lastPlayedAt: Date.now() }).where(eq(campaigns.id, t.campaignId)).run();
    if (t.storyState) {
      tx.update(sessions).set({ storyState: t.storyState }).where(eq(sessions.id, t.sessionId)).run();
    }
    return msg.id;
  });
}

export interface TurnStateCommit {
  sessionId: string;
  campaignId: string;
  scene: SceneState | null;
  npcUpdates: NpcUpdate[];
  allNPCs: NpcMemoryRow[];
  storyState: SessionStoryState;
  consequenceSeeds: ConsequenceSeed[];
  /** Set only on the reconcile cadence. */
  campaignStoryState: CampaignStoryState | null;
}

/** Persist everything step 3 derived from the extractor, in one transaction. */
export function commitTurnState(db: DB, c: TurnStateCommit): void {
  db.transaction((tx) => {
    if (c.scene) tx.update(sessions).set({ sceneState: c.scene }).where(eq(sessions.id, c.sessionId)).run();
    applyNpcUpdates(tx, c.campaignId, c.npcUpdates, c.allNPCs);
    if (c.campaignStoryState) {
      tx.update(campaigns).set({ storyState: c.campaignStoryState }).where(eq(campaigns.id, c.campaignId)).run();
    }
    tx.update(sessions)
      .set({ storyState: c.storyState, consequenceSeeds: c.consequenceSeeds })
      .where(eq(sessions.id, c.sessionId))
      .run();
  });
}
