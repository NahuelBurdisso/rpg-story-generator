# NPC Episodic Memory — Design Spec

- **Date:** 2026-06-03
- **Status:** Draft (round 2 — spec-reviewer approved; holder/subject rule, gossip name-resolution, and threadId-timing caveats clarified)
- **Scope:** One general **memory substrate** for NPCs from which four player-facing payoffs *emerge* — callbacks/grudges, evolving relationships, reputation that spreads, and consequences that resurface — rather than four bolt-on features. Single-campaign, local-first, integrates with the existing simulation tick.
- **Anchor files:** `server/pipeline/orchestrator.ts`, `server/pipeline/narrativeExtractor.ts`, `server/pipeline/promptBuilder.ts`, `server/pipeline/director.ts`, `server/pipeline/npcSelection.ts`, `server/db/schema.ts`, `types/index.ts`, `server/routers/npcMemory.ts`
- **New files:** `server/pipeline/memory/store.ts`, `server/pipeline/memory/retrieve.ts`, `server/pipeline/memory/consolidate.ts`, `server/pipeline/memory/gossip.ts`, tests under `tests/convex/`

---

## 1. The integrating idea

Today NPCs remember **latest state** (a single overwritten `currentState` string + a disposition number), not **events**. "It remembered you across sessions" works; "it recalls *that specific thing that happened*" does not — `npc_memory.memoryLog` exists in the schema but the pipeline never writes it.

The fix is **one primitive**: a *memory* = a remembered event an NPC holds. Each memory records **who/what it's about**, **how it landed** (emotional valence), **how strongly it's held** (salience, which fades), **how it was learned** (witnessed / heard / rumor), and **what story thread it belongs to**. All four payoffs are *views* over this one substrate:

```
                         ┌─────────────────────────────┐
   the player acts  ───▶ │   MEMORY  (one event row)   │
                         │  about · valence · salience  │
                         │  source · confidence · thread │
                         └──────────────┬──────────────┘
        retrieve hot ones  ┌────────────┼───────────────┬──────────────────┐
                           ▼            ▼                ▼                  ▼
                      callbacks/    relationships    reputation        consequences
                       grudges     (running sum of   (memories copy    (hot unresolved
                    (recall in      memories →         to co-present     memory → a
                     the prompt)    disposition)       NPCs as 'heard')  consequence seed)
```

There is no separate "grudge system" or "reputation system" — there is storing, scoring, retrieving, aging, and spreading **memories**, and the payoffs fall out.

## 2. Problem

