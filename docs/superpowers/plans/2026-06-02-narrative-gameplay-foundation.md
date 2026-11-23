# Narrative Gameplay Foundation (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the already-implemented prose/correctness fixes, then replace the keyword-tension/random-beat director with a deterministic, story-aware **Structure** director driven by a bounded `storyState` (threads + arc) and a combined fire-and-forget narrative-state extractor.

**Architecture:** A single source of truth `storyState` (JSON column on `sessions`/`campaigns`) is *read* by a pure deterministic director (`director.ts`) before the narrator and *written* by one fire-and-forget `extractNarrativeState` call after the turn. The director emits one `[DIRECTOR]` prompt block (replacing the old arc/pacing/GM-initiative blocks). This plan implements the **Structure** layer only (story key of the extractor); NPC and Agency layers are later plans. The `gm_event` scene-image trigger is preserved by keeping `gmInitiative` string-typed.

**Tech Stack:** TypeScript (strict), Drizzle ORM + better-sqlite3 (SQLite), tRPC, Vitest, Next.js 15. Local Ollama (`gemma3:12b`).

**Spec:** `docs/superpowers/specs/2026-06-02-story-aware-director-design.md` (this plan = §14 Phases 0–1).

---

## Scope of this plan

- **Phase 0** — verify the C1–C8 prose/correctness fixes are green and commit them as the foundation.
- **Phase 1** — Structure layer: `storyState` types + schema, `director.ts` (constants, `runDirector`, `mergeStoryState`, `buildDirectorBlock`, ported phase machine), `narrativeExtractor.ts` (`extractNarrativeState`, story key), `promptBuilder` `[DIRECTOR]` block, orchestrator wiring, `gm_event` rewire + regression test, removal of the old arc/pacing calls.

**Out of scope (later plans):** NPC agendas/initiative (Phase 2), thread-linked consequences (Phase 3), cross-layer tuning (Phase 4). In this plan `extractNarrativeState` returns only the `story` key; `npc`/`world` keys arrive in later plans.

## File Structure (created / modified)

| File | Responsibility |
|---|---|
| `types/index.ts` (modify) | `StoryThread`, `ThreadKind`, `ThreadStatus`, `ArcPhase`, `SessionStoryState`, `CampaignStoryThread`, `CampaignStoryState`, `DirectorDecision`, `DirectorIntent`. |
| `server/db/schema.ts` (modify) | `sessions.storyState`, `campaigns.storyState` JSON columns. |
| `server/pipeline/director.ts` (create) | Constants + pure functions: `runDirector`, `mergeStoryState`, `buildDirectorBlock`, `deriveTension`, `advancePhase`, `coldStartState`. No I/O. |
| `server/pipeline/narrativeExtractor.ts` (create) | `extractNarrativeState` (LLM call) + `parseNarrativeState` (pure parse). |
| `server/pipeline/promptBuilder.ts` (modify) | Replace arc/pacing/GM blocks with `[DIRECTOR]`; remove `getWordBudget`; `PromptContext.director`. |
| `server/pipeline/orchestrator.ts` (modify) | Wire director (before) + extractor (after); persist `lastIntent`/`lastSpotlightId`; rewire `gmInitiative` (string) to image; increment `turn`; remove old arc/pacing calls. |
| `tests/pipeline/director.test.ts` (create) | Unit tests for all `director.ts` pure functions. |
| `tests/pipeline/narrativeExtractor.test.ts` (create) | Unit tests for `parseNarrativeState`. |
| `tests/pipeline/gmEventTrigger.test.ts` (create) | Regression: non-empty director `gmInitiative` still triggers `gm_event`. |
| `scripts/play-loop.test.mts` (modify, Phase 1 end) | Dump `storyState` per turn; assert a thread introduced + a payoff within 6 turns. |

**Reference skills:** @superpowers:test-driven-development, @superpowers:verification-before-completion.

**Branch:** create `feat/narrative-director` before Task 0.1 (the working tree has unrelated changes; keep this work isolated). Commit frequently per task.

---

## Phase 0 — Lock the prose/correctness fixes

