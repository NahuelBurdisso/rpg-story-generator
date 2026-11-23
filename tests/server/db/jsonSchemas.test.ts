import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  messageMetadataSchema,
  clientMessageMetadataSchema,
  readCampaignStoryState,
  readConsequenceSeeds,
  readSceneState,
  readSessionStoryState,
} from "@/server/db/jsonSchemas";
import { coldStartState } from "@/server/pipeline/director";
import type { CampaignStoryState, SessionStoryState, StoryThread } from "@/server/db/jsonTypes";

const thread = (over: Partial<StoryThread> = {}): StoryThread => ({
  id: "t1", label: "The missing heir", kind: "mystery", status: "open", weight: 3, scope: "campaign",
  introducedTurn: 1, lastTouchedTurn: 2, touchedCount: 1, forcedPayoffTurns: 0,
  ownerNpcId: "npc1", notes: "a note", campaignThreadId: "c1", ...over,
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe("readSessionStoryState", () => {
  it("returns a valid state unchanged", () => {
    const state: SessionStoryState = {
      ...coldStartState(), turn: 4, lastIntent: "develop", lastSpotlightId: "t1",
      lastReconcileTurn: 3, lastJournalTurn: 2, threads: [thread()],
    };
    expect(readSessionStoryState(state)).toEqual(state);
    expect(warn).not.toHaveBeenCalled();
  });

  it("null falls back to a cold start without warning", () => {
    expect(readSessionStoryState(null)).toEqual(coldStartState());
    expect(warn).not.toHaveBeenCalled();
  });

  it("missing threads or a different version falls back to a cold start and warns", () => {
    const { threads: _t, ...noThreads } = coldStartState();
    expect(readSessionStoryState(noThreads)).toEqual(coldStartState());
    expect(readSessionStoryState({ ...coldStartState(), version: 2 })).toEqual(coldStartState());
    expect(readSessionStoryState("garbage")).toEqual(coldStartState());
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("keeps a thread with a bad kind, status or weight, degrading those fields", () => {
    const raw = {
      ...coldStartState(),
      threads: [
        thread({ id: "a", kind: "quest" as never, status: "ongoing" as never, weight: 2.6 as never }),
        thread({ id: "b", kind: " Threat " as never, status: "RESOLVED" as never, weight: 99 as never }),
        thread({ id: "c", weight: "x" as never }),
      ],
    };
    const out = readSessionStoryState(raw);
    expect(out.threads.map((t) => [t.id, t.kind, t.status, t.weight])).toEqual([
      ["a", "goal", "open", 3],
      ["b", "threat", "resolved", 5],
      ["c", "mystery", "open", 3],
    ]);
  });

  it("drops a broken thread and keeps the others", () => {
    const good = thread({ id: "good" });
    const raw = { ...coldStartState(), threads: [good, { id: "bad", kind: "nope" }, null] };
    const out = readSessionStoryState(raw);
    expect(out.threads).toEqual([good]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("readSceneState", () => {
  const scene = {
    location: "Tavern", activeNPCs: [{ name: "Mara", desc: "barkeep", disposition: "friendly" }],
    situation: "quiet", pendingThreats: ["a rumor"], timeOfDay: "night", mood: "tense",
  };

  it("returns a valid scene unchanged", () => {
    expect(readSceneState(scene)).toEqual(scene);
  });

  it("fills missing arrays with []", () => {
    const { activeNPCs: _a, pendingThreats: _p, ...rest } = scene;
    expect(readSceneState(rest)).toEqual({ ...rest, activeNPCs: [], pendingThreats: [] });
  });

  it("returns null for garbage", () => {
    expect(readSceneState("nope")).toBeNull();
    expect(readSceneState({ location: 3 })).toBeNull();
    expect(readSceneState(null)).toBeNull();
  });
});

describe("readConsequenceSeeds", () => {
  it("keeps valid seeds and filters broken ones", () => {
    const ok = { trigger: "t", echo: "e", messagesUntilEcho: 2, threadId: "x" };
    const out = readConsequenceSeeds([
      ok,
      { trigger: "t", messagesUntilEcho: 1 },
      { trigger: "t", echo: "e", messagesUntilEcho: "soon" },
      null,
    ]);
    expect(out).toEqual([ok]);
  });

  it("returns [] for non-arrays", () => {
    expect(readConsequenceSeeds({})).toEqual([]);
    expect(readConsequenceSeeds(null)).toEqual([]);
  });
});

describe("readCampaignStoryState", () => {
  it("returns a valid state unchanged", () => {
    const s: CampaignStoryState = {
      version: 1,
      threads: [{ id: "c1", label: "L", kind: "goal", status: "open", weight: 2, introducedSession: "s1", lastTouchedSession: "s1", notes: "n", history: ["h1"] }],
    };
    expect(readCampaignStoryState(s)).toEqual(s);
  });

  it("keeps a campaign thread with a bad kind or status", () => {
    const out = readCampaignStoryState({
      version: 1,
      threads: [{ id: "c1", label: "L", kind: "quest", status: "x", weight: 2.2, introducedSession: "s1", lastTouchedSession: "s1", history: [] }],
    });
    expect(out?.threads.map((t) => [t.kind, t.status, t.weight])).toEqual([["goal", "open", 2]]);
  });

  it("returns null for garbage", () => {
    expect(readCampaignStoryState("x")).toBeNull();
    expect(readCampaignStoryState({ version: 2, threads: [] })).toBeNull();
    expect(readCampaignStoryState(null)).toBeNull();
  });
});

describe("messageMetadataSchema", () => {
  it("accepts valid metadata", () => {
    const meta = {
      diceRoll: { dice: "d20", result: 17 }, action: "attack", error: true, errorType: "timeout",
      mechanics: [{ text: "Perception", outcome: "success" }], imageId: "img1",
    };
    expect(messageMetadataSchema.safeParse(meta).success).toBe(true);
  });

  it("rejects an unknown dice type or error type", () => {
    expect(messageMetadataSchema.safeParse({ diceRoll: { dice: "d7", result: 3 } }).success).toBe(false);
    expect(messageMetadataSchema.safeParse({ errorType: "exploded" }).success).toBe(false);
    expect(clientMessageMetadataSchema.safeParse({ diceRoll: { dice: "d7", result: 3 } }).success).toBe(false);
  });

  it("the client schema strips server-written keys", () => {
    const out = clientMessageMetadataSchema.parse({ action: "a", imageId: "i", mechanics: [] });
    expect(out).toEqual({ action: "a" });
  });

  it("the client schema also strips the server-only error fields", () => {
    const out = clientMessageMetadataSchema.parse({
      action: "a",
      diceRoll: { dice: "d20", result: 7 },
      error: true,
      errorType: "timeout",
      errorMessage: "boom",
    });
    expect(out).toEqual({ action: "a", diceRoll: { dice: "d20", result: 7 } });
    // a bad errorType is ignored too, not a validation failure
    expect(clientMessageMetadataSchema.safeParse({ errorType: "exploded" }).success).toBe(true);
  });
});
