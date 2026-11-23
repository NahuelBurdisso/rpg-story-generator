import { describe, it, expect } from "vitest";
import { coldStartState, deriveTension, advancePhase, CONSTANTS } from "@/server/pipeline/director";
import type { StoryThread, SessionStoryState as SessionState, ThreadKind } from "@/types";

const thread = (over: Partial<StoryThread> = {}): StoryThread => ({
  id: "t1", label: "the caravans", kind: "mystery", status: "open", weight: 3,
  scope: "session", introducedTurn: 0, lastTouchedTurn: 0, touchedCount: 1,
  forcedPayoffTurns: 0, ...over,
});

describe("coldStartState", () => {
  it("returns a setup-phase empty state", () => {
    const s = coldStartState();
    expect(s.phase).toBe("setup");
    expect(s.threads).toEqual([]);
    expect(s.turn).toBe(0);
    expect(s.tension).toBeGreaterThanOrEqual(0);
  });
});

describe("deriveTension", () => {
  it("weights escalating threads double and blends with the prior read, clamped by delta", () => {
    const threads = [thread({ status: "escalating", weight: 4 })];
    // tensionFromThreads = min(100, 8 * (4*2)) = 64; blend 50/50 with read=80 => 72; clamp from prev=0 by +12 => 12
    const t = deriveTension({ prevTension: 0, threads, tensionRead: 80, isPayoff: false });
    expect(t).toBe(12);
  });
  it("never moves more than TENSION_MAX_DELTA per turn", () => {
    const t = deriveTension({ prevTension: 50, threads: [thread({ status: "escalating", weight: 5 })], tensionRead: 100, isPayoff: false });
    expect(Math.abs(t - 50)).toBeLessThanOrEqual(CONSTANTS.TENSION_MAX_DELTA);
  });
});

describe("advancePhase", () => {
  it("stays in phase until MIN_TURNS_IN_PHASE", () => {
    expect(advancePhase({ phase: "setup", tension: 90, turnsInPhase: 1 }).phase).toBe("setup");
  });
  it("advances setup->rising past the threshold after min turns", () => {
    expect(advancePhase({ phase: "setup", tension: 45, turnsInPhase: 3 }).phase).toBe("rising");
  });
});

import { runDirector } from "@/server/pipeline/director";
import { coldStartState as cold } from "@/server/pipeline/director";

const state = (over: Partial<SessionState> = {}) => ({ ...cold(), ...over });

describe("runDirector", () => {
  it("cold start → develop intent in setup, no spotlight", () => {
    const d = runDirector(state({ turn: 1 }));
    expect(d.intent).toBe("develop");
    expect(d.spotlight).toBeUndefined();
    expect(d.gmInitiative).toBe("");
    expect(typeof d.wordBudget).toBe("string");
  });

  it("forces payoff when the spotlight has been escalating past ESCALATE_LIMIT", () => {
    const d = runDirector(state({
      turn: 10, beatsSincePayoff: 5,
      threads: [thread({ status: "escalating", weight: 4, lastTouchedTurn: 6 })], // staleness 4 >= 3
    }));
    expect(d.intent).toBe("payoff");
    expect(d.spotlight?.id).toBe("t1");
  });

  it("escalates a stale thread only after a beat", () => {
    const d = runDirector(state({
      turn: 10, beatsSincePayoff: 3,
      threads: [thread({ status: "open", weight: 3, lastTouchedTurn: 5 })], // staleness 5 >= 4
    }));
    expect(d.intent).toBe("escalate");
  });

  it("breathes right after a payoff", () => {
    const d = runDirector(state({ turn: 10, beatsSincePayoff: 0,
      threads: [thread({ lastTouchedTurn: 10 })] }));
    expect(d.intent).toBe("breathe");
  });

  it("gives the player-engaged thread the spotlight via the additive PLAYER_BONUS", () => {
    // "other" staleness 1 → priority 3*(1+1)=6; "engaged" touched this turn → 3*(1+0)+6=9; 9>6
    const d = runDirector(state({ turn: 8, beatsSincePayoff: 3, threads: [
      thread({ id: "other", weight: 3, lastTouchedTurn: 7 }),   // staleness 1 → priority 6
      thread({ id: "engaged", weight: 3, lastTouchedTurn: 8 }), // touched this turn → priority 9
    ] }));
    expect(d.spotlight?.id).toBe("engaged");
  });

  it("fires gmInitiative (string) when a thread is very stale and the gap has passed", () => {
    const d = runDirector(state({ turn: 12, lastGmInitiativeTurn: 0, beatsSincePayoff: 3,
      threads: [thread({ status: "open", weight: 4, lastTouchedTurn: 3 })] })); // staleness 9 >= STALE+2
    expect(d.gmInitiative.length).toBeGreaterThan(0);
  });

  it("fires gmInitiative after a quiet stretch even when every thread was touched", () => {
    // Playtest: the extractor touched all threads each turn, so nothing went
    // stale and the GM never acted in 8 turns of beatsSincePayoff climbing.
    const d = runDirector(state({ turn: 8, lastGmInitiativeTurn: -2, beatsSincePayoff: 6,
      threads: [
        thread({ id: "m", kind: "mystery", weight: 4, lastTouchedTurn: 8 }),
        thread({ id: "th", kind: "threat", label: "structural integrity", weight: 3, lastTouchedTurn: 7 }),
      ] }));
    expect(d.gmInitiative).toContain("structural integrity");
  });

  it("spaces quiet-stretch complications by QUIET_INITIATIVE_GAP", () => {
    const d = runDirector(state({ turn: 8, lastGmInitiativeTurn: 6, beatsSincePayoff: 9,
      threads: [thread({ kind: "threat", lastTouchedTurn: 8 })] }));
    expect(d.gmInitiative).toBe("");
  });
});

