# Narrative Gameplay — Phase 3 (Agency layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the world *answer* the player: consequences become thread-linked and the director decides *which* eligible consequence echoes *when* (causal, not a blind timer), and the player's recurring threads get promoted into a persistent campaign arc.

**Architecture:** `consequenceSeeds` gain a `threadId`. The combined `extractNarrativeState` gains a `world` key that mints thread-linked seeds (replacing the standalone `extractConsequenceSeeds`). The blind "fire every seed whose counter hit 0" logic (orchestrator:229-240) is replaced: `messagesUntilEcho` becomes a minimum-age *eligibility gate*, and the deterministic director picks ONE eligible seed to surface (preferring one whose `threadId` is the spotlight/escalating thread). A `%15`-gated `reconcileCampaignThreads` seeds campaign threads from plotHooks and promotes recurring high-weight session threads into `campaigns.storyState`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite, Vitest, local Ollama. Builds on Phases 0-2 (branch `feat/narrative-director`).

**Spec:** `docs/superpowers/specs/2026-06-02-story-aware-director-design.md` §4, §5.4, §6.3, §7.D, §9. **Depends on:** Phases 0-2 (already on this branch).

---

## Current mechanics this phase changes (verified line refs)
- `consequenceSeeds` JSON shape `{ trigger; echo; messagesUntilEcho }[]` (schema.ts:72) → add `threadId?: string`.
- Blind echo fire-and-decrement block (orchestrator.ts:229-240) → replaced by director-decided surfacing.
- `readyEchoes` → `consequenceEchoes` prompt input (orchestrator:264; promptBuilder renders a `[CONSEQUENCE ECHOES]` block) → replaced by ONE line in the `[DIRECTOR]` block from `decision.consequenceEcho`.
- `extractConsequenceSeeds` (orchestrator.ts:698, step3b) → REMOVED; its job moves to the `world` key of `extractNarrativeState`.
- `updateCampaignJournal` (orchestrator.ts:820) early-returns on `!contextSummary` (831) BEFORE the `%15` check (838) → so `reconcileCampaignThreads` must be its OWN `%15`-gated fire-and-forget call, not inside it.
- `DirectorDecision` (types/index.ts:301) → add `consequenceEcho?: string`.

## File Structure

| File | Change |
|---|---|
| `types/index.ts` | `consequenceSeed` threadId; `DirectorDecision.consequenceEcho?`; `world` shape on the extractor result |
| `server/pipeline/director.ts` | `runDirector(s, npcs, consequences)` picks eligible seed; `buildDirectorBlock` consequence line; `reconcileCampaignThreads()` pure fn |
| `server/pipeline/narrativeExtractor.ts` | `world` key (thread-linked seeds) in prompt + parser |
| `server/pipeline/promptBuilder.ts` | remove `[CONSEQUENCE ECHOES]` block (now a director line); drop `consequenceEchoes` from `PromptContext` |
| `server/pipeline/orchestrator.ts` | pass consequences to director; director-decided surfacing replaces blind fire; apply `world` seeds; remove `extractConsequenceSeeds` call; add `reconcileCampaignThreads` as own `%15` call; persist `campaigns.storyState` |
| `server/db/schema.ts` | `consequenceSeeds` `$type` gains `threadId?` (JSON column — **no migration needed**) |
| tests | `director.test.ts` (surfacing + reconcile), `narrativeExtractor.test.ts` (world parse), `scripts/agency.test.mts` (E2E) |

**Constants:** `MAX_CAMPAIGN_THREADS=8`, `PROMOTE_WEIGHT=4`, `PROMOTE_TOUCHES=3` — add to `director.ts` CONSTANTS.

---

### Task 3.1: types + seed shape + schema $type

- [ ] **Step 1:** `server/db/schema.ts` — change `consequenceSeeds` `$type<...>` to `{ trigger: string; echo: string; messagesUntilEcho: number; threadId?: string }[]`. (JSON column — no migration; just the TS type.)
- [ ] **Step 2:** `types/index.ts` — add `consequenceEcho?: string` to `DirectorDecision`. (Reuse existing `CampaignStoryState`/`CampaignStoryThread` from Phase 1.)
- [ ] **Step 3:** `npx tsc --noEmit` 0. No null bytes.
- [ ] **Step 4:** Commit `server/db/schema.ts types/index.ts` → `feat(agency): threadId on consequence seeds + director consequenceEcho`.

### Task 3.2: Director — eligibility surfacing + buildDirectorBlock line

**Files:** `server/pipeline/director.ts`, `tests/pipeline/director.test.ts`

