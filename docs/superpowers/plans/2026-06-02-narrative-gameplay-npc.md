# Narrative Gameplay — Phase 2 (NPC layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make NPCs *actors* — give them goals/agendas tied to story threads, and let the director hand an NPC the initiative to act on its own aim in a consistent voice.

**Architecture:** Extend the existing `npcMemory` table + `extractNpcMemory` with `goal`/`agenda`/`agendaThreadId`/`lastActedTurn`. Add the `npc` key to the combined `extractNarrativeState`. The deterministic director (`director.ts`) gains an NPC list input and selects an *acting NPC* for the turn (the one whose `agendaThreadId === spotlight.id`, respecting a per-NPC act-gap), surfaced as one optional line in the `[DIRECTOR]` block. Threads link back via `thread.ownerNpcId ⇄ npc.agendaThreadId`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite, Vitest, local Ollama. Builds on Phase 1 (branch `feat/narrative-director`).

**Spec:** `docs/superpowers/specs/2026-06-02-story-aware-director-design.md` §6.2, §7.C, §9. **Depends on:** Phase 1 foundation (already merged into this branch).

---

## Current signatures this phase extends
- `runDirector(s: SessionStoryState): DirectorDecision` → gains an `npcs` param.
- `DirectorDecision` (types/index.ts:301) has `activeThreads`; → gains optional `actingNpc`.
- `extractNarrativeState(...)` returns `{ story: {...} }`; → also returns `{ npc: {...} }`.
- `buildNpcExtractPrompt(narrative, knownNpcNames)` (promptBuilder.ts:235) and `extractNpcMemory` (orchestrator.ts:682) parse `{new_state, speech_pattern, vocabulary, disposition_delta}`; → also produce `goal`/`agenda`/`agendaThreadId`.
- `npcMemory` table (schema.ts:118) has `currentState`, `speechPattern`, etc.; → add 4 columns.

## File Structure

| File | Change |
|---|---|
| `server/db/schema.ts` | + `npcMemory.{goal,agenda,agendaThreadId,lastActedTurn}` columns + migration |
| `types/index.ts` | + `actingNpc?` on `DirectorDecision`; + an `NpcAgendaLite` type for the director input |
| `server/pipeline/director.ts` | `runDirector(s, npcs)` picks acting NPC; `buildDirectorBlock` renders the NPC line |
| `server/pipeline/narrativeExtractor.ts` | parse + request the `npc` key |
| `server/pipeline/promptBuilder.ts` | `buildNpcExtractPrompt` asks for goal/agenda (if still used) — but the agenda extraction now flows through `extractNarrativeState`'s `npc` key; keep voice surfacing |
| `server/pipeline/orchestrator.ts` | pass relevant NPCs to `runDirector`; apply `npc` agenda updates; set `lastActedTurn` for the acting NPC; wire `thread.ownerNpcId` |
| `tests/pipeline/director.test.ts` | NPC-initiative selection + block line tests |
| `tests/pipeline/narrativeExtractor.test.ts` | `npc` key parse tests |
| `scripts/play-loop.test.mts` | assert an NPC acts at least once over the run |

**Constants:** `NPC_ACT_GAP = 2` already exists in `director.ts` CONSTANTS (added in Phase 1). Reuse it.

---

### Task 2.1: npcMemory agenda columns + types

**Files:** `server/db/schema.ts`, `types/index.ts`

