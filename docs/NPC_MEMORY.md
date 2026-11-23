# NPC Memory System

NPCs in this app are persistent: they remember who they are, who they've met, how they feel about them, what they're hiding, and how they speak. This memory survives across sessions within a campaign and feeds back into the narrator prompt so NPCs behave consistently.

## Data model — `npc_memory`

Defined in `server/db/schema.ts` (const `npcMemory`). One row per NPC per campaign.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | text PK (UUID) | |
| `campaignId` | text FK→campaigns (cascade) | owning campaign |
| `name` | text | NPC name (matched case-insensitively) |
| `personality` | text | core personality description |
| `location` | text | where the NPC currently is |
| `relationships` | JSON `{target, disposition (−100..100), lastInteraction}[]` | feelings toward others (including the player) |
| `secrets` | JSON `string[]` | facts the NPC is hiding |
| `revealedInfo` | JSON `string[]` | secrets/info already disclosed to the player |
| `memoryLog` | JSON `{sessionId, summary, emotionalShift}[]` | episodic memory, **capped at 20 entries** |
| `deepHistory` | text? | long-form backstory |
| `currentState` | text | current mood/status |
| `speechPattern` | text? | how the NPC talks (cadence, verbal tics) |
| `vocabulary` | text? | characteristic words/phrases |
| `lastInteractedAt` | integer? | epoch ms of last interaction |

Indexes: `idx_npc_memory_campaign` on `campaignId`, `idx_npc_memory_campaign_name` on `(campaignId, name)`. There is no `createdAt` column.

## API — `server/routers/npcMemory.ts`

- **`getByCampaign` (query `{campaignId}`)** — all NPC memories for a campaign. Powers the `/campaigns/[campaignId]/npcs` page.
- **`upsert` (mutation)** — input: `campaignId`, `name`, `personality`, `location`, `relationships` (default `[]`), `secrets` (default `[]`), `revealedInfo` (default `[]`), `memoryLog` (default `[]`), `deepHistory?`, `currentState`, `lastInteractedAt?` (defaults to now). Matches an existing NPC by **case-insensitive name** within the campaign (`lower(name) = lower(input)`); updates if found, else inserts. Clamps each relationship disposition to `[−100, 100]` and caps `memoryLog` to the last 20 entries.

Constants: `MAX_MEMORY_LOG = 20`, disposition range `[−100, 100]`.

> **Gotcha:** `upsert` does **not** accept `speechPattern` or `vocabulary`, even though the columns exist. Those fields are written only by the pipeline's `applyNpcUpdates` (`server/pipeline/turnCommit.ts`, called from `commitTurnState`). If you need to set them via the API, extend the `upsert` input schema first.

## How NPCs get selected into a scene

During the standard pipeline path, `selectRelevantNPCs(message, lastAssistantMessages, allNPCs, maxCount=3)` (`server/pipeline/npcSelection.ts`) chooses up to 3 NPCs to include in the narrator prompt, by priority:

1. NPCs named in the current player message.
2. NPCs named in the last few assistant messages.
3. Backfill by most recent `lastInteractedAt`.

Name matching is full-name substring **or** any name-word of ≥3 chars matched on word boundaries.

## How NPCs enter the narrator prompt

`buildNarratorPrompt` (`server/pipeline/promptBuilder.ts`) renders the selected NPCs in the `[NPCS IN SCENE]` section, including: personality (truncated ~120 chars), a disposition word derived from the NPC's relationship toward the player (`dispositionWord`: ≥50 friendly, ≥20 warm, ≥−20 neutral, ≥−50 cool, else hostile), last interaction, and optional `VOICE` (speechPattern) + vocabulary. This is what makes NPCs feel consistent turn-to-turn.

The session-level `sceneState.activeNPCs` (a lighter `{name, desc, disposition}[]` snapshot) is separate and is maintained by the scene-state extractor; it provides "ground truth" about who is physically present.

