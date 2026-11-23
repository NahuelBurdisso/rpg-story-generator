import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedSession, seedCharacter } from "../helpers/testDb";
import { characters, messages, sessions, npcMemory } from "@/server/db/schema";
import { commitTurn, commitTurnState, assignThreadOwners } from "@/server/pipeline/turnCommit";
import { coldStartState } from "@/server/pipeline/director";
import type { MechanicMarker, Resolution } from "@/types";

const damageMarker = (narratorDraft: string): MechanicMarker => ({
  index: 0, startIndex: narratorDraft.indexOf("[MECH"), endIndex: narratorDraft.length,
  fullMatch: "[MECHANIC:damage:1d6]", type: "damage", params: { dice: "1d6" },
});
const roll = (total: number): Resolution => ({ index: 0, roll: [total], modifier: 0, total, description: "" });

describe("commitTurn", () => {
  it("stores the assistant message and clamps HP from STATE_UPDATE", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    const id = commitTurn(db, {
      sessionId: session.id, campaignId: campaign.id, content: "Hecho.", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -15 } } } }, damage: null,
    });
    expect(db.select().from(messages).where(eq(messages.id, id)).get()?.content).toBe("Hecho.");
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(0);
    db.$client.close();
  });

  it("applies dice damage on top of the STATE_UPDATE change (fresh re-read)", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    const draft = "The blade cuts into your arm [MECHANIC:damage:1d6]";
    commitTurn(db, {
      sessionId: session.id, campaignId: campaign.id, content: "x", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -3 } } } },
      damage: { resolutions: [roll(4)], markers: [damageMarker(draft)], narratorDraft: draft },
    });
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(3);
    db.$client.close();
  });

  it("rolls back character changes when the message insert fails", () => {
    const db = createTestDb();
    const { campaign } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    expect(() => commitTurn(db, {
      sessionId: "missing-session", campaignId: campaign.id, content: "x", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -5 } } } }, damage: null,
    })).toThrow();
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(10);
    db.$client.close();
  });

  it("writes the next story state in the same transaction when given", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const next = { ...coldStartState(), turn: 7 };
    commitTurn(db, { sessionId: session.id, campaignId: campaign.id, content: "x", mechanics: [], chars: [],
      stateUpdate: null, damage: null, storyState: next });
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.storyState?.turn).toBe(7);
    db.$client.close();
  });
});

describe("commitTurnState", () => {
  it("writes scene, NPC updates, story state and seeds together", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const story = { ...coldStartState(), turn: 2 };
    commitTurnState(db, {
      sessionId: session.id, campaignId: campaign.id,
      scene: { location: "Muelle", activeNPCs: [], situation: "", pendingThreats: [], timeOfDay: "night" },
      npcUpdates: [{ name: "Mara", newState: "wary", goal: "escape" }],
      allNPCs: [],
      storyState: story,
      consequenceSeeds: [{ trigger: "t", echo: "e", messagesUntilEcho: 3 }],
      campaignStoryState: null,
    });
    const s = db.select().from(sessions).where(eq(sessions.id, session.id)).get()!;
    expect(s.sceneState?.location).toBe("Muelle");
    expect(s.storyState?.turn).toBe(2);
    expect(s.consequenceSeeds).toHaveLength(1);
    expect(db.select().from(npcMemory).all().map((n) => n.name)).toEqual(["Mara"]);
    db.$client.close();
  });

  it("inserts a newly discovered NPC once even if extracted twice", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    commitTurnState(db, {
      sessionId: session.id, campaignId: campaign.id, scene: null,
      npcUpdates: [{ name: "Mara" }, { name: "mara" }], allNPCs: [],
      storyState: coldStartState(), consequenceSeeds: [], campaignStoryState: null,
    });
    expect(db.select().from(npcMemory).all()).toHaveLength(1);
    db.$client.close();
  });

  it("updates an existing NPC's agenda fields and player disposition", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const mara = db.insert(npcMemory).values({
      campaignId: campaign.id, name: "Mara", personality: "", location: "docks",
      relationships: [{ target: "player", disposition: 10, lastInteraction: "met" }],
      secrets: [], revealedInfo: [], memoryLog: [], currentState: "calm",
    }).returning().get();
    commitTurnState(db, {
      sessionId: session.id, campaignId: campaign.id, scene: null,
      npcUpdates: [{
        name: " mara ", newState: "angry", dispositionDelta: -30,
        goal: "revenge", agenda: "follow the player", agendaThreadId: "t1",
      }],
      allNPCs: [mara],
      storyState: coldStartState(), consequenceSeeds: [], campaignStoryState: null,
    });
    const row = db.select().from(npcMemory).where(eq(npcMemory.id, mara.id)).get()!;
    expect(row.currentState).toBe("angry");
    expect(row.goal).toBe("revenge");
    expect(row.agenda).toBe("follow the player");
    expect(row.agendaThreadId).toBe("t1");
    expect(row.relationships).toEqual([{ target: "player", disposition: -20, lastInteraction: "angry" }]);
    // The snapshot passed in is not mutated.
    expect(mara.relationships[0].disposition).toBe(10);
    db.$client.close();
  });

  it("rolls back every write when one fails", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    // A new NPC under a campaign that doesn't exist violates the FK — after the scene write.
    expect(() => commitTurnState(db, {
      sessionId: session.id, campaignId: "missing-campaign",
      scene: { location: "Muelle", activeNPCs: [], situation: "", pendingThreats: [], timeOfDay: "night" },
      npcUpdates: [{ name: "Mara" }], allNPCs: [],
      storyState: { ...coldStartState(), turn: 5 }, consequenceSeeds: [], campaignStoryState: null,
    })).toThrow();
    const s = db.select().from(sessions).where(eq(sessions.id, session.id)).get()!;
    expect(s.sceneState).toBeNull();
    expect(s.storyState).toBeNull();
    expect(db.select().from(npcMemory).all()).toHaveLength(0);
    db.$client.close();
  });
});

describe("assignThreadOwners", () => {
  it("points a thread at the NPC whose agenda pushes on it", () => {
    const threads = [{ id: "t1" }, { id: "t2" }] as never[];
    const out = assignThreadOwners(threads, [{ name: "Mara", agendaThreadId: "t2" }],
      [{ id: "npc-1", name: "mara" }] as never[]);
    expect((out[1] as { ownerNpcId?: string }).ownerNpcId).toBe("npc-1");
    expect((out[0] as { ownerNpcId?: string }).ownerNpcId).toBeUndefined();
  });

  it("gives a contested thread to the last NPC that pushes on it", () => {
    const threads = [{ id: "t1" }] as never[];
    const out = assignThreadOwners(threads,
      [{ name: "Mara", agendaThreadId: "t1" }, { name: "Oren", agendaThreadId: "t1" }],
      [{ id: "npc-1", name: "Mara" }, { id: "npc-2", name: "Oren" }] as never[]);
    expect((out[0] as { ownerNpcId?: string }).ownerNpcId).toBe("npc-2");
  });
});