import { mergeStoryState } from "@/server/pipeline/director";

describe("mergeStoryState", () => {
  it("applies a status update by id and bumps touch metadata", () => {
    const prev = state({ turn: 4, threads: [thread({ id: "t1", status: "open", touchedCount: 1 })] });
    const next = mergeStoryState(prev, {
      threadUpdates: [{ id: "t1", status: "escalating", notes: "closing in" }],
      newThreads: [], tensionRead: 50,
    }, 5);
    const t = next.threads.find((x) => x.id === "t1")!;
    expect(t.status).toBe("escalating");
    expect(t.lastTouchedTurn).toBe(5);
    expect(t.touchedCount).toBe(2);
  });

  it("keeps the cadence bookkeeping fields", () => {
    const prev = { ...coldStartState(), lastReconcileTurn: 8, lastJournalTurn: 16 };
    const next = mergeStoryState(prev, { threadUpdates: [], newThreads: [], tensionRead: 3 }, 17);
    expect(next.lastReconcileTurn).toBe(8);
    expect(next.lastJournalTurn).toBe(16);
  });

  it("force-resolves the spotlight after MAX_FORCED_PAYOFF_TURNS when the model won't", () => {
    const sp = thread({ id: "t1", status: "escalating", forcedPayoffTurns: CONSTANTS.MAX_FORCED_PAYOFF_TURNS - 1 });
    const prev = state({ turn: 6, lastIntent: "payoff", lastSpotlightId: "t1", threads: [sp] });
    const next = mergeStoryState(prev, { threadUpdates: [], newThreads: [], tensionRead: 40 }, 7);
    expect(next.threads.find((x) => x.id === "t1")?.status).toBe("resolved");
    expect(next.beatsSincePayoff).toBe(0);
  });

  it("caps new threads and dedupes by normalized label", () => {
    const prev = state({ turn: 1, threads: [thread({ id: "t1", label: "The Caravans" })] });
    const next = mergeStoryState(prev, { threadUpdates: [], newThreads: [
      { label: "the caravans", kind: "mystery", weight: 3 }, // dup of existing
      { label: "a", kind: "threat", weight: 2 },
      { label: "b", kind: "threat", weight: 2 },
      { label: "c", kind: "threat", weight: 2 }, // beyond MAX_NEW_THREADS_PER_TURN
    ], tensionRead: 20 }, 2);
    const added = next.threads.filter((t) => t.introducedTurn === 2);
    expect(added.length).toBe(CONSTANTS.MAX_NEW_THREADS_PER_TURN);
  });

  it("caps new-thread weight, skips flavor threads and stops at a full board", () => {
    const next = mergeStoryState(state({ turn: 1 }), { threadUpdates: [], newThreads: [
      { label: "aroma dulce", kind: "mystery", weight: 1 },
      { label: "el pozo", kind: "mystery", weight: 5 },
    ], tensionRead: 20 }, 2);
    expect(next.threads.map((t) => [t.label, t.weight])).toEqual([["el pozo", CONSTANTS.NEW_THREAD_MAX_WEIGHT]]);

    const full = Array.from({ length: CONSTANTS.MAX_SESSION_THREADS }, (_, i) =>
      thread({ id: `p${i}`, label: `p${i}`, weight: 4, status: "open", lastTouchedTurn: 1 }));
    const after = mergeStoryState(state({ turn: 1, threads: full }), { threadUpdates: [], newThreads: [
      { label: "otro misterio", kind: "mystery", weight: 3 },
    ], tensionRead: 20 }, 2);
    expect(after.threads.length).toBe(CONSTANTS.MAX_SESSION_THREADS);
  });

  it("skips a new thread that near-duplicates an existing one", () => {
    // Labels captured from a local gemma model in live play.
    const prev = state({ turn: 1, threads: [thread({ id: "t1", label: "Rhythmic sound from depths" })] });
    const next = mergeStoryState(prev, { threadUpdates: [], newThreads: [
      { label: "Heavy, dragging sound from depths", kind: "mystery", weight: 3 },
      { label: "The mayor's stolen handkerchief", kind: "mystery", weight: 3 },
    ], tensionRead: 20 }, 2);
    expect(next.threads.map((t) => t.label)).toEqual(["Rhythmic sound from depths", "The mayor's stolen handkerchief"]);
  });

  it("derives tension from the strongest threads only", () => {
    const many = Array.from({ length: 6 }, (_, i) => thread({ id: `t${i}`, weight: 3, status: "open" }));
    // top 3: 8 * (3+3+3) = 72; blend with read 72 => 72; from prev 70 => 72
    expect(deriveTension({ prevTension: 70, threads: many, tensionRead: 72, isPayoff: false })).toBe(72);
  });

  it("never evicts an unresolved weight>=4 thread when over cap", () => {
    const threads = [
      thread({ id: "keep", weight: 5, status: "open", lastTouchedTurn: 0 }),
      ...Array.from({ length: 6 }, (_, i) => thread({ id: `w${i}`, weight: 1, status: "open", lastTouchedTurn: 0 })),
    ];
    const next = mergeStoryState(state({ turn: 1, threads }), { threadUpdates: [], newThreads: [], tensionRead: 10 }, 2);
    expect(next.threads.length).toBeLessThanOrEqual(CONSTANTS.MAX_SESSION_THREADS);
    expect(next.threads.find((t) => t.id === "keep")).toBeDefined();
  });

  it("abandons (drops) an untouched low-weight open thread past ABANDON_LIMIT", () => {
    const stale = thread({ id: "old", weight: 2, status: "open", lastTouchedTurn: 0 });
    const next = mergeStoryState(state({ turn: CONSTANTS.ABANDON_LIMIT, threads: [stale] }),
      { threadUpdates: [], newThreads: [], tensionRead: 10 }, CONSTANTS.ABANDON_LIMIT + 1);
    expect(next.threads.find((t) => t.id === "old")).toBeUndefined();
  });

  it("drops a thread that has been resolved for more than 2 turns", () => {
    const done = thread({ id: "r", status: "resolved", lastTouchedTurn: 1 });
    // turn jumps 3 past last touch → resolved-linger window (2) exceeded
    const next = mergeStoryState(state({ turn: 4, threads: [done] }),
      { threadUpdates: [], newThreads: [], tensionRead: 10 }, 5);
    expect(next.threads.find((t) => t.id === "r")).toBeUndefined();
  });

  it("resets forcedPayoffTurns when last intent was not payoff", () => {
    const t = thread({ id: "t1", forcedPayoffTurns: 1, status: "escalating" });
    const next = mergeStoryState(state({ turn: 5, lastIntent: "develop", lastSpotlightId: "t1", threads: [t] }),
      { threadUpdates: [], newThreads: [], tensionRead: 30 }, 6);
    expect(next.threads.find((x) => x.id === "t1")?.forcedPayoffTurns).toBe(0);
  });
});