- [ ] **Step 1: Failing tests.** A `ConsequenceSeedLite = { echo: string; messagesUntilEcho: number; threadId?: string }`. `runDirector(s, npcs, consequences)`:
  - picks the eligible (`messagesUntilEcho <= 0`) seed whose `threadId === spotlight.id` and sets `decision.consequenceEcho = that.echo`;
  - when multiple eligible, prefers `threadId === spotlight.id`, then a `threadId` matching any escalating thread, then the first eligible;
  - no eligible seed → `consequenceEcho` undefined;
  - non-eligible seeds (`messagesUntilEcho > 0`) are never surfaced.
```ts
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
});
```
- [ ] **Step 2:** run director tests → fail. **Step 3:** implement — change signature to `runDirector(s, npcs: NpcAgendaLite[] = [], consequences: ConsequenceSeedLite[] = [])` (defaults keep all prior callers/tests green). Add the selection after spotlight/actingNpc. Add `ConsequenceSeedLite` to `types/index.ts` (or local export).
- [ ] **Step 4: buildDirectorBlock** — when `decision.consequenceEcho` set, add ONE line: `Because of what came before: ${consequenceEcho}.` Keep block ≤7 lines now (header, In-play, NPC, consequence, directive, complication — verify the ceiling test still holds; bump the cap constant in the test if needed but keep it tight). No internal vocab. Add an assertion the line appears/absent.
- [ ] **Step 5:** tests pass; tsc 0. **Step 6:** commit director + tests → `feat(director): consequence eligibility surfacing + block line`.

### Task 3.3: reconcileCampaignThreads (pure)

**Files:** `server/pipeline/director.ts`, `tests/pipeline/director.test.ts`

- [ ] **Step 1: Failing tests** for `reconcileCampaignThreads(campaign: CampaignStoryState | null, session: SessionStoryState, plotHooks: string[], sessionId: string): CampaignStoryState`:
  - empty campaign + plotHooks → seeds one campaign thread per hook (`kind:"goal"`, `weight:3`, status `open`);
  - a session thread with `weight>=PROMOTE_WEIGHT` and `touchedCount>=PROMOTE_TOUCHES` and `scope==="session"` → a matching campaign thread is created (deduped by normalized label);
  - a `resolved` session thread already linked (`campaignThreadId`) → mirrors status to that campaign thread + appends a `history` entry (cap 8);
  - caps campaign threads at `MAX_CAMPAIGN_THREADS`.
- [ ] **Step 2-4:** implement per spec §5.4; pure (no I/O), returns the new `CampaignStoryState`. The orchestrator persists it and the session-thread `scope`/`campaignThreadId` mutations separately (Task 3.5). To keep this pure, return `{ campaign: CampaignStoryState; promotions: { sessionThreadId: string; campaignThreadId: string }[] }` so the caller can write back the session-thread links.
- [ ] **Step 5:** tests pass; tsc 0. **Step 6:** commit → `feat(director): reconcileCampaignThreads (seed/promote/mirror)`.

### Task 3.4: extractor `world` key (replaces extractConsequenceSeeds)

**Files:** `server/pipeline/narrativeExtractor.ts`, `tests/pipeline/narrativeExtractor.test.ts`

- [ ] **Step 1: Failing parser tests** — result gains `world: { newSeeds: { trigger: string; echo: string; threadId?: string }[] }`. Parse `parsed.world?.newSeeds`, filter to elements with non-empty string `trigger` AND `echo` (drop malformed), copy `threadId` only when string. Safe default `{ newSeeds: [] }`. Never throw. (Mirror the story/npc defensive filtering.)
- [ ] **Step 2-3:** extend the prompt: ask for AT MOST 2 *new* delayed consequences this turn — each a `trigger` (what the player did) and an `echo` (how the world reacts LATER), and the `threadId` of the supplied thread it stems from (or omit). Output the combined `{"story":{...},"npc":{...},"world":{"newSeeds":[...]}}`.
- [ ] **Step 4:** tests pass; tsc 0. **Step 5:** commit → `feat(extractor): world key (thread-linked consequences)`.

### Task 3.5: Orchestrator wiring (the integration)

**Files:** `server/pipeline/orchestrator.ts`, `server/pipeline/promptBuilder.ts`

