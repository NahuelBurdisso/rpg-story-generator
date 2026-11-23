/**
 * E2E proof that the episodic NPC memory loop works against the live model.
 *
 * Seeds an NPC, plays two turns where the player makes a memorable promise to
 * them, then asserts:
 *   1. formation — `memories` rows were written for that NPC (fire-and-forget
 *      after onComplete, so we poll);
 *   2. retrieval — `retrieveMemories` ranks them for a scene that recalls the
 *      promise (what feeds the narrator's REMEMBERS sub-block);
 * and finally plays a recall turn and logs the narration for review.
 *
 * Gated behind PLAY_LOOP=1 so `npm test` skips it. Run explicitly:
 *
 *   PLAY_LOOP=1 npx vitest run scripts/memory.test.mts
 *
 * Deletes its own rows (campaign delete cascades to npc + memories).
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
  memories,
} from "../server/db/schema";
import { runPipeline } from "../server/pipeline/orchestrator";
import { waitForBackground, turnStateKey } from "../server/pipeline/backgroundQueue";
import { retrieveMemories } from "../server/pipeline/memory/store";

const ENABLED = process.env.PLAY_LOOP === "1";

const NPC_NAME = "Brannoc";

const CAMPAIGN_NAME = "PLAYLOOP — Memoria en la Rueda Rota";

const TURNS = [
  "Me acerco a la barra y le digo a Brannoc, el tabernero: \"Si me decís quién compró la carga de la caravana, te pago la deuda que tenés con el Gremio Ceniciento. Te lo juro.\"",
  "Le dejo a Brannoc cinco marcos de plata sobre la barra como adelanto de mi promesa y espero su respuesta.",
];

const RECALL =
  "Vuelvo a la barra y le pregunto a Brannoc si se acuerda de lo que le prometí sobre su deuda con el Gremio Ceniciento.";

function playTurn(sessionId: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    runPipeline({
      sessionId,
      message,
      onToken: () => {},
      onComplete: (text) => resolve(text),
      onError: (err) => reject(new Error(`[PIPELINE ERROR] ${err}`)),
    }).catch(reject);
  });
}

describe("episodic NPC memory", () => {
  it.runIf(ENABLED)(
    "forms memories from play and retrieves them for a recall scene",
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

      // --- Seed throwaway campaign / character / session / NPC -------------
      // A vitest timeout skips `finally`, so first clear a run that died mid-way.
      await db.delete(campaigns).where(eq(campaigns.name, CAMPAIGN_NAME));
      const [campaign] = await db
        .insert(campaigns)
        .values({
          name: CAMPAIGN_NAME,
          genre: "fantasy",
          tone: "dark",
          difficulty: "normal",
          // Seed kept in Spanish on purpose: the recall narration must still come back in English.
          worldDescription:
            "Un pueblo de frontera bajo la lluvia. Las caravanas desaparecen en el camino del norte. La taberna La Rueda Rota es el último refugio antes de los páramos.",
          statDefinitions: ["might", "agility", "wits", "presence"],
          plotHooks: ["Las caravanas desaparecidas"],
          imageEnabled: false,
        })
        .returning();

      await db.insert(characters).values({
        campaignId: campaign.id,
        name: "Sera Vance",
        role: "Rastreadora a sueldo",
        backstory: "Ex guardia de caravanas que busca lo que se llevó su último convoy.",
        stats: { HP: 20, MaxHP: 20, might: 12, agility: 15, wits: 14, presence: 11 },
        inventory: ["daga gastada", "capa encerada", "12 marcos de plata"],
        statusNotes: "Ilesa.",
      });

      const [session] = await db
        .insert(sessions)
        .values({ campaignId: campaign.id, title: "PLAYLOOP memory", status: "active" })
        .returning();

      const [npc] = await db
        .insert(npcMemory)
        .values({
          campaignId: campaign.id,
          name: NPC_NAME,
          personality: "Tabernero cansado y desconfiado, ahogado en deudas con el Gremio Ceniciento.",
          location: "detrás de la barra de La Rueda Rota",
          relationships: [],
          secrets: ["sabe quién compró la carga robada de la caravana"],
          revealedInfo: [],
          memoryLog: [],
          currentState: "Secando jarras, mirando la puerta con nervios.",
        })
        .returning();

      try {
        const narrations: string[] = [];
        for (const message of TURNS) {
          narrations.push(await playTurn(session.id, message));
        }

        // Step 3 runs in the per-session background queue after onComplete;
        // wait for it deterministically instead of racing a fixed timeout.
        await waitForBackground(turnStateKey(session.id));
        // --- 1. Formation: poll for rows (written after onComplete) ---------
        let rows: (typeof memories.$inferSelect)[] = [];
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          rows = await db.select().from(memories).where(eq(memories.npcId, npc.id));
          if (rows.length > 0) break;
          await new Promise((r) => setTimeout(r, 1000));
        }

        // --- 2. Retrieval for a scene that recalls the promise --------------
        const [s] = await db
          .select({ storyState: sessions.storyState })
          .from(sessions)
          .where(eq(sessions.id, session.id));
        const retrieved = await retrieveMemories({
          npcId: npc.id,
          currentTurn: s?.storyState?.turn ?? 0,
          sceneText: RECALL,
          k: 3,
        });

        // --- 3. Recall turn (narration reviewed, not asserted) --------------
        const recallText = await playTurn(session.id, RECALL);

        console.log(
          `\n[memory] model=${model}\n` +
            `[memory] rows formed for ${NPC_NAME}: ${rows.length}\n` +
            rows
              .map(
                (m) =>
                  `  - [${m.kind}/${m.source} v=${m.valence} sal=${m.salienceBase}] about=${m.about}: ${m.content}`
              )
              .join("\n") +
            `\n[memory] retrieved for recall scene: ${retrieved.length}\n` +
            retrieved.map((m) => `  - ${m.content}`).join("\n") +
            `\n[memory] --- RECALL NARRATION ---\n${recallText}\n[memory] --- END ---\n`
        );

        expect(narrations.every((t) => t.trim().length > 0)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
        expect(retrieved.length).toBeGreaterThan(0);
        expect(recallText.trim().length).toBeGreaterThan(0);
        // Control blocks must never leak into player-facing text.
        expect(recallText).not.toMatch(/\[DIRECTOR\]/i);
        expect(recallText).not.toMatch(/^\s*REMEMBERS:/m);
      } finally {
        await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
        if (origSettings) {
          await db
            .update(userSettings)
            .set({ selectedModel: origSettings.selectedModel })
            .where(eq(userSettings.id, "default"));
        }
      }
    },
    600_000 // live model: cold load + 3 turns + formation poll
  );
});