## How NPC memory is updated

After each standard turn, the background state job (`runStateJob` in `server/pipeline/turn/stateJob.ts`) updates NPC memory:

1. `extractNarrativeState` (`server/pipeline/narrativeExtractor.ts`) asks the model for one JSON reply; its `npc` key lists per-NPC updates (name, new state, speech pattern, vocabulary, goal, agenda, agenda thread).
2. `commitTurnState` applies them in the same transaction as the story/scene state via `applyNpcUpdates`: updates `currentState` and `lastInteractedAt`, may set `speechPattern`/`vocabulary`/`goal`/`agenda`/`agendaThreadId`, and inserts unknown NPCs. It writes the rows directly (not via the `upsert` procedure, which is why those fields bypass the API schema).

The job runs in the per-session background queue after the turn is delivered; a failed extraction is logged server-side (`[background:<key>]`) and leaves NPC memory unchanged for that turn.

## Frontend — the NPC page

`/campaigns/[campaignId]/npcs` (`app/campaigns/[campaignId]/npcs/page.tsx`) renders each NPC as a card (local `NpcCard` component): personality, location, relationships with a `DispositionBar` (−100..+100), spoiler-masked `secrets`, a `memoryLog` timeline, `deepHistory`, and speech pattern / vocabulary. Data comes from `trpc.npcMemory.getByCampaign`.

## NPC agendas and director-driven initiative (Phase 2)

Four columns were added to `npc_memory` in Phase 2 of the narrative-director feature:

| Field | Type | Purpose |
|-------|------|---------|
| `goal` | text? | Long-term want (e.g. "protect the secret at all costs") |
| `agenda` | text? | Immediate next move targeting a specific story thread |
| `agendaThreadId` | text? | The `SessionStoryState` thread id the NPC is acting on |
| `lastActedTurn` | integer? | `storyState.turn` of the last turn this NPC took initiative |

**How agendas are set:** after each turn `extractNarrativeState` sends an `npc.updates` array in its JSON reply (alongside the `story` key). For each NPC that spoke or acted during the turn the model supplies a `goal`, `agenda`, and which thread id the agenda targets. The orchestrator applies these updates to the `npc_memory` rows (fire-and-forget, errors swallowed) and sets `thread.ownerNpcId` in `storyState` for any thread that gains an NPC owner.

**How initiative is handed out:** `runDirector(storyState, npcs)` now accepts an `NpcAgendaLite[]` second argument. After computing the spotlight thread it selects the NPC whose `agendaThreadId === spotlight.id`, provided `storyState.turn - lastActedTurn >= NPC_ACT_GAP` (constant = 2). The chosen NPC is surfaced in the `[DIRECTOR]` block as a single sentence: `${name} acts on their own aim now: ${agenda}${voice ? " (their voice: …)" : ""}`. This line nudges the narrator to let the NPC drive the scene; it does not force dialogue or override narration tone. If no NPC qualifies, no line is added and the director block is unchanged.

**Gotcha:** `upsert` (the tRPC procedure) still does **not** accept `goal`, `agenda`, `agendaThreadId`, or `lastActedTurn`. Those fields are written only by the pipeline's orchestrator. Extend the `upsert` input schema in `server/routers/npcMemory.ts` if you need to set them via the API.

## Extending the system

- **To persist a new NPC attribute:** add the column in `server/db/schema.ts` → mirror it in `types/index.ts` (`NPCMemoryDoc`) → extend the `upsert` zod input and/or the `applyNpcUpdates` writer → surface it in `buildNpcExtractPrompt` and `buildNarratorPrompt` if it should influence narration → display it on the NPC card.
- **To change how NPCs are chosen for a scene:** edit `selectRelevantNPCs` (and its `maxCount`). It's pure and unit-tested in `tests/pipeline/npcMemory.test.ts`.
- **To change disposition wording/thresholds:** edit `dispositionWord` in `promptBuilder.ts`.