- [ ] **Step 1: Director input.** Pass the session's `consequenceSeeds` (as `ConsequenceSeedLite[]`) as the 3rd arg to `runDirector(storyState, npcAgendas, session.consequenceSeeds ?? [])`.
- [ ] **Step 2: Replace blind surfacing (orchestrator:229-240).** Remove the `readyEchoes` auto-fire. Instead: decrement every seed's `messagesUntilEcho` by 1 (min 0) each turn for persistence; the director's `decision.consequenceEcho` (already chosen from eligible seeds) is the single surfaced echo. After the turn, REMOVE the surfaced seed from `consequenceSeeds` (match by echo+threadId) and persist the decremented+filtered list. (Eligibility = `messagesUntilEcho <= 0`, computed by the director from the pre-decrement list — keep the semantics: a seed surfaces only once its counter has elapsed.)
- [ ] **Step 3: Prompt.** Remove the `consequenceEchoes` field from `PromptContext` and the `[CONSEQUENCE ECHOES]` block in `promptBuilder.ts`; the echo now appears via `buildDirectorBlock(decision)`.
- [ ] **Step 4: Apply `world` seeds.** In the step3d chain, append `ex.world.newSeeds` (mapped to `{ trigger, echo, threadId, messagesUntilEcho: <random 5-10, reuse the existing formula> }`) to the session's `consequenceSeeds`, persisted with the merge. REMOVE the separate `extractConsequenceSeeds` call (step3b) and its function (or leave the function but stop calling it — prefer removing the call and the now-dead function).
- [ ] **Step 5: Campaign reconcile.** Add a fire-and-forget call gated ONLY by `msgCount % 15 === 0` (compute msgCount like updateCampaignJournal does, but do NOT place it inside that function — its `!contextSummary` early-return would suppress seeding). It loads `campaign.storyState`, the merged session storyState, and `campaign.plotHooks`, calls `reconcileCampaignThreads(...)`, persists `campaigns.storyState`, and writes back any session-thread `scope`/`campaignThreadId` promotions into `sessions.storyState`.
- [ ] **Step 6:** `npx tsc --noEmit` 0; `npx vitest run` full suite green (report count; fix any test referencing the removed `consequenceEchoes`/`extractConsequenceSeeds` or the old `runDirector` arity). No null bytes; targeted edits.
- [ ] **Step 7:** commit → `feat(orchestrator): director-decided consequence surfacing + world seeds + campaign reconcile`.

### Task 3.6: E2E validation + harness + verify + docs

**Files:** `scripts/agency.test.mts` (new), `scripts/play-loop.test.mts`, docs

- [ ] **Step 1: E2E test** (`scripts/agency.test.mts`, env-gated like `scripts/npc-initiative.test.mts` which you should read for the seeding/poll pattern): seed `session.storyState` with a weight-4 thread `id:"seed-thread"` (spotlight), and seed `session.consequenceSeeds` with `[{ trigger:"pressed the informant", echo:"cultists bar the tavern doors from outside", messagesUntilEcho: 0, threadId: "seed-thread" }]`. Run ONE live turn with a message engaging that thread. Assert the surfaced echo influenced the turn: the seed is REMOVED from `session.consequenceSeeds` afterward (poll), and the narration is non-empty with no `[DIRECTOR]` leak. (The strongest deterministic signal is the seed being consumed; the narration reflecting "cultists bar the doors" is a soft/log check.)
- [ ] **Step 2: Harness** — `scripts/play-loop.test.mts`: dump `consequenceSeeds` (with threadId) per turn; soft-assert at least one seed gets created over the run.
- [ ] **Step 3: Verify** — tsc 0; full suite green; live `PLAY_LOOP=1 ... npx vitest run scripts/agency.test.mts` and the main harness — report whether the seeded consequence surfaced/was consumed, whether new seeds accrued, leaks=0, and a narration sample. SKIP live if Ollama down.
- [ ] **Step 4: Docs** — `CLAUDE.md` + `ARCHITECTURE.md`: consequences are thread-linked + director-surfaced; campaign threads persist the arc.
- [ ] **Step 5:** commit → `test(agency)+docs: thread-linked consequences + campaign reconcile`.

---

## Done criteria
- `consequenceSeeds` carry `threadId`; the director surfaces ONE eligible seed (preferring the spotlight's), removed after firing; no blind multi-echo auto-fire remains; the `[CONSEQUENCE ECHOES]` prompt block is gone (now a director line). `extractNarrativeState` returns a validated `world` key; `extractConsequenceSeeds` removed. `reconcileCampaignThreads` runs `%15` (independent of the contextSummary guard), seeding from plotHooks and promoting recurring threads into `campaigns.storyState`.
- tsc clean; full suite green; E2E test shows a seeded thread-linked consequence get surfaced + consumed in live play, prose clean.

## Next (after Phase 3)
- Phase 4: cross-layer tuning of constants via the harness.
- Deferred cleanup PR: delete `narrativeArc.ts`/`pacing.ts`, dead columns (`narrativeArc`/`lastPacingBeats`/`messagesSinceEvent`), and the dead `updatePacingBeats` procedure.