- [ ] **Step 1:** In `npcMemory` table add (near `currentState`/`speechPattern`):
```ts
goal: text("goal"),
agenda: text("agenda"),
agendaThreadId: text("agenda_thread_id"),
lastActedTurn: integer("last_acted_turn"),
```
- [ ] **Step 2:** In `types/index.ts`, add `actingNpc?: { name: string; agenda: string; voice?: string }` to `DirectorDecision`, and a director-input type `export interface NpcAgendaLite { id: string; name: string; agenda?: string | null; agendaThreadId?: string | null; lastActedTurn?: number | null; speechPattern?: string | null; }`. (Also extend `NPCMemoryDoc` if it's the type read from the table, so the new columns are visible.)
- [ ] **Step 3:** `npx tsc --noEmit` → 0. Verify no null bytes in edited files.
- [ ] **Step 4:** `npx drizzle-kit generate && npx drizzle-kit push` (adds 4 columns to local DB).
- [ ] **Step 5:** Commit `server/db/schema.ts types/index.ts drizzle/` → `feat(npc): agenda columns on npcMemory + director acting-npc type`.

### Task 2.2: Director NPC-initiative selection + block line

**Files:** `server/pipeline/director.ts`, `tests/pipeline/director.test.ts`

- [ ] **Step 1: Failing tests** (append to director.test.ts):
```ts
import type { NpcAgendaLite } from "@/types";
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
```
- [ ] **Step 2:** Run director tests → the new ones fail (`runDirector` arity / `actingNpc`).
- [ ] **Step 3: Implement.** Change `runDirector(s: SessionStoryState, npcs: NpcAgendaLite[] = []): DirectorDecision`. After computing `spotlight`, select `actingNpc`: among `npcs` where `agendaThreadId === spotlight?.id` AND (`lastActedTurn == null` OR `s.turn - lastActedTurn >= CONSTANTS.NPC_ACT_GAP`) AND `agenda` is a non-empty string, pick the first (or the one with the oldest `lastActedTurn`). Set `decision.actingNpc = { name, agenda, voice: speechPattern ?? undefined }` or leave undefined. Keep all existing behavior. Default `npcs=[]` preserves Phase-1 callers/tests.
- [ ] **Step 4: buildDirectorBlock** — when `decision.actingNpc` is set, add ONE line: `${name} acts on their own aim now: ${agenda}${voice ? ` (their voice: ${voice})` : ""}.` Keep the block ≤6 lines and free of internal vocab. Update the ceiling test to still pass with the NPC line present; add an assertion that the NPC line appears when `actingNpc` is set and is absent otherwise.
- [ ] **Step 5:** director tests pass; `npx tsc --noEmit` 0.
- [ ] **Step 6:** Commit `server/pipeline/director.ts tests/pipeline/director.test.ts` → `feat(director): NPC initiative selection + acting-npc block line`.

### Task 2.3: `npc` key in extractNarrativeState

**Files:** `server/pipeline/narrativeExtractor.ts`, `tests/pipeline/narrativeExtractor.test.ts`

- [ ] **Step 1: Failing parser test** — a response `{"story":{...},"npc":{"updates":[{"name":"the informant","goal":"protect the secret","agenda":"deflect questions","agendaThreadId":"t1"}]}}` → `parseNarrativeState` returns `.npc.updates` with that element; malformed npc elements (missing `name`) are dropped; missing `npc` key → `{ updates: [] }`. Never throws.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3: Implement.** Extend `NarrativeStateResult` with `npc: { updates: { name: string; goal?: string; agenda?: string; agendaThreadId?: string }[] }`. In `parseNarrativeState`, read `parsed.npc?.updates`, filter to elements with a non-empty string `name`, map fields through (strings only; drop others). Safe default `{ updates: [] }`. In `extractNarrativeState`, extend the prompt to ALSO ask, for each NPC that spoke/acted this turn, their `goal` (long-term want), `agenda` (next move), and which thread id (from the supplied threads) their agenda concerns — as `"npc":{"updates":[...]}`. Pass the current NPC names + ids into the args so the prompt can reference them: extend the args type with `npcs: { id: string; name: string }[]`.
- [ ] **Step 4:** Tests pass; `tsc` 0.
- [ ] **Step 5:** Commit → `feat(extractor): npc key (agendas/goals) in extractNarrativeState`.

### Task 2.4: Orchestrator — feed NPCs to director, apply agenda updates, wire ownership

**Files:** `server/pipeline/orchestrator.ts`

- [ ] **Step 1: Director input.** In the standard path, build `NpcAgendaLite[]` from the already-loaded relevant NPCs (`relevantNPCs` / `allNPCs` — use the ones selected for the scene) mapping `{ id, name, agenda, agendaThreadId, lastActedTurn, speechPattern }`, and pass them as the 2nd arg to `runDirector(storyState, npcAgendas)`.
- [ ] **Step 2: Acting-NPC bookkeeping.** After `onComplete`, if `decision.actingNpc` is set, find that NPC row by name and set `lastActedTurn = storyState.turn` (a small `db.update(npcMemory)`), fire-and-forget/awaited within step3.
- [ ] **Step 3: Apply `npc` agenda updates.** In the step3d chain (after `extractNarrativeState`), for each `ex.npc.updates` element: match the npc row by name (case-insensitive, mirroring `extractNpcMemory`); set `goal`/`agenda`/`agendaThreadId` where provided. Do this alongside the storyState merge (same fire-and-forget block). Swallow errors.
- [ ] **Step 4: Thread ownership link.** After `mergeStoryState`, for any `ex.npc.updates` with an `agendaThreadId` that matches a thread in the merged state, set that thread's `ownerNpcId` to the npc row id (and conversely the npc's `agendaThreadId` is already set in Step 3). Persist the merged storyState with `ownerNpcId` populated.
- [ ] **Step 5:** `npx tsc --noEmit` 0; `npx vitest run` full suite green (report count). Fix any test that asserted the old `runDirector` arity.
- [ ] **Step 6:** Commit → `feat(orchestrator): wire NPC agendas + acting-npc into the director loop`.

