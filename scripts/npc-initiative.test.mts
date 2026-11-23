/**
 * E2E validation that the narrative director hands NPC initiative in live play.
 *
 * Proves the full chain end-to-end against the live local Ollama model:
 *   selectRelevantNPCs -> runDirector picks a spotlight thread -> the NPC whose
 *   agendaThreadId matches that spotlight is chosen as decision.actingNpc ->
 *   the orchestrator stamps lastActedTurn on that NPC's npcMemory row.
 *
 * The lastActedTurn stamp (== storyState.turn at decision time) is the
 * observable proof the director handed the NPC initiative.
 *
 * Not part of the normal suite: gated behind PLAY_LOOP=1 so `npm test` skips it.
 * Run explicitly:
 *
 *   PLAY_LOOP=1 npx vitest run scripts/npc-initiative.test.mts
 *   PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/npc-initiative.test.mts
 *
 * Seeds a throwaway campaign/character/session + a deterministic storyState with
 * a single high-weight thread the seeded NPC owns, runs ONE turn, then polls the
 * npcMemory row (the stamp is fire-and-forget, after onComplete). Deletes its own
 * rows afterward (real user data untouched).
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  campaigns,
  characters,
  sessions,
  userSettings,
  npcMemory,
} from "../server/db/schema";
import { runPipeline } from "../server/pipeline/orchestrator";
import { waitForBackground, turnStateKey } from "../server/pipeline/backgroundQueue";
import type { SessionStoryState } from "../types";

const ENABLED = process.env.PLAY_LOOP === "1";

// The seeded story turn at decision time. The orchestrator stamps this exact
// value onto the acting NPC's lastActedTurn.
const SEED_TURN = 5;

const CAMPAIGN_NAME = "NPCINIT — The Informant's Table";

describe("npc initiative e2e", () => {
  it.runIf(ENABLED)(
    "director hands the seeded NPC initiative and stamps lastActedTurn",
    async () => {
      const model =
        process.env.PLAY_MODEL ?? "gemma3:12b";

      // --- Snapshot + set the model the pipeline will use -------------------
      const [origSettings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.id, "default"));
      if (origSettings) {
        await db
          .update(userSettings)
          .set({ selectedModel: model })
          .where(eq(userSettings.id, "default"));
      } else {
        await db.insert(userSettings).values({
          id: "default",
          provider: "ollama",
          selectedModel: model,
        });
      }

      // --- Seed throwaway campaign / character / session -------------------
      // A vitest timeout skips `finally`, so first clear a run that died mid-way.
      await db.delete(campaigns).where(eq(campaigns.name, CAMPAIGN_NAME));
      const statDefs = ["might", "agility", "wits", "presence"];
      const [campaign] = await db
        .insert(campaigns)
        .values({
          name: CAMPAIGN_NAME,
          genre: "fantasy",
          tone: "dark",
          difficulty: "normal",
          worldDescription:
            "A rain-soaked frontier town. A hunter has been chasing a cult's secret, and an informant in the tavern knows far more than they let on.",
          statDefinitions: statDefs,
          plotHooks: ["The informant's hidden knowledge"],
          imageEnabled: false,
        })
        .returning();

      const [_character] = await db
        .insert(characters)
        .values({
          campaignId: campaign.id,
          name: "Sera Vance",
          role: "Hunter-for-hire",
          backstory:
            "A tracker hunting the cult that took her last convoy. She has cornered an informant who knows the truth.",
          // HP lives in stats.HP / stats.MaxHP — the app's convention.
          stats: {
            HP: 20,
            MaxHP: 20,
            might: 12,
            agility: 15,
            wits: 14,
            presence: 11,
          },
          inventory: ["worn dagger", "oilskin cloak", "3 silver marks"],
          statusNotes: "Uninjured.",
        })
        .returning();

      const [session] = await db
        .insert(sessions)
        .values({
          campaignId: campaign.id,
          title: "NPCINIT session",
          status: "active",
        })
        .returning();

      // --- Seed a deterministic story state with ONE thread the NPC owns ---
      // weight 5 + the only active thread => runDirector will pick it as the
      // spotlight. The NPC's agendaThreadId points at this thread's id.
      const seededStoryState: SessionStoryState = {
        version: 1,
        phase: "rising",
        tension: 50,
        turnsInPhase: 1,
        beatsSincePayoff: 3,
        turn: SEED_TURN,
        lastGmInitiativeTurn: 0,
        threads: [
          {
            id: "seed-thread",
            label: "the informant's hidden knowledge",
            kind: "mystery",
            status: "open",
            weight: 5,
            scope: "session",
            introducedTurn: 0,
            lastTouchedTurn: 4,
            touchedCount: 2,
            forcedPayoffTurns: 0,
          },
        ],
      };
      await db
        .update(sessions)
        .set({ storyState: seededStoryState })
        .where(eq(sessions.id, session.id));

      // --- Seed the NPC whose agenda targets the seeded thread -------------
      // Provide every notNull column on npcMemory plus the agenda fields.
      const [npc] = await db
        .insert(npcMemory)
        .values({
          campaignId: campaign.id,
          name: "the informant",
          personality:
            "Guarded, watchful, careful with words. Tests how much others know before revealing anything.",
          location: "the corner table of the tavern",
          relationships: [],
          secrets: ["knows the cult's hidden meeting place"],
          revealedInfo: [],
          memoryLog: [],
          currentState: "Nursing a drink, sizing up the hunter across the table.",
          goal: "protect the cult's secret",
          agenda: "feel out exactly how much the hunter has pieced together",
          agendaThreadId: "seed-thread",
          lastActedTurn: null,
        })
        .returning();

      try {
        const message =
          "I lean across the table and press the informant directly about what they're hiding from me.";

        let finalText = "";
        let errored: string | null = null;

        await new Promise<void>((resolve) => {
          runPipeline({
            sessionId: session.id,
            message,
            onToken: () => {},
            onComplete: (text) => {
              finalText = text;
              resolve();
            },
            onError: (err) => {
              errored = err;
              resolve();
            },
          }).catch((e) => {
            errored = String(e);
            resolve();
          });
        });

        if (errored) {
          throw new Error(`[PIPELINE ERROR] ${errored}`);
        }

        // Step 3 runs in the per-session background queue after onComplete;
        // wait for it deterministically instead of racing a fixed timeout.
        await waitForBackground(turnStateKey(session.id));
        // The lastActedTurn stamp is fire-and-forget (runs after onComplete),
        // so poll the row for up to ~8s until it becomes non-null.
        let npcRow:
          | { lastActedTurn: number | null; agenda: string | null; agendaThreadId: string | null }
          | undefined;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const [row] = await db
            .select({
              lastActedTurn: npcMemory.lastActedTurn,
              agenda: npcMemory.agenda,
              agendaThreadId: npcMemory.agendaThreadId,
            })
            .from(npcMemory)
            .where(eq(npcMemory.id, npc.id));
          npcRow = row;
          if (row?.lastActedTurn != null) break;
          await new Promise((r) => setTimeout(r, 500));
        }

        // --- Surface the narration for the controller ----------------------
         
        console.log(
          `\n[npc-initiative] model=${model}\n` +
            `[npc-initiative] lastActedTurn=${npcRow?.lastActedTurn ?? "(null)"} (expected ${SEED_TURN})\n` +
            `[npc-initiative] agenda=${npcRow?.agenda ?? "(none)"} agendaThreadId=${npcRow?.agendaThreadId ?? "(none)"}\n` +
            `[npc-initiative] --- NARRATION ---\n${finalText}\n[npc-initiative] --- END NARRATION ---\n`
        );

        // --- Hard assertion: the director gave the NPC initiative ----------
        // lastActedTurn === storyState.turn at decision time proves the
        // director selected the seeded NPC as the acting NPC.
        expect(npcRow?.lastActedTurn).toBe(SEED_TURN);

        // --- Soft assertions on the narration ------------------------------
        expect(finalText.trim().length).toBeGreaterThan(0);
        // The [DIRECTOR] control block must never leak into player-facing text.
        expect(finalText).not.toMatch(/\[DIRECTOR\]/i);
      } finally {
        // --- Cleanup: cascade deletes char/session/messages/npc ------------
        await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
        if (origSettings) {
          await db
            .update(userSettings)
            .set({ selectedModel: origSettings.selectedModel })
            .where(eq(userSettings.id, "default"));
        }
      }
    },
    120_000 // generous: live model cold load + one turn + poll
  );
});
