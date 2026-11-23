# The Narrative Pipeline

The pipeline turns a single player message into a streamed GM response, resolving dice mechanics, mutating character state, and updating long-term narrative memory. Entry point: `runPipeline` in `server/pipeline/orchestrator.ts`, invoked by `POST /api/chat/stream`.

## Streaming entry point — `app/api/chat/stream/route.ts`

A single `POST` handler. Request body: `{ sessionId, message, metadata? }` (validates `sessionId` and `message` are non-empty strings, else `400`). It returns a `ReadableStream` with `Content-Type: text/event-stream` and calls `runPipeline`, forwarding three callbacks that emit SSE lines (`data: ${JSON}\n\n`):

| Event | Payload | Meaning |
|-------|---------|---------|
| `token` | `{type:"token", text}` | a chunk of narrator output |
| `done` | `{type:"done", text, messageId}` | final text and the saved assistant message id; stream closes |
| `error` | `{type:"error", message}` | pipeline failure; stream closes |

The client consumer is `hooks/use-chat.ts` (`fetch` + `response.body.getReader()`), which appends `token` text to `streamingText`, and on `done` invalidates `messages.listBySession` + `characters.listByCampaign`.

## `runPipeline` — orchestration

Signature: `runPipeline({ sessionId, message, metadata?, onToken, onComplete, onError })`.

Key constants:
- `NARRATOR_OPTIONS` = `{ temperature: 0.7, maxTokens: 1024, topP: 0.92, topK: 40, repeatPenalty: 1.1, repeatLastN: 64 }`
- `SNIPPET_OPTIONS` = `{ temperature: 0.3, maxTokens: 512 }`
- `FALLBACK_MODEL` = `"mistral:7b-instruct"`

### Shared setup (both paths)

1. Acquire processing lock: set `sessions.processingStartedAt = Date.now()`.
2. Insert the user message.
3. Load context: session (404 if missing), campaign, all characters, `userSettings` (`id="default"`), all `npcMemory` for the campaign.
4. Resolve target: `baseUrl = settings.ollamaBaseUrl ?? "http://localhost:11434"`, `model = settings.selectedModel ?? "gemma3:12b"`.
5. Classify: `complexity = classifyInput(message)`; `sceneType = classifyScene(message, session.sceneState)`; `narratorOptions = getSceneOptions(sceneType)`.
6. Fetch last 14 messages (reversed to chronological), strip `[MECHANIC...]` markers and run `deduplicateContent`. Keep up to 3 most recent assistant contents (`lastAssistantMessages`).

The `finally` block always clears `processingStartedAt`. The outer `catch` calls `onError`.

### Trivial path (`complexity === "trivial"`)

For OOC notes, one-word replies, and stat/recap queries. Skips NPC memory, dice, and the post-turn extraction job. It still runs the director (`runDirector(storyState)`) so the prompt carries the `[DIRECTOR]` block, makes a single narrator call (fallback model on error), runs `cleanGibberish`, parses STATE_UPDATE, and persists everything through one `commitTurn` transaction (message, character mutations, advanced `storyState.turn`).

### Standard path

Stage summary (the code in `server/pipeline/orchestrator.ts` and `server/pipeline/turn/*` is authoritative; see `CLAUDE.md` and `ARCHITECTURE.md` for the director, NPC agenda and consequence-seed details):

