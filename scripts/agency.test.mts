/**
 * E2E validation that thread-linked consequences surface in live play.
 *
 * Proves the consequence loop end-to-end against the live local Ollama model:
 *   a seeded, eligible (messagesUntilEcho <= 0), thread-linked consequence seed
 *   whose threadId matches the spotlight thread is picked by runDirector ->
 *   set as decision.consequenceEcho -> rendered as a line in the [DIRECTOR]
 *   block -> after the turn, that surfaced seed is REMOVED from
 *   session.consequenceSeeds (and the rest are decremented).
 *
 * The DETERMINISTIC observable proof is consumption: after one turn the seeded
 * consequence (matched by its exact `echo`) is no longer present in
 * session.consequenceSeeds. The narration is also surfaced so the controller can
 * eyeball whether the world visibly reacts ("the doors are barred from outside").
 *
 * Not part of the normal suite: gated behind PLAY_LOOP=1 so `npm test` skips it.
 * Run explicitly:
 *
 *   PLAY_LOOP=1 npx vitest run scripts/agency.test.mts
 *   PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/agency.test.mts
 *
 * Seeds a throwaway campaign/character/session + a deterministic storyState with
 * a single high-weight spotlight thread, plus one eligible thread-linked
 * consequence seed targeting it. Runs ONE turn, then polls
 * session.consequenceSeeds (the seed removal is fire-and-forget, after
 * onComplete). Deletes its own rows afterward (real user data untouched).
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  campaigns,
  characters,
  sessions,
  userSettings,
} from "../server/db/schema";
import { runPipeline } from "../server/pipeline/orchestrator";
import { waitForBackground, turnStateKey } from "../server/pipeline/backgroundQueue";
import type { SessionStoryState } from "../types";

const ENABLED = process.env.PLAY_LOOP === "1";

// The seeded story turn at decision time.
const SEED_TURN = 5;

// The exact echo we seed. We assert this string disappears from
// session.consequenceSeeds after the turn (it surfaced and was consumed).
const SEEDED_ECHO =
  "the cult's enforcers bar the tavern doors from outside, sealing you in";

const CAMPAIGN_NAME = "AGENCY — The Informant's Table";

describe("consequence agency e2e", () => {
  it.runIf(ENABLED)(
    "director surfaces the thread-linked consequence and consumes the seed",
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
            "A rain-soaked frontier town. A hunter has cornered an informant in the tavern who knows the cult's secret. The cult does not like being pressed.",
          statDefinitions: statDefs,
          plotHooks: ["The informant's hidden knowledge", "The cult's reach"],
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
          title: "AGENCY session",
          status: "active",
        })
        .returning();

      // --- Seed a deterministic story state with ONE high-weight thread ----
      // weight 5 + the only active thread => runDirector picks it as the
      // spotlight. The consequence seed's threadId points at this thread's id,
      // so it is the preferred (threadId === spotlight.id) eligible seed.
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

      // --- Seed ONE eligible, thread-linked consequence seed ---------------
      // messagesUntilEcho: 0 => eligible NOW. threadId === spotlight => preferred.
      const seededConsequences = [
        {
          trigger: "pressed the informant for the truth",
          echo: SEEDED_ECHO,
          messagesUntilEcho: 0,
          threadId: "seed-thread",
        },
      ];

      await db
        .update(sessions)
        .set({
          storyState: seededStoryState,
          consequenceSeeds: seededConsequences,
        })
        .where(eq(sessions.id, session.id));

      try {
        const message =
          "I press the informant hard for the whole truth about the cult.";

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
        // The consequence-seed update (decrement + remove-surfaced) is
        // fire-and-forget (runs after onComplete), so poll the row for up to
        // ~8s until the seeded echo is gone from consequenceSeeds.
        type Seed = {
          trigger: string;
          echo: string;
          messagesUntilEcho: number;
          threadId?: string;
        };
        let seeds: Seed[] = [];
        let stillPresent = true;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const [row] = await db
            .select({ consequenceSeeds: sessions.consequenceSeeds })
            .from(sessions)
            .where(eq(sessions.id, session.id));
          seeds = (row?.consequenceSeeds ?? []) as Seed[];
          stillPresent = seeds.some((s) => s.echo === SEEDED_ECHO);
          if (!stillPresent) break;
          await new Promise((r) => setTimeout(r, 500));
        }

        // --- Surface the narration + seed state for the controller ---------
         
        console.log(
          `\n[agency] model=${model}\n` +
            `[agency] seeded echo consumed=${!stillPresent} (expected true)\n` +
            `[agency] consequenceSeeds now: ${JSON.stringify(seeds)}\n` +
            `[agency] --- NARRATION ---\n${finalText}\n[agency] --- END NARRATION ---\n`
        );

        // --- Hard assertion: the seeded consequence was surfaced + consumed -
        // After one turn the director should have picked the eligible,
        // spotlight-linked seed (consequenceEcho) and the orchestrator should
        // have removed it from session.consequenceSeeds. Its exact echo must be
        // gone. This is the deterministic observable proof.
        expect(
          stillPresent,
          `Seeded consequence "${SEEDED_ECHO}" was still present in consequenceSeeds after the turn. ` +
            `It should have surfaced (threadId="seed-thread" === spotlight, messagesUntilEcho=0) and been consumed. ` +
            `consequenceSeeds=${JSON.stringify(seeds)}`
        ).toBe(false);

        // --- Assertions on the narration -----------------------------------
        expect(finalText.trim().length).toBeGreaterThan(0);
        // The [DIRECTOR] control block must never leak into player-facing text.
        expect(finalText).not.toMatch(/\[DIRECTOR\]/i);
      } finally {
        // --- Cleanup: cascade deletes char/session/messages ----------------
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