import { buildDirectorBlock } from "@/server/pipeline/director";
import type { NpcAgendaLite } from "@/types";

describe("runDirector consequence surfacing", () => {
  it("surfaces an eligible seed tied to the spotlight thread", () => {
    const d = runDirector(
      state({ turn: 6, beatsSincePayoff: 3, threads: [thread({ id: "t1", weight: 4, lastTouchedTurn: 6 })] }),
      [],
      [{ echo: "the cult moves", messagesUntilEcho: 0, threadId: "t1" },
       { echo: "rain starts", messagesUntilEcho: 0, threadId: "tZ" }]
    );
    expect(d.consequenceEcho).toBe("the cult moves");
  });

  it("does not surface a seed whose timer hasn't elapsed", () => {
    const d = runDirector(state({ turn: 6, threads: [thread({ id: "t1" })] }), [],
      [{ echo: "later", messagesUntilEcho: 3, threadId: "t1" }]);
    expect(d.consequenceEcho).toBeUndefined();
  });

  it("falls back to an escalating-thread seed when no spotlight match", () => {
    const threads = [
      thread({ id: "t1", status: "open", weight: 3, lastTouchedTurn: 6 }),
      thread({ id: "t2", status: "escalating", weight: 3, lastTouchedTurn: 0 }),
    ];
    const d = runDirector(
      state({ turn: 6, beatsSincePayoff: 3, threads }),
      [],
      [{ echo: "escalation echo", messagesUntilEcho: 0, threadId: "t2" },
       { echo: "other echo", messagesUntilEcho: 0, threadId: "tZ" }]
    );
    expect(d.consequenceEcho).toBe("escalation echo");
  });

  it("falls back to first eligible seed when no spotlight or escalating match", () => {
    const d = runDirector(
      state({ turn: 6, beatsSincePayoff: 3, threads: [thread({ id: "t1", lastTouchedTurn: 6 })] }),
      [],
      [{ echo: "first echo", messagesUntilEcho: 0, threadId: "tZ" },
       { echo: "second echo", messagesUntilEcho: 0, threadId: "tQ" }]
    );
    expect(d.consequenceEcho).toBe("first echo");
  });

  it("leaves consequenceEcho undefined when no seeds are provided", () => {
    const d = runDirector(
      state({ turn: 6, threads: [thread({ id: "t1" })] }),
      [],
      []
    );
    expect(d.consequenceEcho).toBeUndefined();
  });

  it("leaves consequenceEcho undefined when all seeds are ineligible", () => {
    const d = runDirector(
      state({ turn: 6, threads: [thread({ id: "t1" })] }),
      [],
      [{ echo: "not yet", messagesUntilEcho: 5, threadId: "t1" },
       { echo: "also not", messagesUntilEcho: 2, threadId: "t1" }]
    );
    expect(d.consequenceEcho).toBeUndefined();
  });

  it("existing callers with no 3rd arg continue to work (no consequenceEcho)", () => {
    const d = runDirector(state({ turn: 6, threads: [thread({ id: "t1" })] }), []);
    expect(d.consequenceEcho).toBeUndefined();
  });
});