1. **Select + direct:** `selectRelevantNPCs` picks up to 3 NPCs, memories are retrieved per NPC, and `runDirector(storyState, npcs)` produces a `DirectorDecision` (phase, tension, intent, word budget, spotlight thread, acting NPC, GM initiative, at most one thread-linked consequence echo). It replaces the old pacing-beat and narrative-arc stages.
2. **Prompt:** `buildNarratorPrompt` assembles the system prompt, including the `[DIRECTOR]` control block (see below).
3. **Narrator (streaming):** `narrate()` streams the draft (retry, then fallback model). Tokens go through `streamBeforeMarker` (`utils.ts`), which stops forwarding at the first `[MECHANIC`, `<!--`, `STATE_UPDATE` or `[DIRECTOR`, so the player never sees control blocks. `retryShortDraft` re-asks if the draft is too short.
4. **Mechanics:** `resolveTurnMechanics` (`turn/mechanics.ts`) parses `[MECHANIC:...]` markers, rolls them (`diceResolver.ts`), writes an outcome-aware ending via `buildSnippetPrompt` (the snippet replaces the marker and the pre-roll draft ending), drops sentences that echo the player's action, cleans gibberish, and parses STATE_UPDATE. Each outcome is streamed as `🎲 *...*`.
5. **Commit:** `commitTurn` (`turnCommit.ts`) runs one transaction: STATE_UPDATE first, then dice damage against freshly re-read HP, then the assistant message and director bookkeeping. Then `onComplete(finalText, assistantMessageId)` (the trivial path passes its message id too).
6. **Background (after `onComplete`):** work is queued per session (`backgroundQueue.ts`) and errors are logged server-side, never sent over SSE:
   - `runStateJob` (`turn/stateJob.ts`, key `turnStateKey`): `extractNarrativeState` (threads, tension, scene, NPC updates, memories, consequence seeds), memory formation, seed bookkeeping (remove the surfaced echo, decrement the rest, append new seeds, cap 8), a campaign reconcile on its cadence, then one `commitTurnState` transaction (`applyNpcUpdates` writes NPC memory; see `docs/NPC_MEMORY.md`). The next turn waits for this job before reading `storyState`.
   - `updateContextSummary` / `updateCampaignJournal` (`turn/auxTasks.ts`, key `sessionAuxKey`), memory consolidation and gossip.
   - `maybeGenerateTitle` is the one fire-and-forget task.
   - Scene images are **not** started by turns. They are player-triggered via the chat's Illustrate button (`images.illustrate`). See `docs/IMAGE_GENERATION.md`.

## Pipeline stages (per file)

All stages except the LLM-backed extractors are deterministic and unit-tested.

### `classifier.ts`
`classifyInput(message): "trivial" | "standard"` — regex match against trivial patterns (OOC, `/` commands, parentheticals, yes/no/ok, "what's my hp/stats", "where am i", recap/summary). No LLM.

### `sceneClassifier.ts`
`classifyScene(message, sceneState?): SceneType` (combat | exploration | dialogue | stealth | emotional) via regex priority, falling back to `sceneState.situation`, else exploration. `getSceneOptions(sceneType)` returns Ollama options tuned per scene (e.g. combat temp 0.5, exploration 0.8). No LLM.

### `npcSelection.ts`
`selectRelevantNPCs(message, lastAssistantMessages, allNPCs, maxCount=3)` — priority: NPCs named in the current message → in recent assistant messages → backfill by most recent `lastInteractedAt`. No LLM.

### `director.ts` and `narrativeExtractor.ts`
`runDirector` decides phase, tension, intent, spotlight thread, acting NPC, GM initiative and the consequence echo for the turn (deterministic, no LLM); `extractNarrativeState` is the LLM-backed post-turn extractor that feeds `sessions.storyState`. They replaced the old `pacing.ts` / `narrativeArc.ts` stages. See `ARCHITECTURE.md`.

### `diceResolver.ts`
- `parseMarkers(text): MechanicMarker[]` — regex `/\[MECHAN\w*:([^\]]+)\]/gi`; types `stat_check`, `save` (`{stat, dc}`), `damage` (`{dice}`), `contest` (`{stat, modifier}`).
- `cryptoRoll(min, max)` — uniform RNG via `crypto.getRandomValues` with rejection sampling.
- `resolveMechanics(draft, character)` — d20 + modifier vs DC for checks/saves; rolls notation for damage; opposed rolls for contests. Modifiers prefer `statModifiers[stat]`, else D&D-style `floor((stat-10)/2)`.
- `substituteMarkers(draft, markers, snippets, { rewriteTail? })` — replaces markers back-to-front with snippet prose; with `rewriteTail` the last snippet also replaces everything after its marker.
- `keepFirstMarker(draft)`, `matchStat(stat, keys)`, `dropEchoedSentences(snippet, context)` — see the turn flow above.

