/**
 * Headless play harness for the play -> review -> fix loop.
 *
 * Drives a scripted RPG session through the REAL chat pipeline against the live
 * local Ollama model, then writes a transcript + metrics file for review.
 *
 * Not part of the normal test suite: gated behind PLAY_LOOP=1 so `npm test`
 * skips it. Run explicitly:
 *
 *   PLAY_LOOP=1 npx vitest run scripts/play-loop.test.mts
 *   PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/play-loop.test.mts
 *
 * Seeds a throwaway campaign/character/session, runs the turns, dumps output to
 * playloop-output/, then deletes its own rows (real user data untouched).
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
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

const CAMPAIGN_NAME = "PLAYLOOP — Rainfall at the Broken Wheel";

// Scripted player turns. Chosen to stress distinct subsystems:
//  classifier / sceneClassifier / npcSelection / diceResolver / pacing /
//  stateParser / narration voice.
const PLAYER_TURNS: { intent: string; message: string }[] = [
  {
    intent: "scene-establish + NPC intro",
    message:
      "I push open the heavy tavern door and step inside, shaking rain from my cloak as I scan the smoky room.",
  },
  {
    intent: "dialogue + NPC memory",
    message:
      "I cross to the hooded figure nursing a drink in the far corner and ask, low, what they know about the caravan that vanished on the north road.",
  },
  {
    intent: "skill check (insight) -> dice",
    message:
      "I study their face and hands while they answer, trying to read whether they're lying to me.",
  },
  {
    intent: "combat trigger -> dice + damage",
    message:
      "Their hand drifts toward something hidden under the table. I draw my dagger and lunge before they can pull it.",
  },
  {
    intent: "consequence + state change",
    message:
      "I take the blade across my forearm in the scuffle but slam them against the wall, pinning them and shouting for the barkeep to bar the door.",
  },
  {
    intent: "resolution + loot/state",
    message:
      "Breathing hard, I search the figure's coat for the caravan ledger everyone says they were carrying.",
  },
];

describe("play loop harness", () => {
  it.runIf(ENABLED)(
    "plays a scripted session through the live pipeline",
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
            "A rain-soaked frontier town on the edge of a haunted moor. Caravans have been vanishing on the north road. The Broken Wheel tavern is the last warm place before the wilds.",
          statDefinitions: statDefs,
          plotHooks: ["The missing caravans", "A hooded informant who knows too much"],
          imageEnabled: false,
        })
        .returning();

      const [character] = await db
        .insert(characters)
        .values({
          campaignId: campaign.id,
          name: "Sera Vance",
          role: "Hunter-for-hire",
          backstory:
            "A former caravan guard turned freelance tracker, hunting the thing that took her last convoy.",
          // HP lives in stats.HP / stats.MaxHP — the app's convention
          // (stat-block.tsx + promptBuilder both read stats.HP/MaxHP).
          stats: { HP: 20, MaxHP: 20, might: 12, agility: 15, wits: 14, presence: 11 },
          inventory: ["worn dagger", "oilskin cloak", "coil of rope", "3 silver marks"],
          statusNotes: "Uninjured.",
        })
        .returning();

      const [session] = await db
        .insert(sessions)
        .values({
          campaignId: campaign.id,
          title: "PLAYLOOP session",
          status: "active",
        })
        .returning();

      // NPC snapshot type — the agenda-relevant fields only.
      type NpcSnapshot = {
        name: string;
        goal: string | null;
        agenda: string | null;
        lastActedTurn: number | null;
      };

      const transcript: {
        turn: number;
        intent: string;
        player: string;
        narration: string;
        ms: number;
        leakedMarkers: string[];
        storyState?: SessionStoryState | null;
        npcSnapshots?: NpcSnapshot[];
        consequenceSeeds?: {
          trigger: string;
          echo: string;
          messagesUntilEcho: number;
          threadId?: string;
        }[];
      }[] = [];

      try {
        for (let i = 0; i < PLAYER_TURNS.length; i++) {
          const { intent, message } = PLAYER_TURNS[i];
          let finalText = "";
          let errored: string | null = null;
          const start = Date.now();

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

          const ms = Date.now() - start;
          if (errored) {
            transcript.push({
              turn: i + 1,
              intent,
              player: message,
              narration: `[PIPELINE ERROR] ${errored}`,
              ms,
              leakedMarkers: [],
            });
            continue;
          }

          // Detect leaked mechanic markers that should have been substituted out.
          const leakedMarkers = Array.from(
            finalText.matchAll(/\[[A-Z_]{3,}[^\]]*\]/g)
          ).map((m) => m[0]);

          // Step 3 runs in the per-session background queue after onComplete;
          // wait for it deterministically instead of racing a fixed timeout.
          await waitForBackground(turnStateKey(session.id));
          // Read current storyState + consequence seeds from DB after this turn.
          const [turnSession] = await db
            .select({
              storyState: sessions.storyState,
              consequenceSeeds: sessions.consequenceSeeds,
            })
            .from(sessions)
            .where(eq(sessions.id, session.id));

          // Read NPC agenda snapshots for this campaign after this turn.
          const npcRows = await db
            .select({
              name: npcMemory.name,
              goal: npcMemory.goal,
              agenda: npcMemory.agenda,
              lastActedTurn: npcMemory.lastActedTurn,
            })
            .from(npcMemory)
            .where(eq(npcMemory.campaignId, campaign.id));

          transcript.push({
            turn: i + 1,
            intent,
            player: message,
            narration: finalText,
            ms,
            leakedMarkers,
            storyState: turnSession?.storyState ?? null,
            npcSnapshots: npcRows,
            consequenceSeeds: turnSession?.consequenceSeeds ?? [],
          });
        }

        // --- Pull final character state for review ------------------------
        const [finalChar] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, character.id));
        const [finalSession] = await db
          .select()
          .from(sessions)
          .where(eq(sessions.id, session.id));

        // --- Write output -------------------------------------------------
        const outDir = join(process.cwd(), "playloop-output");
        mkdirSync(outDir, { recursive: true });
        const safeModel = model.replace(/[^a-z0-9]+/gi, "_");

        const md: string[] = [
          `# Play-loop transcript`,
          ``,
          `- **Model:** \`${model}\``,
          `- **Campaign:** ${campaign.name} (${campaign.genre}/${campaign.tone}/${campaign.difficulty})`,
          `- **Character:** ${character.name} — ${character.role}`,
          `- **Turns:** ${transcript.length}`,
          ``,
          `## Final character state`,
          ``,
          `- statusNotes: \`${finalChar?.statusNotes ?? "(none)"}\``,
          `- inventory: ${JSON.stringify(finalChar?.inventory)}`,
          `- stats: ${JSON.stringify(finalChar?.stats)}`,
          ``,
          `## Final scene state`,
          ``,
          "```json",
          JSON.stringify(finalSession?.sceneState ?? null, null, 2),
          "```",
          ``,
          `## Turns`,
          ``,
        ];

        for (const t of transcript) {
          md.push(`### Turn ${t.turn} — ${t.intent}  _(${t.ms} ms)_`);
          md.push(``);
          md.push(`**Player:** ${t.player}`);
          md.push(``);
          md.push(`**GM:** ${t.narration}`);
          if (t.leakedMarkers.length) {
            md.push(``);
            md.push(`> ⚠️ LEAKED MARKERS: ${t.leakedMarkers.join(", ")}`);
          }
          if (t.storyState) {
            const ss = t.storyState;
            md.push(``);
            md.push(`**Story State:** phase=\`${ss.phase}\` tension=\`${ss.tension}\``);
            if (ss.threads.length > 0) {
              const threadList = ss.threads
                .map((th) => `${th.label} (${th.kind}, ${th.status})`)
                .join("; ");
              md.push(`**Threads:** ${threadList}`);
            } else {
              md.push(`**Threads:** (none yet)`);
            }
          }
          if (t.npcSnapshots && t.npcSnapshots.length > 0) {
            md.push(``);
            md.push(`**NPCs:**`);
            for (const npc of t.npcSnapshots) {
              const agendaPart = npc.agenda ? ` agenda=\`${npc.agenda}\`` : " agenda=(none)";
              const goalPart = npc.goal ? ` goal=\`${npc.goal}\`` : " goal=(none)";
              const actedPart = npc.lastActedTurn != null ? ` lastActedTurn=${npc.lastActedTurn}` : "";
              md.push(`  - **${npc.name}**:${goalPart}${agendaPart}${actedPart}`);
            }
          }
          if (t.consequenceSeeds && t.consequenceSeeds.length > 0) {
            md.push(``);
            md.push(`**Consequence seeds:**`);
            for (const seed of t.consequenceSeeds) {
              const threadPart = seed.threadId
                ? ` threadId=\`${seed.threadId}\``
                : " threadId=(none)";
              md.push(
                `  - echo=\`${seed.echo}\` (in ${seed.messagesUntilEcho} msgs)${threadPart}`
              );
            }
          }
          md.push(``);
        }

        const totalMs = transcript.reduce((a, t) => a + t.ms, 0);
        const leaks = transcript.flatMap((t) => t.leakedMarkers);
        md.push(`## Metrics`);
        md.push(``);
        md.push(`- total time: ${(totalMs / 1000).toFixed(1)}s`);
        md.push(`- avg turn: ${(totalMs / transcript.length / 1000).toFixed(1)}s`);
        md.push(`- leaked markers (total): ${leaks.length}`);

        writeFileSync(join(outDir, `transcript-${safeModel}.md`), md.join("\n"));
        writeFileSync(
          join(outDir, `metrics-${safeModel}.json`),
          JSON.stringify(
            {
              model,
              totalMs,
              avgMs: totalMs / transcript.length,
              leakedMarkerCount: leaks.length,
              perTurn: transcript.map((t) => ({
                turn: t.turn,
                intent: t.intent,
                ms: t.ms,
                chars: t.narration.length,
                leaks: t.leakedMarkers.length,
              })),
            },
            null,
            2
          )
        );

        // Surface a quick console summary for the run log.
         
        console.log(
          `\n[play-loop] model=${model} turns=${transcript.length} total=${(totalMs / 1000).toFixed(1)}s leaks=${leaks.length}\n` +
            `[play-loop] wrote playloop-output/transcript-${safeModel}.md`
        );

        expect(transcript.length).toBe(PLAYER_TURNS.length);

        // --- Thread lifecycle assertions (lenient: LLM is nondeterministic) ---

        // By turn 2, at least 1 story thread should exist.
        const turn2 = transcript.find((t) => t.turn === 2);
        const threadsAtTurn2 = turn2?.storyState?.threads ?? [];
        expect(
          threadsAtTurn2.length,
          `Expected at least 1 story thread by turn 2, but got 0. storyState=${JSON.stringify(turn2?.storyState)}`
        ).toBeGreaterThanOrEqual(1);

        // By turn 6, at least 1 thread should have reached 'resolved' or 'escalating'
        // (lenient: pass if ANY thread ever reached either status across all 6 turns).
        const anyProgressedThread = transcript.some((t) =>
          (t.storyState?.threads ?? []).some(
            (th) => th.status === "resolved" || th.status === "escalating"
          )
        );
        // Warn but don't hard-fail — a model that never escalates is suboptimal, not broken.
        if (!anyProgressedThread) {
           
          console.warn(
            "[play-loop] WARNING: No thread reached escalating or resolved across 6 turns. " +
              "Director is running but the model may not be engaging with threads."
          );
        }
        // Soft assertion: record thread counts and statuses in final metrics.
        const finalStoryState = transcript[transcript.length - 1]?.storyState;
        const threadSummary = (finalStoryState?.threads ?? []).map(
          (th) => `${th.label}:${th.status}`
        );
         
        console.log(
          `[play-loop] story threads at end of run (${(finalStoryState?.threads ?? []).length} total): ${threadSummary.join(", ") || "(none)"}`
        );
         
        console.log(
          `[play-loop] any thread reached escalating/resolved across 6 turns: ${anyProgressedThread}`
        );

        // --- Soft NPC agenda assertion ---
        // By the final turn, at least one NPC should have a non-null `agenda`
        // (set by extractNarrativeState's npc key). Warn but do not hard-fail —
        // the local model is nondeterministic and may not always populate agendas.
        const finalNpcSnapshots = transcript[transcript.length - 1]?.npcSnapshots ?? [];
        const anyNpcHasAgenda = finalNpcSnapshots.some((npc) => npc.agenda != null);
        if (!anyNpcHasAgenda) {
           
          console.warn(
            "[play-loop] WARNING: No NPC acquired a non-null `agenda` by the final turn. " +
              "extractNarrativeState npc key may not be populating agendas for this model/run."
          );
        }
         
        console.log(
          `[play-loop] NPC agenda summary at end of run (${finalNpcSnapshots.length} NPCs): ` +
            (finalNpcSnapshots.length === 0
              ? "(no NPCs in memory)"
              : finalNpcSnapshots
                  .map(
                    (n) =>
                      `${n.name}: agenda=${n.agenda ?? "(none)"}, goal=${n.goal ?? "(none)"}, lastActedTurn=${n.lastActedTurn ?? "(none)"}`
                  )
                  .join(" | "))
        );
         
        console.log(`[play-loop] any NPC has non-null agenda at end: ${anyNpcHasAgenda}`);

        // --- Soft consequence-seed assertion ---
        // Across the 6 turns, at least one consequence seed should get created
        // (extractNarrativeState's world.newSeeds key). Warn but do not hard-fail
        // — the local model is nondeterministic and seeds also get consumed when
        // they surface, so the snapshot may transiently show zero.
        const anySeedEverObserved = transcript.some(
          (t) => (t.consequenceSeeds?.length ?? 0) > 0
        );
        if (!anySeedEverObserved) {
           
          console.warn(
            "[play-loop] WARNING: No consequence seed was observed across 6 turns. " +
              "extractNarrativeState world.newSeeds key may not be populating seeds for this model/run."
          );
        }
        const finalSeeds = transcript[transcript.length - 1]?.consequenceSeeds ?? [];
         
        console.log(
          `[play-loop] consequence seeds at end of run (${finalSeeds.length} total): ` +
            (finalSeeds.length === 0
              ? "(none)"
              : finalSeeds
                  .map(
                    (s) =>
                      `"${s.echo}" (in ${s.messagesUntilEcho}, threadId=${s.threadId ?? "none"})`
                  )
                  .join(" | "))
        );
         
        console.log(
          `[play-loop] any consequence seed observed across 6 turns: ${anySeedEverObserved}`
        );
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
    600_000 // 10 min: live model, cold load + 6 turns
  );
});