describe("buildDirectorBlock", () => {
  const base = { phase: "rising" as const, tension: 62, intent: "escalate" as const,
    wordBudget: "120-250 words", gmInitiative: "",
    activeThreads: [] as { label: string; kind: ThreadKind }[] };

  it("never leaks internal vocab (STALE, weights, raw turn counts)", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }],
      spotlight: thread({ label: "what the informant knows", status: "escalating", weight: 4, lastTouchedTurn: 1 }) });
    expect(block).not.toMatch(/STALE|weight|turn \d|staleness/i);
  });

  it("stays under the line ceiling even with everything set (including NPC line and consequence)", () => {
    const block = buildDirectorBlock({ ...base, gmInitiative: "the rafters stir",
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }, { label: "something in the rafters", kind: "threat" }],
      spotlight: thread({ label: "what the informant knows" }),
      actingNpc: { name: "the informant", agenda: "feel out the hunter", voice: "clipped, archaic" },
      consequenceEcho: "the cult has sealed the exits" });
    expect(block.split("\n").length).toBeLessThanOrEqual(11);
  });

  it("cold start (no spotlight) still yields guidance text", () => {
    const block = buildDirectorBlock({ phase: "setup", tension: 5, intent: "develop",
      wordBudget: "100-200 words", gmInitiative: "", activeThreads: [] });
    expect(block).toMatch(/\[DIRECTOR\]/);
  });

  it("includes 'In play:' line listing active thread labels and kinds", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [
        { label: "what the informant knows", kind: "mystery" },
        { label: "something in the rafters", kind: "threat" },
      ],
      spotlight: thread({ label: "what the informant knows" }) });
    expect(block).toMatch(/In play:/);
    expect(block).toMatch(/mystery.*what the informant knows/);
    expect(block).toMatch(/threat.*something in the rafters/);
  });

  it("omits 'In play:' line when there are no active threads (cold start)", () => {
    const block = buildDirectorBlock({ phase: "setup", tension: 5, intent: "develop",
      wordBudget: "100-200 words", gmInitiative: "", activeThreads: [] });
    expect(block).not.toMatch(/In play:/);
  });

  it("includes NPC acting line when actingNpc is set", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }],
      spotlight: thread({ label: "what the informant knows" }),
      actingNpc: { name: "the informant", agenda: "feel out the hunter", voice: "clipped, archaic" } });
    expect(block).toMatch(/the informant acts on their own aim now: feel out the hunter/);
    expect(block).toMatch(/their voice: clipped, archaic/);
  });

  it("omits NPC acting line when actingNpc is not set", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }],
      spotlight: thread({ label: "what the informant knows" }) });
    expect(block).not.toMatch(/acts on their own aim/);
  });

  it("includes consequence line when consequenceEcho is set", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }],
      spotlight: thread({ label: "what the informant knows" }),
      consequenceEcho: "the cult has sealed the exits" });
    expect(block).toMatch(/Because of what came before: the cult has sealed the exits\./);
  });

  it("omits consequence line when consequenceEcho is not set", () => {
    const block = buildDirectorBlock({ ...base,
      activeThreads: [{ label: "what the informant knows", kind: "mystery" }],
      spotlight: thread({ label: "what the informant knows" }) });
    expect(block).not.toMatch(/Because of what came before/);
  });
});