- NPCs have no episodic recall. `currentState` is overwritten every turn; nothing accumulates a history of events.
- `memoryLog` (`{sessionId, summary, emotionalShift}[]`) is in `schema.ts` and `npcMemory.upsert`, but `extractNpcMemory` sets it to `[]` on insert and never appends ([orchestrator.ts:831](server/pipeline/orchestrator.ts:831)). `deepHistory`, `secrets`, `revealedInfo` are similarly underused by the pipeline.
- There is no concept of *how* an NPC knows something (witnessed vs. heard), so reputation cannot spread.
- The naive fixes all fight the existing tick (§4): a per-turn memory LLM call (4th extractor), wall-clock decay (desyncs from the turn clock), per-turn decay writes (don't scale), and writing memories onto the `npc_memory` row (compounds an existing concurrent-write race).

## 3. Goals / Non-Goals

**Goals**
1. A general, queryable memory substrate (new `memories` table) from which all four payoffs emerge.
2. **Flat per-turn cost:** no new LLM call (formation rides the existing `extractNarrativeState`), and near-flat write count (lazy decay, no per-turn memory writes).
3. **Turn-aligned:** memory ages by the same simulation clock (`storyState.turn`) the director already uses.
4. **One resurfacing mechanism:** hot unresolved memories feed the *existing* `consequenceSeeds` flow rather than forking a parallel system.
5. **Hybrid-ready retrieval:** ship a heuristic ranker behind a stable `retrieveMemories()` interface so embeddings can drop in later with no caller changes.
6. **No regression floor:** cold start (no memories) and any extractor failure behave at least as well as today; the turn never breaks on memory errors.
7. Reputation **gossip** between co-present NPCs, in v1.

**Non-Goals (YAGNI)**
- Embedding / vector retrieval now (interface is left open for it).
- Memory-driven NPC **selection / spotlight** — v1 affects *how* NPCs speak, not *who* appears (deferred to v2; see §11).
- A memory-browser **UI** (the table + `messageId` provenance make a debug view a cheap future add).
- Cross-campaign memory; multi-player; emotion models beyond a single valence scalar.

## 4. The simulation tick, and where memory attaches

`runPipeline` ([orchestrator.ts:34](server/pipeline/orchestrator.ts:34)) is one tick:

```
guard on → store user msg → load(session,campaign,chars,NPCs,last-14)
→ selectRelevantNPCs(top 3) → runDirector(storyState, npcAgendas, seeds) → decision
→ NARRATOR LLM (stream) → dice → snippets → cleanup → parse STATE_UPDATE
→ apply char/HP mutations → store assistant msg (assistantMessageId) → onComplete()
→ [in-memory] storyState handoff; stamp acting-NPC lastActedTurn
→ FIRE-AND-FORGET, concurrent, errors swallowed:
     3a extractSceneState     → sessions.sceneState
     3c extractNpcMemory       → npc_memory rows (currentState, disposition, voice)
     3d extractNarrativeState  → mergeStoryState + npc agendas + consequenceSeeds + reconcile(%15)  [ONE write]
     contextSummary(%10) · campaignJournal(%15) · title
→ image gen (waits on 3a/3c/3d) → finally: guard off
```

Memory attaches at exactly two points, both inside existing seams:

- **READ (retrieval):** in the standard path, after `selectRelevantNPCs` and before `buildNarratorPrompt` ([orchestrator.ts:206](server/pipeline/orchestrator.ts:206)–236). Skipped on the trivial path, consistent with how the trivial path already skips NPC memory.
- **WRITE (formation + sleep):** inside **step 3d** (`extractNarrativeState`'s `.then`, [orchestrator.ts:584](server/pipeline/orchestrator.ts:584)–690), which already runs once, already holds the merged story state + `assistantMessageId` + `nextTurn`, and already performs the consequence-seed write.

### Five constraints the tick imposes (and how the design honors each)

| # | Constraint observed in the tick | Design response |
|---|---|---|
| C1 | The clock is `storyState.turn`; everything ages by turn-staleness (`s.turn - thread.lastTouchedTurn`, [director.ts:75](server/pipeline/director.ts:75)). | Salience decays in **turns**, never wall-clock. |
| C2 | 3 LLM extraction calls already run per turn (+3 conditional) on one local GPU contending with ComfyUI for VRAM. | **No new call.** Formation rides `extractNarrativeState` via an added `memories` key. |
| C3 | Per-turn writes don't scale and pile on a busy tick. | **Lazy decay:** store `salienceBase` + `lastReinforcedTurn`; compute effective salience at *read*. Only consolidation writes periodically. |
| C4 | 3c, 3d's agenda update, and the acting-NPC stamp already concurrently RMW the same `npc_memory` row (safe only because columns differ — fragile). | Memories are a **separate table keyed by `npcId`**; inserts never collide with those row writers. |
| C5 | Reconcile + journal already both fire on `%15`. | Consolidation triggers **per-NPC by episodic count threshold**, distributed across NPCs/turns — not a global cadence. |

## 5. Data model — `memories` table

New table in `server/db/schema.ts` (mirrors `scene_images`' FK/cascade style and `StoryThread`'s turn-stamped style):

```ts
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  npcId: text("npc_id").notNull().references(() => npcMemory.id, { onDelete: "cascade" }), // the holder
  about: text("about").notNull(),                  // subject: "player" | an NPC name | a place/thing
  kind: text("kind", { enum: ["episodic", "semantic"] }).notNull().default("episodic"),
  content: text("content").notNull(),              // the remembered event, NPC's POV, LLM-authored
  valence: integer("valence").notNull(),           // -100..100 emotional charge (sign = good/bad)
  salienceBase: integer("salience_base").notNull(), // 0..100 at formation/reinforcement
  source: text("source", { enum: ["witnessed", "heard", "rumor"] }).notNull().default("witnessed"),
  confidence: integer("confidence").notNull().default(100), // 0..100; gossip lowers it
  threadId: text("thread_id"),                     // soft link to a session story thread
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }), // provenance
  introducedTurn: integer("introduced_turn").notNull(),
  lastReinforcedTurn: integer("last_reinforced_turn").notNull(),
  status: text("status", { enum: ["active", "consolidated", "forgotten"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_memories_npc_status").on(table.npcId, table.status),
  index("idx_memories_campaign").on(table.campaignId),
  index("idx_memories_thread").on(table.threadId),
]);
```

Notes:
- **`sessionId`/`messageId` are `set null` on delete**, not cascade — a memory should *survive* the deletion of the session/message that formed it (memory outlives the conversation). `npcId`/`campaignId` cascade (a deleted NPC/campaign has no memories).
- `salienceBase` + `lastReinforcedTurn` are the lazy-decay inputs; effective salience is never stored.
- A mirror TS type is added to `types/index.ts` (`NPCMemoryEntry`) per the repo convention that `types/index.ts` mirrors `schema.ts`.

## 6. Formation (write) — rides `extractNarrativeState`

**No new LLM call.** Extend the single existing extractor:

1. **`narrativeExtractor.ts`** gains a `memories` key in its prompt and parser. Each emitted memory: `{ npc, about, content, valence, salience, threadId? }` where **`npc` is the holder** (which NPC remembers this — must be an exact name from the in-scene NPC list) and **`about` is the subject** (`"player"` | another NPC name | a place/thing). The model writes `content` as the episodic line from `npc`'s point of view ("the player spared my brother at the bridge"). Holder and subject are distinct: different NPCs in the same scene can form different memories of the same moment, which is why retrieval (§7) is per-NPC. The prompt instructs: *only NPCs in the scene list may be a `holder`, only events worth remembering, at most N (e.g. 3) per turn.* Parsing is defensive and never throws (mirrors the existing `story`/`npc`/`world` parsing); a memory whose `npc` does not resolve to an in-scene NPC is dropped; missing/garbled → `[]`.
2. **`memory/store.ts`** exposes `formMemories(ctx, extracted)`:
   - Resolves `npc` (holder name) → an `npcId` among `relevantNPCs` (case-insensitive exact match; unresolved → drop the memory). Inserts as `source: "witnessed"`, `confidence: 100`, `introducedTurn = lastReinforcedTurn = nextTurn`, `sessionId`, `messageId = assistantMessageId`, `threadId` if supplied. **`threadId` can only reference a thread that existed at turn start** — the extractor runs before `mergeStoryState`, which mints fresh UUIDs for threads born this turn, so a memory cannot link to a same-turn-new thread (same inherent soft-link caveat as `world.newSeeds`); such memories carry no `threadId` until a later turn reinforces them.
   - **Reinforce-or-insert dedupe:** if the holder already has an `active` memory with the same `about` and high content similarity (normalized token overlap over a threshold), **bump** its `salienceBase` (capped at 100) and set `lastReinforcedTurn = nextTurn` instead of inserting a duplicate. This is what makes repeated events *stick* and grow, mirroring `thread.touchedCount`.
3. The orchestrator calls `formMemories` inside the step-3d `.then`, after `merged` is computed (so `threadId`s line up with merged threads), guarded so failures never break the turn. Per CLAUDE.md, formation logs on error rather than failing silently.

## 7. Retrieval (read) — hybrid scorer behind a stable interface

**`memory/retrieve.ts`** exposes:

```ts
retrieveMemories(args: {
  npcId: string;
  currentTurn: number;
  sceneText: string;       // player message + recent scene summary, for relevance
  k: number;               // hard cap per NPC (default 3)
}): Promise<RetrievedMemory[]>
```

- **Effective salience (pure, unit-tested):** `score = w_v·|valence| + w_r·recency(currentTurn - lastReinforcedTurn) + w_o·tagOverlap(sceneText, content) + w_s·sourceWeight(source, confidence)`. `recency` decays monotonically with turn delta (C1/C3). Always-included: the NPC's `semantic` impressions (consolidated beliefs), which are cheap and define baseline attitude.
- **Hybrid seam:** the relevance term (`tagOverlap`) is the *only* part an embedding ranker would replace. It lives behind a `RelevanceRanker` interface with a `KeywordRanker` default; an `EmbeddingRanker` can be registered later with zero changes to callers or to scoring.
- **Token budget:** `k` per NPC × `relevantNPCs` (≤3) bounds injected memory lines (≤ ~9 lines/turn). Content is truncated per line.

**Prompt injection** (`promptBuilder.ts`): inside the existing `[NPCS IN SCENE]` block ([promptBuilder.ts:103](server/pipeline/promptBuilder.ts:103)), each NPC gains a capped `REMEMBERS:` sub-list. `heard`/`rumor` memories are rendered with hedging ("believes…", "has heard…") so the narrator can voice uncertainty. This is the *only* change to the narrator prompt.

## 8. Lifecycle — lazy decay + threshold consolidation ("sleep")

- **Decay is lazy** (C3): never written per turn; computed in `retrieveMemories` from `currentTurn - lastReinforcedTurn`. A memory below an effective-salience floor at read time is simply not retrieved (and is a consolidation candidate).
- **Consolidation (`memory/consolidate.ts`)** triggers **per NPC** when that NPC's `active` episodic count exceeds a threshold (e.g. 12) — *not* on a global `%N` cadence (C5), so load spreads across NPCs and turns. On trigger, for that one NPC:
  1. Select the low-salience tail (oldest/faintest active episodics for a given `about`).
  2. Fold them into (or merge into an existing) `semantic` memory — a compact impression ("has come to distrust the player"). This MAY reuse the extractor model opportunistically; if cost is a concern it can summarize deterministically from valence/`about` aggregates. **Decision deferred to the plan**, but it must not add a *guaranteed* per-turn call — consolidation is rare (threshold-gated) so an occasional summarizing call is acceptable.
  3. Mark the folded raws `status: "consolidated"` (kept for provenance, excluded from retrieval) — bounded storage.
- This is invoked from step 3d, after formation, for the scene NPCs only (so it never scans the whole campaign per turn).

## 9. Reputation — gossip on the sleep pass (`memory/gossip.ts`)

- **Trigger:** runs in the same step-3d window, using **scene co-presence** — the `relevantNPCs` plus `sceneState.activeNPCs` present this turn. Note `sceneState.activeNPCs` is `{name, desc, disposition}[]` (names only, and it is the *prior* turn's value since step 3a updates it asynchronously after this turn); gossip resolves those names to `npc_memory` rows by case-insensitive name match and tolerates the one-turn-stale read (gossip is already deliberately slow). Not every turn for every NPC; gated by the same kind of light cadence/threshold as consolidation so it stays bounded and *feels* like word travelling slowly rather than telepathy.
- **Mechanism:** for each co-present pair, an NPC's **high-salience** memories `about: "player"` that the other does **not** already hold (dedupe by `about` + similarity) are copied to the other as new rows with `source: "heard"` (or `"rumor"` if the originator's own confidence is already low), `confidence = round(origin.confidence · 0.6)`, and `salienceBase` softened. Optional light distortion of `content` is a v2 nicety, not required for v1.
- **Anti-amplification:** copies are `heard`/`rumor` and never re-gossiped above their (lowered) confidence; a per-pair-per-window cap prevents floods. Confidence decays each hop so rumors fade, not snowball.

## 10. Director hook — one resurfacing mechanism (G4)

"Consequences resurface" is **not** a new engine. In step 3d, after formation/consolidation, `memory/store.ts` exposes `memoriesToSeeds(npcId-set, currentTurn)` returning at most one candidate `WorldSeed` (`{trigger, echo, threadId?}`) derived from a **hot, unresolved, negatively-charged** memory (high effective salience, `about: "player"`, tied to an open/escalating thread). These candidates are appended to the existing `ex.world.newSeeds` array **before** the existing seed-merge/cap logic ([orchestrator.ts:634](server/pipeline/orchestrator.ts:634)–643). The director then surfaces them through the unchanged `consequenceSeeds` path. Memory thus *feeds* the existing system; the director and seed cap (8) remain the single source of truth for resurfacing.

## 11. v1 vs v2 boundary

- **v1 (this spec):** substrate + formation + retrieval/injection + decay + consolidation + gossip + seed-feed. Memory changes *how NPCs speak and what consequences brew*.
- **v2 (designed-for, not built):** memory-driven **selection/spotlight** — an NPC carrying a hot unresolved memory becomes a `selectRelevantNPCs`/director candidate even without keyword match, so a wronged NPC can re-enter a scene on their own. The schema and `retrieveMemories` already support this; v2 adds a scoring term to selection only.

## 12. Failure & cold-start behavior (no regression floor)

- **Cold start:** empty `memories` table → `retrieveMemories` returns `[]` → the `[NPCS IN SCENE]` block renders exactly as today. Memories accrue from the first standard turn forward. (Optional, plan-time: backfill one `semantic` memory per existing NPC from its `currentState`.)
- **Extractor failure:** the `memories` key parses to `[]` on garbled JSON; formation/consolidation/gossip are wrapped so any throw is logged and swallowed — the turn, the narrator output, and all existing extractors are unaffected.
- **Trivial path:** unchanged — no retrieval, no formation (consistent with its existing skip of NPC memory). Lazy decay means turns still age memories correctly with zero writes.

## 13. Testing (the unit-tested zones per CLAUDE.md → `tests/convex/`)

- **Scorer** (`retrieve`): valence/recency/overlap/source weighting; turn-delta decay is monotonic; `semantic` always included; `k` cap respected.
- **Dedupe/reinforce** (`store`): same-`about` similar content bumps salience + `lastReinforcedTurn` instead of inserting; distinct events insert.
- **Consolidation** (`consolidate`): fires only past threshold; folds the faint tail; marks raws `consolidated`; bounded output.
- **Gossip** (`gossip`): only high-salience player-memories copy; `confidence·0.6`; already-known dedupe; no re-amplification; per-window cap.
- **Parser** (`narrativeExtractor`): `memories` key parses defensively; malformed → `[]`; never throws (extends existing parser tests).
- **Seed feed** (`memoriesToSeeds`): at most one candidate; only hot/unresolved/negative; respects the existing 8-seed cap downstream.
- **E2E (optional, env-gated):** extend `scripts/agency.test.mts` (`PLAY_LOOP=1`) to assert a memory formed in an early turn is recalled in a later turn's prompt.

## 14. Migration & rollout

1. `schema.ts`: add `memories` table → `npx drizzle-kit generate` + `push`.
2. `types/index.ts`: add `NPCMemoryEntry` mirror type.
3. `narrativeExtractor.ts`: add `memories` to prompt + parser (+ tests).
4. `server/pipeline/memory/*`: `store`, `retrieve`, `consolidate`, `gossip` (+ tests).
5. `promptBuilder.ts`: `REMEMBERS:` sub-block in `[NPCS IN SCENE]`.
6. `orchestrator.ts`: retrieval before narrator prompt; formation + consolidation + gossip + seed-feed inside the step-3d `.then`.
7. (Optional) `server/routers/*`: a read-only `memories.listByNpc` for a future debug view.
8. `npm test`; env-gated E2E.

## 15. Open questions for the plan

- Exact decay curve and scorer weights (`w_v/w_r/w_o/w_s`) — tune against the play-loop.
- Consolidation summarizer: deterministic vs. opportunistic LLM call (must not become a guaranteed per-turn call).
- Similarity function for dedupe (normalized token-set overlap threshold) — start simple, keep behind a helper for later upgrade.
- Backfill of `semantic` memories from existing `currentState` on first run: do it or not.
- `extractNarrativeState` currently runs at `maxTokens: 400` for story+npc+world; adding the `memories` array (≤3 NPC-POV lines/turn) competes for that budget — confirm 400 still suffices or bump it.
