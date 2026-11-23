# Narrative Gameplay — Integrated Design Spec

- **Date:** 2026-06-02
- **Status:** Draft (round 4 — integrated design across all four layers: Prose, Structure, NPC, Agency)
- **Scope:** The full narrative-gameplay experience, designed as **one integrated system** sharing a single state contract, a single director, and one prompt block. Supersedes the earlier story-structure-only draft (that design is now the **Structure** layer here).
- **Anchor files:** `server/pipeline/orchestrator.ts`, `server/pipeline/promptBuilder.ts`, `server/pipeline/diceResolver.ts`, `server/pipeline/stateParser.ts`, `server/pipeline/npcSelection.ts`, `server/pipeline/narrativeArc.ts`, `server/pipeline/pacing.ts`, `server/routers/npcMemory.ts`, `server/db/schema.ts`, `server/image/beatDetector.ts`, `scripts/play-loop.test.mts`

---

## 1. The Integrating Idea

The four layers of "good narrative gameplay" are **not independent subsystems** — they are one causal chain, and that is what makes an integrated design possible instead of four bolt-ons:

```
        STRUCTURE                NPC                     AGENCY
        a thread     ──is embodied by──▶  an actor  ──acts, and pays off as──▶  a consequence in the world
   "the cult on the moor"        "the informant"            "cultists move against the player"
                                     │
                                     ▼
                                   PROSE  ── the quality gate every turn's output passes through, whatever fired ──
```