import { stripControlEcho } from "@/server/pipeline/director";

describe("stripControlEcho", () => {
  it("removes meta notes on their own line but keeps inline parentheses", () => {
    // Shape captured from a local gemma model.
    const input =
      "The hatch creaks open (barely).\n\n// (Attempting to overcome Roric's physical grip and the weight of the bolt)\n\n(Rolling to keep pace)";
    expect(stripControlEcho(input)).toBe("The hatch creaks open (barely).");
  });

  it("removes marker leftovers stuck to the prose", () => {
    // Playtest (e4b): "...the diagnostic readout flickers uselessly. :DC{N/A}"
    expect(stripControlEcho("The readout flickers uselessly. :DC{N/A}")).toBe("The readout flickers uselessly.");
    expect(stripControlEcho("You brace yourself:DC12 and pull.")).toBe("You brace yourself and pull.");
  });

  it("removes a trailing [DIRECTOR] block, preserving the narration with no trailing blank lines", () => {
    const input =
      "The rain drums against the shutters. The stranger does not flinch.\n\n[DIRECTOR]\nThe tension rises (18/100). The stranger's lack of hesitation suggests certainty.";
    const result = stripControlEcho(input);
    expect(result).toBe("The rain drums against the shutters. The stranger does not flinch.");
  });

  it("removes a mid-text [DIRECTOR] block bounded by blank lines but keeps following prose", () => {
    const input =
      "First paragraph of narration.\n\n[DIRECTOR]\nSome director meta commentary.\n\nSecond paragraph continues the story.";
    const result = stripControlEcho(input);
    expect(result).toBe("First paragraph of narration.\n\nSecond paragraph continues the story.");
  });

  it("is a no-op when there are no control tokens", () => {
    const plain = "The fire crackles. Smoke curls toward the ceiling. Nothing stirs in the dark.";
    expect(stripControlEcho(plain)).toBe(plain);
  });

  it("removes a stray [STATE_UPDATE_END] token on its own line", () => {
    const input = "The hero draws their sword.\n[STATE_UPDATE_END]\nThe battle is joined.";
    const result = stripControlEcho(input);
    expect(result).toBe("The hero draws their sword.\nThe battle is joined.");
  });

  it("removes a stray [STATE_UPDATE] token on its own line", () => {
    const input = "The hero draws their sword.\n[STATE_UPDATE]\nThe battle is joined.";
    const result = stripControlEcho(input);
    expect(result).toBe("The hero draws their sword.\nThe battle is joined.");
  });

  it("removes a stray [/DIRECTOR] token on its own line", () => {
    const input = "Good narration here.\n[/DIRECTOR]\nMore narration.";
    const result = stripControlEcho(input);
    expect(result).toBe("Good narration here.\nMore narration.");
  });

  it("is case-insensitive on the [DIRECTOR] tag", () => {
    const input = "Some narration.\n\n[director]\nlower case director block content.";
    const result = stripControlEcho(input);
    expect(result).toBe("Some narration.");
  });

  it("handles [DIRECTOR] block at the very start of the string", () => {
    const input = "[DIRECTOR]\nSome meta.\n\nActual narration here.";
    const result = stripControlEcho(input);
    expect(result).toBe("Actual narration here.");
  });

  it("returns empty string if the entire text is a [DIRECTOR] block", () => {
    const input = "[DIRECTOR]\nOnly meta here.";
    const result = stripControlEcho(input);
    expect(result).toBe("");
  });
});

import { reconcileCampaignThreads } from "@/server/pipeline/director";
import type { CampaignStoryState } from "@/types";
type ST = StoryThread;

const makeSession = (threads: ST[]): SessionState => ({
  ...coldStartState(),
  threads,
});

const makeSessionThread = (over: Partial<ST> = {}): ST => ({
  id: crypto.randomUUID(),
  label: "the ancient mystery",
  kind: "mystery",
  status: "open",
  weight: 5,
  scope: "session",
  introducedTurn: 1,
  lastTouchedTurn: 5,
  touchedCount: 3,
  forcedPayoffTurns: 0,
  ...over,
});

