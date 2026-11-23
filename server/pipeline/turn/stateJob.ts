import type { DB } from "../../db";
import { npcMemory, type CampaignRow, type NpcMemoryRow } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { CampaignStoryState, ConsequenceSeed, DirectorDecision, SessionStoryState, StoryThread } from "@/types";
import type { ProviderConfig } from "../../llm/providers";
import { mergeStoryState, reconcileCampaignThreads } from "../director";
import { extractNarrativeState } from "../narrativeExtractor";
import { isDue } from "../utils";
import { formMemories, loadActiveMemories } from "../memory/store";
import { runConsolidation } from "../memory/consolidate";
import { runGossip } from "../memory/gossip";
import { memoriesToSeed } from "../memory/seeds";
import { enqueueBackground, sessionAuxKey } from "../backgroundQueue";
import { commitTurnState, assignThreadOwners } from "../turnCommit";
import { sameName } from "../text";
import { updateCampaignJournal } from "./auxTasks";

// ~15/16 messages at two per turn. Sessions from before these fields existed run both once on their next turn, which is harmless.
const RECONCILE_EVERY_TURNS = 8;
const JOURNAL_EVERY_TURNS = 8;

/** Stamp lastActedTurn on the director's acting NPC. Runs after onComplete, so a failure is only logged. */
export function markActingNpc(db: DB, decision: DirectorDecision, allNPCs: NpcMemoryRow[], turn: number): void {
  if (decision.actingNpc) {
    const actingName = decision.actingNpc.name;
    const actingRow = allNPCs.find((n) => sameName(n.name, actingName));
    if (actingRow) {
      try {
        db.update(npcMemory).set({ lastActedTurn: turn }).where(eq(npcMemory.id, actingRow.id)).run();
      } catch (err) {
        console.error("[acting-npc]", err); // after onComplete: the stream is closed, so log instead of onError
      }
    }
  }
}

export interface StateJobArgs {
  db: DB;
  sessionId: string;
  campaignId: string;
  campaign: CampaignRow;
  llmConfig: ProviderConfig;
  currentThreads: Pick<StoryThread, "id" | "label" | "status">[];
  sceneNpcRefs: { id: string; name: string }[];
  allNPCs: NpcMemoryRow[];
  message: string;
  finalText: string;
  storyState: SessionStoryState;
  nextTurn: number;
  assistantMessageId: string;
  consequenceSeeds0: ConsequenceSeed[];
  campaignStory0: CampaignStoryState | null;
  decision: DirectorDecision;
}

/** Step 3: extraction → one state commit. Runs in the session's turnStateKey queue. */
export async function runStateJob(args: StateJobArgs): Promise<void> {
  const {
    db, sessionId, campaignId, campaign, llmConfig, currentThreads, sceneNpcRefs, allNPCs,
    message, finalText, storyState, nextTurn, assistantMessageId, consequenceSeeds0, campaignStory0, decision,
  } = args;

  const ex = await extractNarrativeState({
    llmConfig,
    currentThreads,
    npcs: sceneNpcRefs,
    knownNpcNames: allNPCs.map((n) => n.name),
    playerAction: message,
    narration: finalText,
  });

  const merged = mergeStoryState({ ...storyState, turn: nextTurn }, ex.story, nextTurn);
  merged.threads = assignThreadOwners(merged.threads, ex.npc.updates, allNPCs);

  // Memories first: this turn's new memories may seed a consequence below.
  // A memory failure must not cost the turn its state commit.
  try {
    await formMemories(ex.memories, sceneNpcRefs,
      { campaignId, sessionId, messageId: assistantMessageId, turn: nextTurn });
  } catch (err) {
    console.error("[memories]", err);
  }

  // ── Consequence-seed update ──────────────────────────────────────────
  let newSeeds = consequenceSeeds0.map((s) => ({
    ...s,
    messagesUntilEcho: Math.max(0, s.messagesUntilEcho - 1),
  }));
  if (decision.consequenceEcho !== undefined) {
    const removeIdx = newSeeds.findIndex((s) => s.echo === decision.consequenceEcho);
    if (removeIdx !== -1) newSeeds.splice(removeIdx, 1);
  }
  try {
    const hotMemories = (await Promise.all(sceneNpcRefs.map((n) => loadActiveMemories(n.id)))).flat();
    const memSeed = memoriesToSeed(hotMemories, nextTurn);
    if (memSeed) {
      newSeeds.push({ trigger: memSeed.trigger, echo: memSeed.echo, threadId: memSeed.threadId,
        messagesUntilEcho: Math.floor(Math.random() * 6) + 5 });
    }
  } catch (err) {
    console.error("[memories]", err);
  }
  for (const seed of ex.world.newSeeds) {
    newSeeds.push({ trigger: seed.trigger, echo: seed.echo, threadId: seed.threadId,
      messagesUntilEcho: Math.floor(Math.random() * 6) + 5 });
  }
  newSeeds = newSeeds.slice(-8);

  // ── Campaign reconcile (every RECONCILE_EVERY_TURNS turns): computing it is best-effort; its campaign write joins the atomic commit below
  let campaignStoryState: CampaignStoryState | null = null;
  try {
    if (isDue(nextTurn, merged.lastReconcileTurn, RECONCILE_EVERY_TURNS)) {
      merged.lastReconcileTurn = nextTurn;
      const result = reconcileCampaignThreads(campaignStory0, merged, campaign.plotHooks ?? [], sessionId);
      campaignStoryState = result.campaign;
      for (const promo of result.promotions) {
        const idx = merged.threads.findIndex((t) => t.id === promo.sessionThreadId);
        if (idx !== -1) {
          merged.threads[idx] = { ...merged.threads[idx], scope: "campaign", campaignThreadId: promo.campaignThreadId };
        }
      }
    }
  } catch (err) {
    console.error("[reconcile]", err);
  }

  const journalDue = isDue(nextTurn, merged.lastJournalTurn, JOURNAL_EVERY_TURNS);
  if (journalDue) merged.lastJournalTurn = nextTurn;

  commitTurnState(db, {
    sessionId,
    campaignId,
    scene: ex.scene.location ? ex.scene : null,
    npcUpdates: ex.npc.updates,
    allNPCs,
    storyState: merged,
    consequenceSeeds: newSeeds,
    campaignStoryState,
  });

  // Queued behind this turn's summary, so the journal reads the fresh contextSummary.
  if (journalDue) void enqueueBackground(sessionAuxKey(sessionId), () => updateCampaignJournal(campaignId, sessionId, llmConfig));

  // Memory consolidation + gossip still write outside the state commit above
  // (they are not part of that transaction).
  for (const n of sceneNpcRefs) await runConsolidation(n.id, campaignId, nextTurn);
  await runGossip(sceneNpcRefs.map((n) => n.id), nextTurn);
}