### `snippetWriter.ts`
`parseSnippets(response): Map<number,string>` (parses `#N: text`, keeping paragraph breaks and `>` dialogue lines) and `getMarkerContext(text, start, end)` (±100 chars around a marker). No LLM.

### `stateParser.ts`
`parseStateUpdate(response): { cleanedContent, stateUpdate }` — see below. No LLM.

### `promptBuilder.ts` (the live prompt assembly)
- `buildNarratorPrompt(ctx, userMessage)` — the narrator system prompt (sectioned, see below).
- `buildSnippetPrompt(campaign, characters, resolutions)` — instructs the model to write prose for resolved mechanics in `#N: {prose}` form.

### `utils.ts`
`findAffectedCharacter(narrativeContext, chars)` — picks the character named in a text window (used to attribute dice/damage in multi-character parties).

## System prompt assembly

The **live** prompt is built by `buildNarratorPrompt`. It is a sectioned string sent as the `system` message (player message sent as `user`):

`[ROLE]` (immersive GM persona, parameterized by genre) · `[WORLD]` · `[TONE]` · `[STYLE]` (per-genre style map) · `[DIRECTOR GOALS]` (plot hooks) · `[CURRENT SCENE]` (recent messages) · `[PRIOR CONTEXT]` (`contextSummary`) · `[SCENE STATE]` (location/NPCs/threats — "ground truth") · `[PLAYER CHARACTER]` (HP/stats/inventory) · `[NPCS IN SCENE]` (personality, disposition, voice) · `[DIRECTOR]` (phase/tension/intent, spotlight, acting NPC, initiative, echo) · `[HARD RULES]` (word budget, STATE_UPDATE mandate, formatting) · `[PLAYER ACTION]` · `[MECHANICS FORMAT]` (marker syntax; at most one marker per response).

> `promptBuilder.ts` is the only prompt builder. (An older, unused `systemPrompt.ts` / `buildSystemPrompt` that carried a divergent STATE_UPDATE/format spec was removed — don't reintroduce a second prompt assembly.)

## State mutations

The narrator appends a block:

```
<!-- STATE_UPDATE {"characters": {"CharacterName": {"addInventory": ["item"], "removeInventory": ["item"], "statusNotes": "new status", "statChanges": {"StatName": delta}}}} STATE_UPDATE -->
```

`parseStateUpdate` strips all such blocks, `JSON.parse`s each, and merges multiple blocks (inventory arrays concatenated, statusNotes overwritten, statChanges deltas summed). Application (in the orchestrator):

- Match character by case-insensitive trimmed name.
- `statChanges`: additive deltas. **Standard path skips HP deltas if a `damage` marker already targets that character** (`hasDamageForThisChar`). HP is clamped to `[0, MaxHP]` (keys `HP`/`hp`, `MaxHP`/`maxHp`).
- `addInventory` appended; `removeInventory` removed case-insensitively (missing items warned).
- `statusNotes` overwritten if present.
- Persisted via a single `db.update(characters)` only when something changed.

Dice `damage` is applied separately: damage is grouped per affected character, characters are re-fetched fresh, HP reduced via `Math.max(0, hp - damage)`. This dual path is intentional — preserve the de-confliction if you modify HP handling.

## LLM sub-tasks at a glance

| Task | Temp | Max tokens | Streaming |
|------|------|-----------|-----------|
| Narrator (main) | scene-tuned | 1024 | yes |
| Snippet rewrite | 0.3 | 512 | no |
| Scene state extract | 0.1 | 256 | no |
| Consequence seeds | 0.3 | 128 | no |
| NPC memory extract | 0.2 | 128 | no |
| Context summary | 0.2 | 256 | no |
| Campaign journal | 0.3 | 256 | no |
| Session title | 0.7 | 20 | no |

All go through `callOllama` (`server/llm/providers.ts`) with the user's selected model, falling back to `mistral:7b-instruct` for narrator/snippet calls on error. Extractors defensively pull JSON from model output via `response.match(/\{[\s\S]*\}/)`.