### Task 2.5: Voice surfacing + harness + verify + docs

**Files:** `server/pipeline/promptBuilder.ts` (if needed), `scripts/play-loop.test.mts`, docs

- [ ] **Step 1:** Confirm the acting NPC's voice reaches the narrator: the `[DIRECTOR]` block already includes the voice via Task 2.2; ensure the `[NPCS IN SCENE]` section still lists the acting NPC. No change unless a gap is found.
- [ ] **Step 2: Harness** — extend `scripts/play-loop.test.mts` to dump each NPC's `agenda`/`goal` and whether an NPC acted (from the `[DIRECTOR]` block or a stored signal); assert (soft, `PLAY_LOOP=1`) that at least one NPC has a non-null `agenda` by turn 4. Keep it lenient (model nondeterminism).
- [ ] **Step 3: Verify** — `npx tsc --noEmit` 0; `npx vitest run` green; live harness `PLAY_LOOP=1 PLAY_MODEL="gemma3:12b" npx vitest run scripts/play-loop.test.mts` — report whether NPCs gained agendas and whether one took initiative, plus a narration sample to confirm the NPC line didn't make prose stiff. (SKIP if Ollama down.)
- [ ] **Step 4: Docs** — note the NPC agenda/initiative layer in `CLAUDE.md` + `docs/NPC_MEMORY.md`.
- [ ] **Step 5:** Commit → `test(harness)+docs(npc): NPC agendas + initiative`.

---

## Done criteria
- 4 new `npcMemory` columns migrated; `runDirector(s, npcs)` selects an acting NPC respecting `NPC_ACT_GAP`; `[DIRECTOR]` block shows the NPC line (≤6 lines, no internal vocab); `extractNarrativeState` returns a validated `npc` key; orchestrator applies agendas + sets `lastActedTurn` + links `thread.ownerNpcId`.
- `tsc` clean; full suite green; live harness shows NPCs acquiring agendas and (when one targets the spotlight) taking initiative, prose still natural.

## Next
- Phase 3 (Agency): `world` key, thread-linked consequences, director-decided eligibility surfacing, campaign reconcile/promotion.