describe("reconcileCampaignThreads", () => {
  it("seeds one campaign thread per plotHook when campaign is empty", () => {
    const result = reconcileCampaignThreads(
      null,
      makeSession([]),
      ["Find the lost artifact", "Defeat the dragon"],
      "sess-1"
    );
    expect(result.campaign.version).toBe(1);
    expect(result.campaign.threads).toHaveLength(2);
    expect(result.campaign.threads[0].label).toBe("Find the lost artifact");
    expect(result.campaign.threads[0].kind).toBe("goal");
    expect(result.campaign.threads[0].status).toBe("open");
    expect(result.campaign.threads[0].weight).toBe(3);
    expect(result.campaign.threads[0].introducedSession).toBe("sess-1");
    expect(result.campaign.threads[0].lastTouchedSession).toBe("sess-1");
    expect(result.campaign.threads[0].history).toEqual([]);
    expect(result.promotions).toHaveLength(0);
  });

  it("seeds from plotHooks when campaign has empty threads array", () => {
    const emptyCampaign: CampaignStoryState = { version: 1, threads: [] };
    const result = reconcileCampaignThreads(
      emptyCampaign,
      makeSession([]),
      ["Uncover the conspiracy"],
      "sess-2"
    );
    expect(result.campaign.threads).toHaveLength(1);
    expect(result.campaign.threads[0].label).toBe("Uncover the conspiracy");
  });

  it("does not reseed from plotHooks when campaign already has threads", () => {
    const existingCampaign: CampaignStoryState = {
      version: 1,
      threads: [{
        id: "existing-id",
        label: "Existing arc",
        kind: "goal",
        status: "open",
        weight: 3,
        introducedSession: "sess-0",
        lastTouchedSession: "sess-0",
        history: [],
      }],
    };
    const result = reconcileCampaignThreads(
      existingCampaign,
      makeSession([]),
      ["New hook"],
      "sess-1"
    );
    // Should NOT seed from plotHooks, only 1 thread remains
    expect(result.campaign.threads).toHaveLength(1);
    expect(result.campaign.threads[0].id).toBe("existing-id");
  });

  it("promotes a qualifying session thread (weight>=PROMOTE_WEIGHT, touchedCount>=PROMOTE_TOUCHES, scope=session, no campaignThreadId)", () => {
    const sessionThread = makeSessionThread({
      id: "sess-thread-1",
      label: "The Shadow Cult",
      kind: "threat",
      weight: 5,
      touchedCount: 3,
      scope: "session",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [] },
      makeSession([sessionThread]),
      [],
      "sess-3"
    );
    // Empty threads => no seeding (plotHooks empty), but should promote
    expect(result.campaign.threads).toHaveLength(1);
    expect(result.campaign.threads[0].label).toBe("The Shadow Cult");
    expect(result.campaign.threads[0].kind).toBe("threat");
    expect(result.campaign.threads[0].status).toBe("open");
    expect(result.campaign.threads[0].introducedSession).toBe("sess-3");
    expect(result.campaign.threads[0].lastTouchedSession).toBe("sess-3");
    expect(result.promotions).toHaveLength(1);
    expect(result.promotions[0].sessionThreadId).toBe("sess-thread-1");
    expect(result.promotions[0].campaignThreadId).toBe(result.campaign.threads[0].id);
  });

  it("does NOT promote a session thread below PROMOTE_WEIGHT threshold", () => {
    const sessionThread = makeSessionThread({
      weight: 3, // below PROMOTE_WEIGHT=4
      touchedCount: 5,
      scope: "session",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [{ id: "existing", label: "existing", kind: "goal", status: "open", weight: 3, introducedSession: "s0", lastTouchedSession: "s0", history: [] }] },
      makeSession([sessionThread]),
      [],
      "sess-4"
    );
    expect(result.promotions).toHaveLength(0);
  });

  it("does NOT promote a session thread below PROMOTE_TOUCHES threshold", () => {
    const sessionThread = makeSessionThread({
      weight: 5,
      touchedCount: 2, // below PROMOTE_TOUCHES=3
      scope: "session",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [{ id: "existing", label: "existing", kind: "goal", status: "open", weight: 3, introducedSession: "s0", lastTouchedSession: "s0", history: [] }] },
      makeSession([sessionThread]),
      [],
      "sess-5"
    );
    expect(result.promotions).toHaveLength(0);
  });

  it("does NOT promote a campaign-scoped session thread", () => {
    const sessionThread = makeSessionThread({
      weight: 5,
      touchedCount: 5,
      scope: "campaign", // already campaign-scoped
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [{ id: "existing", label: "existing", kind: "goal", status: "open", weight: 3, introducedSession: "s0", lastTouchedSession: "s0", history: [] }] },
      makeSession([sessionThread]),
      [],
      "sess-6"
    );
    expect(result.promotions).toHaveLength(0);
  });

  it("deduplicates: matches an existing campaign thread by normalized label instead of creating a duplicate", () => {
    const existingCampaignThread = {
      id: "campaign-t1",
      label: "The Shadow Cult",
      kind: "threat" as const,
      status: "open" as const,
      weight: 3 as const,
      introducedSession: "sess-0",
      lastTouchedSession: "sess-0",
      history: [],
    };
    const sessionThread = makeSessionThread({
      id: "sess-thread-1",
      label: "  the shadow cult  ", // normalized matches
      kind: "threat",
      weight: 5,
      touchedCount: 4,
      scope: "session",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [existingCampaignThread] },
      makeSession([sessionThread]),
      [],
      "sess-7"
    );
    // No new campaign thread created (still 1)
    expect(result.campaign.threads).toHaveLength(1);
    // But promotion is still recorded pointing to the existing campaign thread
    expect(result.promotions).toHaveLength(1);
    expect(result.promotions[0].sessionThreadId).toBe("sess-thread-1");
    expect(result.promotions[0].campaignThreadId).toBe("campaign-t1");
  });

  it("mirrors resolved status from a linked session thread onto the campaign thread and appends history", () => {
    const campaignThread = {
      id: "campaign-t1",
      label: "The Ancient Mystery",
      kind: "mystery" as const,
      status: "open" as const,
      weight: 3 as const,
      introducedSession: "sess-0",
      lastTouchedSession: "sess-0",
      history: [],
    };
    const sessionThread = makeSessionThread({
      id: "sess-thread-1",
      label: "The Ancient Mystery",
      kind: "mystery",
      weight: 4,
      touchedCount: 5,
      scope: "campaign",
      status: "resolved",
      campaignThreadId: "campaign-t1",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [campaignThread] },
      makeSession([sessionThread]),
      [],
      "sess-8"
    );
    const updated = result.campaign.threads.find((t) => t.id === "campaign-t1");
    expect(updated?.status).toBe("resolved");
    expect(updated?.history).toHaveLength(1);
    expect(updated?.history[0]).toContain("sess-8");
    expect(updated?.history[0]).toContain("resolved");
  });

  it("does not append history when linked session thread status is unchanged", () => {
    const campaignThread = {
      id: "campaign-t1",
      label: "The Ancient Mystery",
      kind: "mystery" as const,
      status: "open" as const,
      weight: 3 as const,
      introducedSession: "sess-0",
      lastTouchedSession: "sess-0",
      history: [],
    };
    const sessionThread = makeSessionThread({
      id: "sess-thread-1",
      label: "The Ancient Mystery",
      kind: "mystery",
      weight: 4,
      touchedCount: 5,
      scope: "campaign",
      status: "open", // same as campaign thread status
      campaignThreadId: "campaign-t1",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [campaignThread] },
      makeSession([sessionThread]),
      [],
      "sess-9"
    );
    const updated = result.campaign.threads.find((t) => t.id === "campaign-t1");
    expect(updated?.status).toBe("open");
    expect(updated?.history).toHaveLength(0);
  });

  it("caps history at 8 entries, dropping oldest", () => {
    const fullHistory = Array.from({ length: 8 }, (_, i) => `old entry ${i}`);
    const campaignThread = {
      id: "campaign-t1",
      label: "The Ancient Mystery",
      kind: "mystery" as const,
      status: "open" as const,
      weight: 3 as const,
      introducedSession: "sess-0",
      lastTouchedSession: "sess-0",
      history: fullHistory,
    };
    const sessionThread = makeSessionThread({
      id: "sess-thread-1",
      label: "The Ancient Mystery",
      status: "resolved",
      campaignThreadId: "campaign-t1",
      scope: "campaign",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: [campaignThread] },
      makeSession([sessionThread]),
      [],
      "sess-10"
    );
    const updated = result.campaign.threads.find((t) => t.id === "campaign-t1");
    expect(updated?.history).toHaveLength(8);
    // The oldest entry should be dropped (old entry 0), newest appended
    expect(updated?.history[0]).toBe("old entry 1");
    expect(updated?.history[7]).toContain("resolved");
  });

  it("caps campaign threads at MAX_CAMPAIGN_THREADS, dropping lowest-weight resolved first", () => {
    // Fill to MAX with resolved low-weight threads
    const maxThreads = Array.from({ length: CONSTANTS.MAX_CAMPAIGN_THREADS }, (_, i) => ({
      id: `c${i}`,
      label: `thread ${i}`,
      kind: "goal" as const,
      status: "resolved" as const,
      weight: 1 as const,
      introducedSession: "s0",
      lastTouchedSession: "s0",
      history: [],
    }));
    // Add a qualifying session thread to promote — this will exceed the cap
    const sessionThread = makeSessionThread({
      id: "new-sess",
      label: "Brand New Arc",
      kind: "promise",
      weight: 5,
      touchedCount: 4,
      scope: "session",
    });
    const result = reconcileCampaignThreads(
      { version: 1, threads: maxThreads },
      makeSession([sessionThread]),
      [],
      "sess-cap"
    );
    expect(result.campaign.threads.length).toBeLessThanOrEqual(CONSTANTS.MAX_CAMPAIGN_THREADS);
    // The new promoted thread should be present
    expect(result.campaign.threads.find((t) => t.label === "Brand New Arc")).toBeDefined();
  });

  it("is pure — does not mutate input campaign or session", () => {
    const campaignIn: CampaignStoryState = {
      version: 1,
      threads: [{
        id: "c1",
        label: "Existing",
        kind: "goal",
        status: "open",
        weight: 3,
        introducedSession: "s0",
        lastTouchedSession: "s0",
        history: [],
      }],
    };
    const sessionIn = makeSession([makeSessionThread({ id: "st1", weight: 5, touchedCount: 3, scope: "session" })]);
    const origThreadCount = campaignIn.threads.length;
    const origSessionThreads = [...sessionIn.threads];

    reconcileCampaignThreads(campaignIn, sessionIn, [], "sess-pure");

    // Input campaign must not be mutated
    expect(campaignIn.threads.length).toBe(origThreadCount);
    // Input session must not be mutated
    expect(sessionIn.threads).toEqual(origSessionThreads);
  });
});