- **Structure** decides *what matters now* (which thread to push, escalate, or pay off).
- **NPC** supplies *who drives it* (an actor with a goal/agenda tied to that thread, in a consistent voice).
- **Agency** makes *the world answer* (the player's choices move threads; escalations spawn consequences that echo back).
- **Prose** is orthogonal: the output guardrails that keep every turn readable, regardless of which layers fired.

So the system is **one Narrative State** read by **one Director** that emits **one `[DIRECTOR]` block** per turn, and **one set of fire-and-forget extractors** that update the state after the turn. Threads are the spine that links the layers; everything else hangs off them.

## 2. Problem (per layer)

- **Prose** — the model garbles/repeats on hard turns, leaks mechanic/state markers, breaks grammar at snippet joins, and sometimes emits near-empty turns. *(Largely fixed already — §7.A / §13.)*
- **Structure** — the director tracks a keyword-derived tension *number*, not a story. No threads, no earned payoffs, random beats. *(New design — §7.B.)*
- **NPC** — `npcMemory` stores personality/secrets/voice but NPCs are passive: they answer the player and little else. They hold no **goals/agendas**, never act on their own initiative, and don't drive threads. *(Extends existing — §7.C.)*
- **Agency** — `consequenceSeeds` fire on a blind counter, unlinked to the story; player choices don't visibly reshape the world or the long arc. *(Integrates existing — §7.D.)*

## 3. Goals / Non-Goals

**Goals**
1. One **Narrative State** contract (threads + actors + world), bounded and versioned, read by a deterministic **Director** and written by swappable **extractors** — so any layer's intelligence can grow without rewriting the others.
2. Threads are the **integration spine**: each thread can be owned/opposed by an NPC and can pay off as a world consequence. The director orchestrates the causal chain per turn.
3. **Earned payoffs, living NPCs, a reactive world** — escalation that's earned (not a treadmill), NPCs that pursue agendas in consistent voices, and player choices that visibly move threads and the campaign arc.
4. **Prose guardrails** keep every turn clean (the already-implemented C-fixes plus the director avoiding over-instruction).
5. **Constant per-turn cost** as sessions grow; **no regression floor** (cold start / extractor failure behaves at least as well as today; all existing side effects preserved, notably the `gm_event` image trigger).
6. Ship the already-implemented prose/correctness fixes (§13) **in the same change**.

**Non-Goals (YAGNI)**
- A full agentic multi-step planner (the contract *allows* it later, not built now).
- A thread/NPC/world **UI** (read-only debug view is a future option).
- Multi-campaign / cross-campaign arcs; combat tactics depth; economy/crafting systems.

## 4. Architecture — one state, one director, one block

```
NARRATIVE STATE  (bounded, versioned)
  session.storyState   → threads (spine) + arc (phase/tension)         [Structure]
  npcMemory (+agenda)  → actors: goal, agenda, voice, memory           [NPC]
  session.consequences → world: thread-linked echoes pending           [Agency]
  + sceneState, character HP/inventory (existing)

TURN N  (standard path)
  ┌─ BEFORE narrator — director.ts (deterministic, no LLM) ───────────────────┐
  │ runDirector(storyState, npcs, consequences, campaign) → ONE DirectorDecision:│
  │   • spotlight thread + intent (develop/escalate/payoff/breathe)   [Struct] │
  │   • acting NPC + their agenda beat (or none)                      [NPC]    │
  │   • consequence echo to surface now (or none)                     [Agency] │
  │   • gmInitiative? (story-aware) • wordBudget • voice notes        [Prose]  │
  │ → buildDirectorBlock() emits ONE [DIRECTOR] prompt block                   │
  └────────────────────────────────────────────────────────────────────────────┘
        ↓ narrator generates → streams → onComplete → PROSE guardrails (C1–C8)
  ┌─ AFTER (ONE fire-and-forget extractor, like extractSceneState) ───────────┐
  │ extractNarrativeState() → ONE 3-key JSON:                                  │
  │   { story: {threadUpdates,newThreads,tensionRead},                         │
  │     npc:   {agenda/goal/voice updates per interacting NPC},                │
  │     world: {new thread-linked consequence echoes} }                       │
  │ → mergeStoryState / merge npc agendas / merge consequences                 │
  │ persist storyState (+lastIntent/lastSpotlight), npc agendas, consequences  │
  └────────────────────────────────────────────────────────────────────────────┘
  (Default is ONE combined call — less malformed-JSON surface on a VRAM-contended
   local box. The reader/writer contract still allows splitting it into separate
   swappable extractors later without touching the director — see §15.)

EVERY 15 MESSAGES — own %15-gated fire-and-forget call (NOT inside updateCampaignJournal,
which early-returns on null contextSummary):
  reconcileCampaignThreads(): seed from plotHooks; promote recurring high-weight
  session threads → campaign; mirror status; bound.
```

**Why integrated, not glued:** the three state stores are linked by **thread id**. An NPC's `agenda.threadId` ties an actor to a thread; a consequence's `threadId` ties a world echo to the same thread. The director's per-turn decision threads them: *push thread T → have T's NPC act on their agenda → if T escalated, surface T's pending consequence.* One coherent beat, not three uncoordinated ones.

## 5. Shared Foundations (used by every layer)

1. **Bounded-contract pattern** — each state store is a JSON column with `version`, hard caps (threads ≤6 session / ≤8 campaign; NPC agendas bounded by existing npc selection ≤3/turn; consequences ≤6 pending), and aging/eviction. Keeps per-turn state + prompt size **constant** at any session length.
2. **Reader/writer split** — the **Director** only reads; **extractors** only write. Swap an extractor (LLM → cheaper → agentic) without touching the director or prompt.
3. **Per-turn extractor cadence** — **one combined** fire-and-forget `extractNarrativeState` call returning a 3-key JSON (story/npc/world), same swallow-errors + `step3Promises`-await-before-VRAM convention as today. Net per-turn LLM calls ~4 → ~5 (bounded). The contract stays split (reader/writer) so the one call can later become three swappable extractors without touching the director.
4. **No-regression floor** — empty/failed state → director falls back to today's generic behavior.

## 6. Data Model

### 6.1 Structure — `sessions.storyState` / `campaigns.storyState`

```ts
export type ThreadKind = "mystery" | "threat" | "promise" | "goal"; // "relationship" → NPC layer
export type ThreadStatus = "open" | "escalating" | "resolved" | "abandoned";

export interface StoryThread {
  id: string; label: string; kind: ThreadKind; status: ThreadStatus;
  weight: 1|2|3|4|5; scope: "session" | "campaign";
  introducedTurn: number; lastTouchedTurn: number; touchedCount: number;
  forcedPayoffTurns: number;
  ownerNpcId?: string;        // [INTEGRATION] the actor embodying this thread
  notes?: string; campaignThreadId?: string;
}
export type ArcPhase = "setup" | "rising" | "climax" | "falling" | "resolution";
export interface SessionStoryState {
  version: 1; phase: ArcPhase; tension: number; turnsInPhase: number;
  beatsSincePayoff: number; turn: number; lastGmInitiativeTurn: number;
  lastIntent?: "develop"|"escalate"|"payoff"|"breathe"; lastSpotlightId?: string;
  threads: StoryThread[];
}
export interface CampaignStoryThread { /* as before: id,label,kind,status,weight,introducedSession,lastTouchedSession,notes,history[] (cap 8) */ }
export interface CampaignStoryState { version: 1; threads: CampaignStoryThread[]; }
```

### 6.2 NPC — extend `npcMemory` (existing table)

Add columns (JSON/text) to `npcMemory`; everything else (personality, secrets, relationships, memoryLog, speechPattern, vocabulary, currentState) stays:

```ts
goal?: string;            // what this NPC ultimately wants ("keep the cult's secret")
agenda?: string;          // their current next move ("feel out how much the hunter knows")
agendaThreadId?: string;  // [INTEGRATION] thread this NPC drives/opposes
lastActedTurn?: number;   // for NPC-initiative cadence (don't let one NPC dominate)
```

`npcMemory.upsert` still does NOT accept these (consistent with today's rule that speech/vocabulary are pipeline-written); they are written only by `extractNpcMemory`.

### 6.3 Agency — `sessions.consequenceSeeds` (existing) gains a thread link

```ts
// existing seed shape + one field:
{ trigger: string; echo: string; messagesUntilEcho: number; threadId?: string; } // [INTEGRATION]
```

World facts already live in `sceneState` (location/situation/pendingThreats/timeOfDay) — reused as-is; the director reads `pendingThreats` when surfacing agency.

### 6.4 Constants (`director.ts`)

`MAX_SESSION_THREADS=6`, `MAX_CAMPAIGN_THREADS=8`, `MAX_PENDING_CONSEQUENCES=6`, `STALE_LIMIT=4`, `ESCALATE_LIMIT=3`, `MAX_FORCED_PAYOFF_TURNS=2`, `ABANDON_LIMIT=10`, `GM_INITIATIVE_GAP=2`, `NPC_ACT_GAP=2` (min turns between the same NPC taking initiative), `MAX_NEW_THREADS_PER_TURN=2`, `TENSION_MAX_DELTA=12`, `PLAYER_BONUS=6`, `PROMOTE_WEIGHT=4`/`PROMOTE_TOUCHES=3`, `NOTES_MAX=160`.

## 7. The Four Layers

### 7.A Prose (output guardrails) — mostly done (§13)

The output quality gate. Two parts: (1) **post-generation cleanup** — the C1–C8 fixes (empty/short-turn guards, snippet-join grammar, dedup, marker/STATE_UPDATE strip); (2) **prompt restraint** — the `[DIRECTOR]` block strips internal vocab and caps the directive to one sentence so the narrator never narrates the mechanics. Already implemented and green; this layer is **Phase 0** of the plan (verify + lock), with the residual model-degeneration risk tracked, not blocking.

### 7.B Structure (the director core) — new

`server/pipeline/director.ts` (pure, deterministic). `runDirector(...) → DirectorDecision`.

- **Spotlight:** among `open|escalating` threads, `priority = weight*(1+staleness) + (lastTouchedTurn===turn ? PLAYER_BONUS : 0)` — the player-engagement bonus preserves agency. Ties → weight, then age.
- **Intent (develop is default; escalation earned):** (1) spotlight `escalating` & `staleness≥ESCALATE_LIMIT` → **payoff**; (2) `phase==="climax"` & spotlight `weight≥4` → **payoff**; (3) `staleness≥STALE_LIMIT` & `beatsSincePayoff≥2` → **escalate**; (4) `beatsSincePayoff≤1` → **breathe**; (5) else **develop**.
- **Tension:** `tensionFromThreads = min(100, 8*Σ weightᵢ*(escalating?2:1))`; blend 50/50 with the **prior turn's** `tensionRead` (the extractor runs *after* the turn, so the read available at turn N is from turn N−1 — a deliberate one-turn lag, not a bug); −15 on payoff; then **delta-clamp** to ±`TENSION_MAX_DELTA` (anti-oscillation). Phase machine (threshold + min-3-turns) **ported into director.ts** (not imported from the to-be-deleted `narrativeArc.ts`).
- **Word budget** from intent/phase (replaces `getWordBudget`). **GM initiative** fires only if a thread is very stale AND `turn-lastGmInitiativeTurn≥GM_INITIATIVE_GAP`.

### 7.C NPC depth — extends existing `npcMemory` + `npcSelection`

- **Agendas:** `extractNpcMemory` is extended to also infer/update each interacting NPC's `goal`, `agenda` (next move), and `agendaThreadId` (link to a thread the NPC drives or opposes). Bounded by the existing ≤3 relevant-NPCs-per-turn selection.
- **NPC initiative (the integration):** the director may select an **acting NPC** for the turn — chosen when an NPC's `agendaThreadId === spotlight.id` (the actor who embodies the pushed thread acts on it), respecting `NPC_ACT_GAP` so one NPC can't dominate. The `[DIRECTOR]` block tells the narrator: *"<NPC> acts on their own aim this turn: <agenda> — in their voice."* This is what turns passive NPCs into schemers.
- **Voice consistency:** existing `speechPattern`/`vocabulary` are surfaced in the block for the acting NPC (already partly done in `promptBuilder`), now tied to the actor the director spotlights.
- **Thread ownership:** when the extractor introduces a thread an NPC clearly drives, it sets `thread.ownerNpcId` ⇄ `npc.agendaThreadId`, wiring the spine.

### 7.D Player agency — integrates existing `consequenceSeeds` + threads

- **Thread-linked consequences (fuses the two mechanisms):** the combined extractor sets `threadId` on each new seed. The existing `messagesUntilEcho` counter is **repurposed as a minimum-age eligibility gate only** — a seed becomes *eligible* once its counter reaches 0. The **director is the sole decider of whether to surface an eligible seed this turn**, choosing among eligible seeds by thread state (prefer one whose `threadId` is the spotlight/escalating thread, or whose trigger the player's action just hit). This removes the old blind auto-fire (`orchestrator.ts:204-216`) and the double-fire ambiguity, so echoes feel causal ("because you pushed the informant, the cult moves"), not random. At most one consequence surfaces per turn.
- **Choices move threads:** the per-turn `extractNarrativeState` already reads the *player action* + narration, so a player resolving/escalating a thread is recorded as state — the visible "my choices matter." `promise`-kind threads create obligations the world later honors (the director forces their payoff).
- **Long-arc reactivity:** `reconcileCampaignThreads` promotes a session thread the player kept engaging into the campaign arc, and mirrors resolutions back — the player's actions reshape the campaign, surfaced via the `[DIRECTOR]` "campaign arc" line.
- **No new world-state store** this cycle — `sceneState.pendingThreats` + thread-linked consequences are sufficient; a richer world-fact store is a future extension.

## 8. The unified `[DIRECTOR]` block

Replaces `[NARRATIVE ARC]` + `[PACING]` + `[GM INITIATIVE]` + static `[DIRECTOR GOALS]`. Human-facing only — **no internal vocab** (`STALE`, weights, turn counts); directive ≤ one sentence; NPC + consequence woven in only when they fired:

```
[DIRECTOR]
Campaign arc: the vanished caravans point to a cult on the moor — still unresolved.
The story is rising (tension 62/100).
In play: a mystery — what the informant really knows; a threat — something in the rafters.
The informant acts on their own aim now: feel out how much you truly know, guarded and sly (their voice: clipped, archaic).
This turn, deepen the danger around what the informant knows — and let the rafters stir in answer. Don't resolve it yet.
```

**Hard cap on block size** (anti-stiffness): the NPC line and the consequence line are each **at most one optional line**; the directive is **one sentence**. With everything firing, the block is ≤6 short lines. `DirectorDecision.gmInitiative` is a **string** — the prose complication text, or `""` when none — kept string-typed so `generateSceneImage`'s `gmInitiative.length > 0` check (`beatDetector.ts:75`) still fires the `gm_event` image trigger unchanged.

`buildNarratorPrompt` takes one `director: DirectorDecision`; drops `pacingBeat`/`arcGuidance`/`gmInitiative`/plotHook-goals inputs.

## 9. Whole-App Impact

| Area | Change |
|---|---|
| `server/db/schema.ts` | +`sessions.storyState`, +`campaigns.storyState`; +`npcMemory.{goal,agenda,agendaThreadId,lastActedTurn}`; +`threadId` on the `consequenceSeeds` JSON shape. Old arc/pacing columns retained-but-unused. Migration generated+pushed. |
| `types/index.ts` | + thread / story-state / extended-npc types. |
| `server/pipeline/orchestrator.ts` | Standard path: before narrator `runDirector` → one block; persist `lastIntent`/`lastSpotlightId` after. After `onComplete`: one combined `extractNarrativeState` (story+npc+world keys; fire-and-forget, joins `step3Promises`) → merge into storyState / npcMemory / consequenceSeeds. `reconcileCampaignThreads` as own `%15` call. Remove `selectPacingBeat`/`analyzeArc`/`getGmInitiativeInterval`/`getArcPacingGuidance` + `messagesSinceEvent` block. Increment `storyState.turn` every turn (incl. trivial; trivial runs no director/extractor). |
| **Image trigger (critical)** | `DirectorDecision.gmInitiative` is **string-typed** (complication text or `""`) and passed to `generateSceneImage`, so `beatDetector.ts:75` (`gmInitiative !== ""`) still fires `triggerType:"gm_event"` with no beatDetector change. Regression test asserts this in **Phase 1**. |
| `server/pipeline/promptBuilder.ts` | One `[DIRECTOR]` block; remove `getWordBudget`; surface acting-NPC voice via director. |
| `server/pipeline/director.ts` (new), `narrativeExtractor.ts` (new) | director + merge + reconcile + combined `extractNarrativeState` + bounds. |
| `server/pipeline/npcSelection.ts`, `extractNpcMemory` | extended to populate/read agendas; selection feeds the acting-NPC choice. |
| `server/pipeline/narrativeArc.ts`, `pacing.ts` | superseded; delete in follow-up; `pacing.test.ts` replaced. |
| `server/routers/npcMemory.ts` | `upsert` input unchanged (agenda fields pipeline-written only). |
| `server/routers/sessions.ts` | no functional change; dead `updatePacingBeats` removed in follow-up. |
| **UI** | **No change** — verified nothing renders arc/tension/threads (re-grep before dropping columns). |
| Docs | update `ARCHITECTURE.md`, `docs/PIPELINE.md`, `docs/NPC_MEMORY.md`, `CLAUDE.md`. |

**Consequence/NPC extractors** join the existing fire-and-forget set; VRAM handoff unchanged (await `step3Promises`).

## 10. Error Handling & Fallbacks

Per-extractor swallow+log; last-good state persists; turn never fails. Cold start → setup-phase generic decision (no-regression floor). Malformed JSON → keep prior. Unmatched thread/NPC ids → fuzzy label match, else drop. `MAX_FORCED_PAYOFF_TURNS` auto-resolves a thread the model won't close. All caps enforced in merge/reconcile. If NPC/consequence layers produce nothing, the director degrades to pure-Structure guidance.

## 11. Scalability & Future

Contract is the seam: swap extractors (→ agentic planner), grow scope (season layer above campaign), add `ThreadKind`s (`clock`, re-add `relationship`) without schema change. Read-only thread/NPC/tension debug UI; tunable constants in `userSettings`; `version` fields enable forward-migration. World-fact store and consequence/thread unification are deferred extension points.

## 12. Testing

- **Unit (pure):** `runDirector` (spotlight + player bonus; intent ladder; NPC-initiative selection + `NPC_ACT_GAP`; consequence surfacing; GM-init + gap; word budget; tension clamp; phase port); `mergeStoryState` (updates, dedupe+cap, forced-payoff auto-resolve, aging, eviction with weight≥4 protection, thread↔npc link); `reconcileCampaignThreads`; `buildDirectorBlock` (contains spotlight/NPC/consequence when present; **asserts no internal vocab** like `STALE`/weights/turn-counts; **asserts a hard line/char ceiling** even with NPC+consequence+gmInitiative all firing; cold-start text). Place in `tests/pipeline/`.
- **Integration:** extend `scripts/play-loop.test.mts` to dump full narrative state per turn and assert: a thread introduced by turn 2, an NPC acting on an agenda at least once, a thread-linked consequence echoing, and ≥1 payoff within the 6-turn script. Add a script variant exercising NPC initiative + consequences.
- **Regression:** existing suite green; the C1–C8 prose fixes' tests stay green; a test that director `gmInitiative` still reaches the image trigger.

## 13. Companion prose/correctness fixes — already implemented, in this change (Phase 0)

Implemented earlier this session via the play→review→fix loop; uncommitted in the tree; **same change/PR**, sequenced first so the director builds on a locked base.

| # | Fix | Files |
|---|---|---|
| C1 | Empty-turn guard | `orchestrator.ts` |
| C2 | Short-output retry (<12 words) | `orchestrator.ts` |
| C3 | Snippet-join grammar/sentence breaks | `diceResolver.ts` |
| C4 | Repeated-phrase + sentence dedup | `orchestrator.ts` |
| C5 | STATE_UPDATE leak-strip + explicit format | `stateParser.ts`, `promptBuilder.ts` |
| C6 | Damage targeting + HP-stat guard | `orchestrator.ts` |
| C7 | Star Wars genre-bleed removal | `promptBuilder.ts` |
| C8 | Play-loop harness | `scripts/play-loop.test.mts` |

Status: implemented; `tsc` clean; 266 unit tests pass. Residual: gemma still degrades on some combat turns (model-level; reduced by C2 + `[DIRECTOR]` guidance, not eliminated).

## 14. Phased Implementation (one PR, ordered phases)

0. **Lock prose (C1–C8):** verify green (`npm test` + a harness play). *(done; verify)*
1. **Structure (largest phase — the risk concentration):** `storyState` schema + `director.ts` + `extractNarrativeState` (story key only for now) + `[DIRECTOR]` block + image-trigger rewire. This phase simultaneously **removes** `analyzeArc`/`selectPacingBeat`/`getGmInitiativeInterval`/`messagesSinceEvent` and **introduces** their replacement, so its no-regression "floor" is the director's own cold-start path — **test that cold-start path and the `gm_event` regression test first, before removing the old calls.** Director live on Structure only.
2. **NPC:** add the `npc` key to `extractNarrativeState`; extend `npcMemory` with agendas; add NPC-initiative to the director + one optional block line.
3. **Agency:** add the `world` key to `extractNarrativeState`; thread-link consequences; convert echo-firing to director-decided eligibility surfacing; campaign reconcile/promotion + one optional block line.
4. **Tune + verify:** harness across the layers; adjust constants; docs.

`buildDirectorBlock` is reopened additively in phases 2–3 (one line each) — additive edits, not logic rework; its no-internal-vocab + ceiling tests are extended each phase. Each phase is independently shippable behind the no-regression floor, so the integrated whole lands incrementally without a flag.

## 15. Open Questions / Risks

- **Extractor reliability on the local model** (gemma degrades): mitigated by strict JSON, fallbacks, delta clamp, forced-payoff, bounded merges.
- **Block stiffness / over-instruction** with NPC + consequence lines added — keep each to one human-facing clause; watch in play that the narrator doesn't recite the steer.
- **Per-turn cost** rises ~4→~5 calls — the narrative-state extractor is **one combined call by default** (story+npc+world in a 3-key JSON), chosen over three separate calls because the player never sees them and one call is strictly less malformed-JSON surface on a VRAM-contended local box. The reader/writer contract still allows splitting into three swappable extractors later (e.g. to swap one for the agentic planner) without touching the director.
- **Tuning** all constants needs play-testing; the harness is the loop.
- **NPC dominance / railroading** — `NPC_ACT_GAP` + develop-default intent keep initiative from feeling relentless; player-engagement bonus keeps spotlight on what the player cares about.