### Task 0.1: Verify C1–C8 are green and commit the foundation

**Files:** (already-modified, uncommitted) `server/pipeline/orchestrator.ts`, `diceResolver.ts`, `stateParser.ts`, `promptBuilder.ts`, `scripts/play-loop.test.mts`.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/narrative-director
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: all pass, 1 skipped (the env-gated harness). Note the pass count (baseline ~266).

- [ ] **Step 4: Run one live harness play (sanity, optional if Ollama running)**

Run: `PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/play-loop.test.mts`
Expected: 6 turns, `leaks=0`, no empty turns. (If Ollama isn't running, skip — not a blocker for Phase 0.)

- [ ] **Step 5: Commit the C1–C8 fixes as the foundation**

```bash
git add server/pipeline/orchestrator.ts server/pipeline/diceResolver.ts server/pipeline/stateParser.ts server/pipeline/promptBuilder.ts scripts/play-loop.test.mts
git commit -m "fix(pipeline): empty/short-turn guards, snippet-join grammar, dedup, STATE_UPDATE format, damage targeting, genre-bleed removal (C1-C8)"
```

---

## Phase 1 — Structure director

### Task 1.1: Story-state and director types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the types**

Append to `types/index.ts`:

```ts
export type ThreadKind = "mystery" | "threat" | "promise" | "goal";
export type ThreadStatus = "open" | "escalating" | "resolved" | "abandoned";

export interface StoryThread {
  id: string;
  label: string;
  kind: ThreadKind;
  status: ThreadStatus;
  weight: 1 | 2 | 3 | 4 | 5;
  scope: "session" | "campaign";
  introducedTurn: number;
  lastTouchedTurn: number;
  touchedCount: number;
  forcedPayoffTurns: number;
  ownerNpcId?: string;        // wired in Phase 2
  notes?: string;
  campaignThreadId?: string;
}

export type ArcPhase = "setup" | "rising" | "climax" | "falling" | "resolution";

export interface SessionStoryState {
  version: 1;
  phase: ArcPhase;
  tension: number;
  turnsInPhase: number;
  beatsSincePayoff: number;
  turn: number;
  lastGmInitiativeTurn: number;
  lastIntent?: DirectorIntent;
  lastSpotlightId?: string;
  threads: StoryThread[];
}

export interface CampaignStoryThread {
  id: string;
  label: string;
  kind: ThreadKind;
  status: ThreadStatus;
  weight: 1 | 2 | 3 | 4 | 5;
  introducedSession: string;
  lastTouchedSession: string;
  notes?: string;
  history: string[];
}

export interface CampaignStoryState {
  version: 1;
  threads: CampaignStoryThread[];
}

export type DirectorIntent = "develop" | "escalate" | "payoff" | "breathe";

export interface DirectorDecision {
  phase: ArcPhase;
  tension: number;
  intent: DirectorIntent;
  wordBudget: string;
  spotlight?: StoryThread;
  gmInitiative: string; // "" when none — MUST stay string for the gm_event image trigger
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): story-state + director types"
```

### Task 1.2: Schema columns + migration

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the columns**

In `server/db/schema.ts`, import the types and add to the `sessions` table definition (near `narrativeArc`):

```ts
storyState: text("story_state", { mode: "json" }).$type<import("@/types").SessionStoryState | null>(),
```

Add to the `campaigns` table definition (near `campaignJournal`):

```ts
storyState: text("story_state", { mode: "json" }).$type<import("@/types").CampaignStoryState | null>(),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new migration file under the drizzle migrations dir adding both `story_state` columns.

- [ ] **Step 3: Apply it**

Run: `npx drizzle-kit push`
Expected: columns added to `./data/rpg.db`, no errors.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts drizzle/
git commit -m "feat(db): add storyState columns to sessions and campaigns"
```

### Task 1.3: Director constants + `coldStartState` + tension/phase helpers

**Files:**
- Create: `server/pipeline/director.ts`
- Test: `tests/pipeline/director.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/pipeline/director.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coldStartState, deriveTension, advancePhase, CONSTANTS } from "@/server/pipeline/director";
import type { StoryThread } from "@/types";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: FAIL — cannot import from `director.ts` (not created).

- [ ] **Step 3: Implement the helpers**

Create `server/pipeline/director.ts`:

```ts
import type { ArcPhase, SessionStoryState, StoryThread } from "@/types";

export const CONSTANTS = {
  MAX_SESSION_THREADS: 6,
  STALE_LIMIT: 4,
  ESCALATE_LIMIT: 3,
  MAX_FORCED_PAYOFF_TURNS: 2,
  ABANDON_LIMIT: 10,
  GM_INITIATIVE_GAP: 2,
  MAX_NEW_THREADS_PER_TURN: 2,
  TENSION_MAX_DELTA: 12,
  PLAYER_BONUS: 6,
  NOTES_MAX: 160,
  MIN_TURNS_IN_PHASE: 3,
} as const;

export function coldStartState(): SessionStoryState {
  return {
    version: 1, phase: "setup", tension: 2, turnsInPhase: 0,
    beatsSincePayoff: 0, turn: 0, lastGmInitiativeTurn: -CONSTANTS.GM_INITIATIVE_GAP,
    threads: [],
  };
}

export function deriveTension(args: {
  prevTension: number; threads: StoryThread[]; tensionRead: number; isPayoff: boolean;
}): number {
  const { prevTension, threads, tensionRead, isPayoff } = args;
  const active = threads.filter((t) => t.status === "open" || t.status === "escalating");
  const fromThreads = Math.min(100, 8 * active.reduce(
    (sum, t) => sum + t.weight * (t.status === "escalating" ? 2 : 1), 0));
  const read = Math.max(0, Math.min(100, Number.isFinite(tensionRead) ? tensionRead : fromThreads));
  let target = Math.round(0.5 * fromThreads + 0.5 * read);
  if (isPayoff) target -= 15;
  target = Math.max(0, Math.min(100, target));
  const delta = Math.max(-CONSTANTS.TENSION_MAX_DELTA,
    Math.min(CONSTANTS.TENSION_MAX_DELTA, target - prevTension));
  return Math.max(0, Math.min(100, prevTension + delta));
}

export function advancePhase(arc: { phase: ArcPhase; tension: number; turnsInPhase: number }):
  { phase: ArcPhase; turnsInPhase: number } {
  const { phase, tension, turnsInPhase } = arc;
  const turns = turnsInPhase + 1;
  if (turns < CONSTANTS.MIN_TURNS_IN_PHASE) return { phase, turnsInPhase: turns };
  let next: ArcPhase = phase;
  switch (phase) {
    case "setup": if (tension >= 40) next = "rising"; break;
    case "rising": if (tension >= 75) next = "climax"; else if (tension <= 20) next = "falling"; break;
    case "climax": if (tension <= 20) next = "falling"; break;
    case "falling": if (tension <= 5) next = "resolution"; else if (tension >= 75) next = "rising"; break;
    case "resolution": if (tension >= 40) next = "setup"; break;
  }
  return { phase: next, turnsInPhase: next !== phase ? 0 : turns };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: PASS (3 describes).

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/director.ts tests/pipeline/director.test.ts
git commit -m "feat(director): constants, coldStart, tension + phase helpers"
```

### Task 1.4: `runDirector` (spotlight + intent ladder + word budget + GM initiative)

**Files:**
- Modify: `server/pipeline/director.ts`
- Modify: `tests/pipeline/director.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/pipeline/director.test.ts`:

```ts
import { runDirector } from "@/server/pipeline/director";
import { coldStartState as cold } from "@/server/pipeline/director";

const state = (over: Partial<import("@/types").SessionStoryState> = {}) => ({ ...cold(), ...over });

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

  it("gives the player-engaged thread the spotlight via PLAYER_BONUS", () => {
    const d = runDirector(state({ turn: 8, beatsSincePayoff: 3, threads: [
      thread({ id: "stale", weight: 3, lastTouchedTurn: 1 }),
      thread({ id: "fresh", weight: 3, lastTouchedTurn: 8 }), // touched this turn → bonus
    ] }));
    expect(d.spotlight?.id).toBe("fresh");
  });

  it("fires gmInitiative (string) when a thread is very stale and the gap has passed", () => {
    const d = runDirector(state({ turn: 12, lastGmInitiativeTurn: 0, beatsSincePayoff: 3,
      threads: [thread({ status: "open", weight: 4, lastTouchedTurn: 3 })] })); // staleness 9 >= STALE+2
    expect(d.gmInitiative.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: FAIL — `runDirector` not exported.

- [ ] **Step 3: Implement `runDirector`**

Add to `server/pipeline/director.ts`:

```ts
import type { DirectorDecision, DirectorIntent } from "@/types";

function wordBudgetFor(intent: DirectorIntent, phase: ArcPhase): string {
  if (intent === "payoff" || phase === "climax") return "150-300 words";
  if (intent === "escalate") return "120-250 words";
  return "100-200 words";
}

export function runDirector(s: SessionStoryState): DirectorDecision {
  const active = s.threads.filter((t) => t.status === "open" || t.status === "escalating");

  // Spotlight: weight*(1+staleness) + player bonus; ties -> weight, then age.
  let spotlight: StoryThread | undefined;
  let best = -Infinity;
  for (const t of active) {
    const staleness = s.turn - t.lastTouchedTurn;
    const bonus = t.lastTouchedTurn === s.turn ? CONSTANTS.PLAYER_BONUS : 0;
    const priority = t.weight * (1 + staleness) + bonus;
    if (priority > best ||
        (priority === best && spotlight &&
          (t.weight > spotlight.weight ||
           (t.weight === spotlight.weight && t.introducedTurn < spotlight.introducedTurn)))) {
      best = priority; spotlight = t;
    }
  }

  const staleness = spotlight ? s.turn - spotlight.lastTouchedTurn : 0;
  const maxStaleness = active.reduce((m, t) => Math.max(m, s.turn - t.lastTouchedTurn), 0);

  // Intent ladder — develop is the default.
  let intent: DirectorIntent = "develop";
  if (spotlight && spotlight.status === "escalating" && staleness >= CONSTANTS.ESCALATE_LIMIT) intent = "payoff";
  else if (spotlight && s.phase === "climax" && spotlight.weight >= 4) intent = "payoff";
  else if (spotlight && staleness >= CONSTANTS.STALE_LIMIT && s.beatsSincePayoff >= 2) intent = "escalate";
  else if (s.beatsSincePayoff <= 1) intent = "breathe";

  // Story-aware GM initiative with min-gap.
  let gmInitiative = "";
  if (maxStaleness >= CONSTANTS.STALE_LIMIT + 2 &&
      s.turn - s.lastGmInitiativeTurn >= CONSTANTS.GM_INITIATIVE_GAP) {
    const stalest = active.reduce((a, b) =>
      (s.turn - a.lastTouchedTurn) >= (s.turn - b.lastTouchedTurn) ? a : b, active[0]);
    if (stalest) gmInitiative = `A complication tied to "${stalest.label}" intrudes on the scene.`;
  }

  return {
    phase: s.phase, tension: s.tension, intent,
    wordBudget: wordBudgetFor(intent, s.phase), spotlight, gmInitiative,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/director.ts tests/pipeline/director.test.ts
git commit -m "feat(director): runDirector — spotlight, intent ladder, word budget, GM initiative"
```

### Task 1.5: `mergeStoryState` (apply updates, dedupe/cap, forced-payoff, aging, tension, phase)

**Files:**
- Modify: `server/pipeline/director.ts`
- Modify: `tests/pipeline/director.test.ts`

- [ ] **Step 1: Add failing tests** — cover: applying a status/notes update by id; adding a new thread (capped at `MAX_NEW_THREADS_PER_TURN`, deduped by normalized label); `beatsSincePayoff` reset on a `resolved`; forced-payoff auto-resolve after `MAX_FORCED_PAYOFF_TURNS` when `lastIntent==="payoff"` on `lastSpotlightId`; aging an untouched low-weight thread to `abandoned`; eviction order protecting `weight>=4`; tension via `deriveTension`; phase via `advancePhase`.

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: FAIL — `mergeStoryState` not exported.

- [ ] **Step 3: Implement `mergeStoryState`** in `director.ts`. Signature: `mergeStoryState(prev: SessionStoryState, ex: { threadUpdates: {id:string; status?: ThreadStatus; notes?: string}[]; newThreads: {label:string; kind:ThreadKind; weight:number; notes?:string}[]; tensionRead: number }, turn: number): SessionStoryState`. Implement the steps from spec §6.1/§7.B in order: (1) clone threads; apply updates by id then case-insensitive label, set status/notes (truncate `NOTES_MAX`), `lastTouchedTurn=turn`, `touchedCount++`; (2) forced-payoff: if `prev.lastIntent==="payoff"`, find `prev.lastSpotlightId` thread, `forcedPayoffTurns++`, and if `>= MAX_FORCED_PAYOFF_TURNS` and not resolved → set `resolved`; reset `forcedPayoffTurns=0` on threads when `prev.lastIntent!=="payoff"`; (3) add up to `MAX_NEW_THREADS_PER_TURN` new threads, skipping normalized-label dups, with `crypto.randomUUID()` ids; (4) `beatsSincePayoff` = 0 if any became `resolved` this turn else `prev+1`; drop threads `resolved` for >2 turns; (5) age open weight≤2 untouched ≥`ABANDON_LIMIT` → drop; (6) if active > `MAX_SESSION_THREADS`, evict in order abandoned→resolved→lowest weight→stalest, never an unresolved `weight>=4`; (7) `tension = deriveTension(...)`; (8) `{phase,turnsInPhase} = advancePhase(...)`. Return the new `SessionStoryState` (preserve `turn`, set by caller; here set `turn`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pipeline/director.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/director.ts tests/pipeline/director.test.ts
git commit -m "feat(director): mergeStoryState — updates, dedupe/cap, forced-payoff, aging, tension, phase"
```

### Task 1.6: `buildDirectorBlock` (human-facing, no internal vocab, ceiling)

**Files:**
- Modify: `server/pipeline/director.ts`
- Modify: `tests/pipeline/director.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { buildDirectorBlock } from "@/server/pipeline/director";

describe("buildDirectorBlock", () => {
  const base = { phase: "rising" as const, tension: 62, intent: "escalate" as const,
    wordBudget: "120-250 words", gmInitiative: "" };

  it("never leaks internal vocab (STALE, weights, raw turn counts)", () => {
    const block = buildDirectorBlock({ ...base,
      spotlight: thread({ label: "what the informant knows", status: "escalating", weight: 4, lastTouchedTurn: 1 }) });
    expect(block).not.toMatch(/STALE|weight|turn \d|staleness/i);
  });

  it("stays under the line ceiling even with everything set", () => {
    const block = buildDirectorBlock({ ...base, gmInitiative: "the rafters stir",
      spotlight: thread({ label: "what the informant knows" }) });
    expect(block.split("\n").length).toBeLessThanOrEqual(6);
  });

  it("cold start (no spotlight) still yields guidance text", () => {
    const block = buildDirectorBlock({ phase: "setup", tension: 5, intent: "develop",
      wordBudget: "100-200 words", gmInitiative: "" });
    expect(block).toMatch(/\[DIRECTOR\]/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `buildDirectorBlock` not exported.

- [ ] **Step 3: Implement** `buildDirectorBlock(decision: DirectorDecision): string` per spec §8. Emit `[DIRECTOR]`, a one-line phase+tension summary, an "In play:" line listing thread labels+kinds (NO weights/turns/STALE), a one-sentence directive keyed off `intent` naming the spotlight label, and (only if `gmInitiative !== ""`) one complication line. Keep ≤6 lines.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/director.ts tests/pipeline/director.test.ts
git commit -m "feat(director): buildDirectorBlock — human-facing block, no internal vocab, capped"
```

### Task 1.7: `extractNarrativeState` + `parseNarrativeState`

**Files:**
- Create: `server/pipeline/narrativeExtractor.ts`
- Test: `tests/pipeline/narrativeExtractor.test.ts`

- [ ] **Step 1: Write failing tests for the pure parser**

```ts
import { describe, it, expect } from "vitest";
import { parseNarrativeState } from "@/server/pipeline/narrativeExtractor";

describe("parseNarrativeState", () => {
  it("extracts the story key from a fenced/noisy LLM response", () => {
    const raw = 'sure!\n```json\n{"story":{"threadUpdates":[{"id":"t1","status":"escalating"}],"newThreads":[],"tensionRead":55}}\n```';
    const r = parseNarrativeState(raw);
    expect(r.story?.tensionRead).toBe(55);
    expect(r.story?.threadUpdates[0].status).toBe("escalating");
  });
  it("returns empty story on malformed JSON without throwing", () => {
    expect(parseNarrativeState("no json here").story).toEqual({ threadUpdates: [], newThreads: [], tensionRead: NaN });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `narrativeExtractor.ts`: `parseNarrativeState(raw)` uses `raw.match(/\{[\s\S]*\}/)` + `JSON.parse` in a try/catch (mirror `extractSceneState`), returning `{ story: { threadUpdates, newThreads, tensionRead } }` with safe defaults; and `extractNarrativeState({ baseUrl, model, currentThreads, playerAction, narration })` that builds the story-only prompt (enumerate the 4 kinds, cap new threads at 2, request `tensionRead` 0-100) and calls `callOllama(..., { temperature: 0.1, maxTokens: 320 })`, then returns `parseNarrativeState(response)`. (NPC/world keys added in later plans.)

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/narrativeExtractor.ts tests/pipeline/narrativeExtractor.test.ts
git commit -m "feat(extractor): extractNarrativeState (story key) + parseNarrativeState"
```

### Task 1.8: `[DIRECTOR]` block in promptBuilder; remove getWordBudget/arc/pacing inputs

**Files:**
- Modify: `server/pipeline/promptBuilder.ts`
- Test: covered by orchestrator integration + existing prompt tests

- [ ] **Step 1: Add `director: DirectorDecision` to `PromptContext`;** remove `pacingBeat`, `arcGuidance`, `gmInitiative`, and the plotHooks `[DIRECTOR GOALS]` block from `buildNarratorPrompt`. Replace the `[NARRATIVE ARC]`/`[PACING]`/`[GM INITIATIVE]` sections with `buildDirectorBlock(ctx.director)`. Replace `getWordBudget(...)` usage in the `WORD BUDGET` rule with `ctx.director.wordBudget`. Delete `getWordBudget`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the orchestrator call site (fixed in Task 1.9) — confirm no errors inside `promptBuilder.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add server/pipeline/promptBuilder.ts
git commit -m "feat(prompt): single [DIRECTOR] block; word budget from director; drop getWordBudget"
```

### Task 1.9: Orchestrator wiring (director before, extractor after, gm_event rewire, turn counter, remove old calls)

**Files:**
- Modify: `server/pipeline/orchestrator.ts`

- [ ] **Step 1: Standard path, before narrator** — load `session.storyState ?? coldStartState()`; load `campaign.storyState`; `const decision = runDirector(storyState)`; pass `director: decision` into `buildNarratorPrompt`. Remove `selectPacingBeat`, `analyzeArc`, `getGmInitiativeInterval`, `getArcPacingGuidance`, the `messagesSinceEvent` block, and `buildGmInitiative` usage from this path.

- [ ] **Step 2: Image trigger** — pass `decision.gmInitiative` (string) as the `gmInitiative` argument to `generateSceneImage` (unchanged downstream; `beatDetector.ts:75` still fires `gm_event` when non-empty).

- [ ] **Step 3: After `onComplete`** — persist `lastIntent = decision.intent` and `lastSpotlightId = decision.spotlight?.id` onto `storyState` immediately (so the next turn's merge can run forced-payoff). Add a fire-and-forget call: `extractNarrativeState(...)` → `mergeStoryState(storyState, ex.story, turn+1)` → `db.update(sessions).set({ storyState: merged })` (the merge output already carries `lastIntent`/`lastSpotlightId` forward unchanged; mergeStoryState does not clear them). Join its promise to `step3Promises`. Also grep for any other test importing the removed functions (`getWordBudget`/`selectPacingBeat`/`analyzeArc`/`getArcPacingGuidance`/`getGmInitiativeInterval`) and update/remove them so the suite-green step passes.

- [ ] **Step 4: Turn counter** — increment `storyState.turn` on every turn. In the **trivial path** (which returns early and runs no director/extractor), still write the incremented `turn` before returning.

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: tsc exit 0; suite green (update/remove `tests/convex/pacing.test.ts` since `selectPacingBeat` is no longer called — replace with a note or delete in this task).

- [ ] **Step 6: Commit**

```bash
git add server/pipeline/orchestrator.ts tests/convex/pacing.test.ts
git commit -m "feat(orchestrator): wire story-aware director + narrative extractor; rewire gm_event; drop arc/pacing"
```

### Task 1.10: `gm_event` regression test + cold-start test

**Files:**
- Create: `tests/pipeline/gmEventTrigger.test.ts`

- [ ] **Step 1: Write the test** — import `beatDetector`'s decision function (the one consuming `gmInitiative`); assert a non-empty `gmInitiative` yields `{ shouldGenerate: true, triggerType: "gm_event" }` and `""` does not. Also assert `runDirector(coldStartState())` returns `gmInitiative === ""` and a valid `wordBudget` (the cold-start floor).

- [ ] **Step 2: Run to verify it passes** (behavior already exists; this pins it).

Run: `npx vitest run tests/pipeline/gmEventTrigger.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/pipeline/gmEventTrigger.test.ts
git commit -m "test(director): gm_event image-trigger regression + cold-start floor"
```

### Task 1.11: Harness integration assertions + full verification

**Files:**
- Modify: `scripts/play-loop.test.mts`

- [ ] **Step 1: Extend the harness** to read `session.storyState` after each turn and include `threads`/`phase`/`tension` in the transcript dump; assert (when `PLAY_LOOP=1`) that ≥1 thread exists by turn 2 and ≥1 thread reaches `resolved` (or an escalate→payoff transition) by turn 6.

- [ ] **Step 2: Full typecheck + unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0; all green.

- [ ] **Step 3: Live harness play (requires Ollama)**

Run: `PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/play-loop.test.mts`
Expected: 6 turns, `leaks=0`, storyState shows threads accruing and a payoff; transcript readable (no stiff "the tension rises" recitation of the director block).

- [ ] **Step 4: Commit**

```bash
git add scripts/play-loop.test.mts
git commit -m "test(harness): assert thread lifecycle over a play session"
```

- [ ] **Step 5: Update docs** — `ARCHITECTURE.md`, `docs/PIPELINE.md`, `CLAUDE.md`: describe the director replacing arc/pacing. Commit.

---

## Done criteria (Phase 0 + 1)

- All C1–C8 committed; `tsc` clean; unit suite green; `tests/pipeline/director.test.ts` + `narrativeExtractor.test.ts` + `gmEventTrigger.test.ts` green.
- Live harness: threads accrue, at least one pays off, narration stays clean, `gm_event` images still trigger.
- Old `selectPacingBeat`/`analyzeArc`/`getGmInitiativeInterval`/`getArcPacingGuidance` no longer called; `getWordBudget` deleted. (`narrativeArc.ts`/`pacing.ts` files deleted in a later cleanup once Phases 2–3 stop referencing their types.)

## Next plans
- `2026-..-narrative-gameplay-npc.md` (Phase 2): `npc` key of `extractNarrativeState`, `npcMemory` agenda columns, NPC-initiative in director + block line.
- `2026-..-narrative-gameplay-agency.md` (Phase 3): `world` key, thread-linked consequences, director-decided eligibility surfacing, campaign reconcile/promotion.
- Phase 4: cross-layer tuning via the harness.