describe("runDirector NPC initiative", () => {
  it("hands initiative to the NPC whose agenda targets the spotlight thread", () => {
    const sp = thread({ id: "t1", status: "open", weight: 4, lastTouchedTurn: 5 });
    const npcs: NpcAgendaLite[] = [
      { id: "n1", name: "the informant", agenda: "feel out the hunter", agendaThreadId: "t1", lastActedTurn: 0, speechPattern: "clipped, archaic" },
      { id: "n2", name: "the barkeep", agenda: "keep the peace", agendaThreadId: "t9", lastActedTurn: 0 },
    ];
    const d = runDirector(state({ turn: 10, beatsSincePayoff: 3, threads: [sp] }), npcs);
    expect(d.actingNpc?.name).toBe("the informant");
    expect(d.actingNpc?.agenda).toBe("feel out the hunter");
  });
  it("respects NPC_ACT_GAP (an NPC that acted last turn does not act again)", () => {
    const sp = thread({ id: "t1", status: "open", weight: 4, lastTouchedTurn: 5 });
    const npcs: NpcAgendaLite[] = [
      { id: "n1", name: "the informant", agenda: "x", agendaThreadId: "t1", lastActedTurn: 10 }, // acted this turn already
    ];
    const d = runDirector(state({ turn: 10, threads: [sp] }), npcs);
    expect(d.actingNpc).toBeUndefined();
  });
  it("no acting NPC when none targets the spotlight", () => {
    const d = runDirector(state({ turn: 10, threads: [thread({ id: "t1" })] }),
      [{ id: "n1", name: "x", agendaThreadId: "tZ", lastActedTurn: 0 }]);
    expect(d.actingNpc).toBeUndefined();
  });
});

describe("mergeStoryState thread field normalization", () => {
  it("ignores a status that is not a ThreadStatus but still counts the touch", () => {
    const prev = state({ turn: 4, threads: [thread({ id: "t1", status: "open", touchedCount: 1 })] });
    const next = mergeStoryState(prev, {
      threadUpdates: [{ id: "t1", status: "ongoing" as never }], newThreads: [], tensionRead: 50,
    }, 5);
    const t = next.threads.find((x) => x.id === "t1")!;
    expect(t.status).toBe("open");
    expect(t.touchedCount).toBe(2);
  });

  it("stores an unknown kind as goal and a fractional weight as an integer", () => {
    const next = mergeStoryState(coldStartState(), {
      threadUpdates: [], newThreads: [{ label: "A strange ledger", kind: "quest" as never, weight: 2.4 }], tensionRead: 50,
    }, 1);
    expect(next.threads).toHaveLength(1);
    expect(next.threads[0].kind).toBe("goal");
    expect(next.threads[0].weight).toBe(2);
  });
});
