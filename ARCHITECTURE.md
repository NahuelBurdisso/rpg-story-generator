# RPG Story Generator — Architecture

> **Status:** This document reflects the implementation as of the current codebase. It was rewritten from scratch after the original (Convex-based) design diverged from what was actually built. The app today runs on **tRPC + Drizzle/SQLite** with a **local-first AI stack** (Ollama for text, ComfyUI/SDXL for images).

## Overview

An RPG Story Generator where a single user plays narrative campaigns driven by local LLMs. Users create campaigns with configurable settings, build characters, and play sessions through a chat interface where the LLM acts as narrator / game master. A multi-stage server-side pipeline adds dice mechanics, a story director (threads, tension, NPC agendas), NPC memory, and optional AI scene illustration.

**Stack:** Next.js 15 (App Router, Turbopack) · React 18 · TypeScript (strict) · Tailwind CSS + shadcn/ui (new-york) · tRPC v11 + TanStack Query v5 · Drizzle ORM over better-sqlite3 · Vitest.

**AI stack (local):** Ollama (text generation, default `http://localhost:11434`) · ComfyUI + Stable Diffusion XL (image generation, `http://localhost:8188`), orchestrated via Docker Compose. OpenAI and Anthropic are supported as alternative text providers.

### Key architectural decisions

1. **tRPC + Drizzle/SQLite, not Convex.** All data lives in a local SQLite file (`./data/rpg.db`) accessed through Drizzle ORM. The API layer is a tRPC router mounted at `/api/trpc`. There is no Convex anywhere in the project.
2. **SSE streaming over a dedicated route, not reactive queries.** Chat generation streams from `POST /api/chat/stream` as Server-Sent Events. The client consumes it with `fetch` + a `ReadableStream` reader (see `hooks/use-chat.ts`), **bypassing tRPC** for the streaming path. Completed messages are then re-fetched via tRPC query invalidation.
3. **Multi-stage narrative pipeline.** A single user message runs through `runPipeline` (`server/pipeline/orchestrator.ts`): input classification → scene classification → NPC selection → story director → prompt assembly → narrator generation → dice resolution → snippet rewriting → one transactional state commit → background extractors (story/scene state, consequences, NPC memory, summaries, title). Scene images are never part of a turn; they are player-triggered.
4. **Deterministic dice with `crypto`.** Dice are resolved server-side via rejection-sampled `crypto.getRandomValues`, triggered by inline `[MECHANIC:...]` markers the LLM emits. Resolved outcomes are rewritten into prose by a second LLM pass.
5. **Local-first text models.** The default model is `gemma3:12b` served by Ollama; the pipeline and prompts assume an immersive game-master persona. Cloud providers (OpenAI/Anthropic) are optional alternatives.
6. **Optional AI image generation.** Player-triggered only (the chat's Illustrate button; turns never start a generation); a two-pass LLM writes the SD prompt; ComfyUI renders it; a VRAM manager arbitrates GPU use between Ollama and ComfyUI.
7. **No authentication (v1).** Single implicit user. `userSettings` is a singleton row (`id = "default"`). API keys are stored plaintext in SQLite but stripped from all client-facing responses.
8. **Character state via structured LLM output.** The narrator appends a `<!-- STATE_UPDATE {...} STATE_UPDATE -->` block; the server parses it, strips it, and applies inventory/stat/status mutations.

---

## Repository Layout

```
rpg-story-generator/
├── app/                      # Next.js App Router (pages + API routes)
│   ├── api/
│   │   ├── trpc/[trpc]/       # tRPC fetch adapter (GET/POST)
│   │   ├── chat/stream/       # SSE chat streaming endpoint (POST)
│   │   └── images/
│   │       └── rpg/[...path]/  # serves generated PNGs (path-traversal guarded)
│   ├── dashboard/             # campaign list
│   ├── campaigns/             # campaign CRUD, characters, sessions, npcs, gallery
│   └── settings/              # LLM provider config
├── components/                # React components (see Component Tree)
├── hooks/                     # use-chat (SSE), use-session-messages (paginated history), use-session-opener, use-image-status (trpc.images.status polling), use-copied-flag, use-focus-trap
├── lib/                       # client-safe: enums, constants (labels, genre classes), dice, stats, narrative (markers + STATE_UPDATE split), json-scan, messages, campaign-input, character-links, utils, trpc client
├── server/                    # all backend logic (NOT Convex)
│   ├── config.ts              # server-only env/config (zod-validated)
│   ├── db/                    # schema.ts (row types), jsonTypes.ts (JSON shapes), jsonSchemas.ts (validated reads), open.ts (migrations at boot)
│   ├── trpc.ts                # tRPC init + context
│   ├── root.ts                # appRouter composition
│   ├── routers/               # one tRPC router per domain
│   ├── llm/                   # providers.ts (dispatch + errors), ollama/openai/anthropic.ts, streamLoop.ts, config.ts, gpuGate.ts
│   ├── pipeline/              # the narrative pipeline (orchestrator.ts + turn/* stages, sessionEnd.ts, ...)
│   └── image/                 # ComfyUI/SDXL image-generation subsystem
├── types/                     # shared TypeScript types (re-exports derived from the schema)
├── tests/                     # Vitest (components, lib, pipeline, server)
├── scripts/                   # start/stop docker services
├── docker-compose.yml         # comfyui + ollama services
├── drizzle.config.ts          # SQLite migration config
└── docs/                      # deep-dive docs (PIPELINE, NPC_MEMORY, IMAGE_GENERATION)
```

---

## Data Models

SQLite via Drizzle (`server/db/schema.ts`). All primary keys are `text` UUIDs (`crypto.randomUUID()`) unless noted; all timestamps are `integer` epoch-ms (`Date.now()`). `foreign_keys = ON` and `journal_mode = WAL` are set when the DB is opened (`server/db/open.ts`, which also applies pending migrations from `./drizzle`), so cascade deletes are enforced.

### `campaigns`
`id`, `name`, `genre` (enum: fantasy, sci-fi, horror, post-apocalyptic, custom), `customGenre?`, `tone` (serious, humorous, dark, lighthearted), `difficulty` (easy, normal, hard, nightmare), `worldDescription` (default `""`), `customRules?`, `campaignJournal?`, `storyState?` (JSON `CampaignStoryState`: long-running threads promoted from sessions), `statDefinitions` (JSON `string[]`), `quickActions` (JSON `{label, prompt}[]`), `plotHooks` (JSON `string[]`), `imageStyle` (enum of 9 styles, default `painterly-fantasy`), `imageEnabled` (boolean, default false), `customImageConfig?` (JSON `{checkpoint?, lora?:{name,strength}, negativePrompt?, defaultDimensions?:{width,height}}`), `lastPlayedAt?`, `createdAt`.
Index: `idx_campaigns_last_played` on `lastPlayedAt`.

### `characters`
`id`, `campaignId` (FK→campaigns, cascade), `name`, `role`, `backstory`, `stats` (JSON `Record<string,number>` — keys match `campaign.statDefinitions`), `inventory` (JSON `string[]`), `appearance?` (JSON traits: build, height, age, skinTone, hairColor, hairStyle, eyeColor, eyeFeature, clothing, features), `statusNotes?`, `portraitUrl?`, `createdAt`.
Index: `idx_characters_campaign` on `campaignId`.

### `sessions`
`id`, `campaignId` (FK→campaigns, cascade), `title`, `summary?`, `contextSummary?` (rolling summary of older messages), `status` (active | completed, default active), `processingStartedAt?` (turn lock, see `sessionLock.ts`; stale after 3 min), `lastSummaryAt?`, `consequenceSeeds` (JSON `{trigger, echo, messagesUntilEcho, threadId?}[]`), `storyState?` (JSON `SessionStoryState`: arc phase, tension, story threads), `sceneState?` (JSON `{location, activeNPCs:{name,desc,disposition}[], situation, pendingThreats[], timeOfDay}`), `lastImageMessageCount?`, `startedAt`, `endedAt?`.
Index: `idx_sessions_campaign_started` on `(campaignId, startedAt)`.

### `messages`
`id`, `sessionId` (FK→sessions, cascade), `role` (user | assistant | system), `content`, `streamingText?`, `isStreaming` (default false), `metadata?` (JSON `{diceRoll?:{dice,result}, action?, error?, errorType?, errorMessage?, imageId?}`), `createdAt`.
Index: `idx_messages_session_created` on `(sessionId, createdAt)`.

### `userSettings` (singleton, `id = "default"`)
`id`, `provider` (ollama | openai | anthropic, default ollama), `ollamaBaseUrl` (default `http://localhost:11434`), `openaiApiKey?`, `anthropicApiKey?`, `selectedModel?`, `maxContextMessages` (default 20), `createdAt`.
Lazily created by `getOrCreateSettings`. **API keys are never returned to the client** — queries expose only `hasOpenaiKey` / `hasAnthropicKey` booleans.

### `npcMemory`
`id`, `campaignId` (FK→campaigns, cascade), `name`, `personality`, `location`, `relationships` (JSON `{target, disposition (−100..100), lastInteraction}[]`), `secrets` (JSON `string[]`), `revealedInfo` (JSON `string[]`), `memoryLog` (JSON `{sessionId, summary, emotionalShift}[]`, capped at 20 entries), `deepHistory?`, `currentState`, `speechPattern?`, `vocabulary?`, `goal?`, `agenda?`, `agendaThreadId?`, `lastActedTurn?`, `lastInteractedAt?`. (No `createdAt` column.)
Indexes: `idx_npc_memory_campaign` on `campaignId`; `uq_npc_memory_campaign_lname` (unique, case-insensitive name per campaign).

### `memories`
Per-NPC episodic/semantic memories: `id`, `campaignId` (FK, cascade), `npcId` (FK→npcMemory, cascade), `about`, `kind`, `content`, `valence`, `salienceBase`, `source`, `confidence`, `threadId?`, `sessionId?`/`messageId?` (FK, set null), `introducedTurn`, `lastReinforcedTurn`, `status`, `createdAt`. Written by the pipeline (`server/pipeline/memory/*`); there is no tRPC router for it.

### `sceneImages`
`id`, `messageId` (FK→messages, cascade), `campaignId` (FK→campaigns, cascade), `sessionId` (FK→sessions, cascade), `triggerType` (scene_change | consequence | combat | gm_event | player_request), `sdPrompt`, `sdNegativePrompt`, `filePath?` (relative `rpg/<campaignId>/<imageId>.png`), `status` (generating | completed | failed | replaced, default generating), `width`, `height`, `progress` (default 0), `progressPhase` (default `preparing`), `characterId?` (no FK constraint), `contextSnapshot?` (JSON), `generationTimeMs?`, `seed?` (KSampler seed, enables exact reproduction), `createdAt`.
Indexes: `idx_scene_images_message`, `idx_scene_images_campaign_created`, `idx_scene_images_session_created`.

---

## API Surface (tRPC)

tRPC is initialized in `server/trpc.ts` with `createContext = () => ({ db })`; all procedures are `publicProcedure` (no auth, no data transformer). `server/root.ts` composes `appRouter = { campaigns, characters, sessions, messages, userSettings, npcMemory, images }`; routers read the DB from `ctx.db`. The client is `trpc = createTRPCReact<AppRouter>()` (`lib/trpc.ts`), wired through `httpBatchLink → /api/trpc` in `components/providers/trpc-provider.tsx`.

Full per-procedure documentation is below. Procedures throw `TRPCError NOT_FOUND` on missing rows.

### `campaigns`
- `list` (query) — all campaigns, ordered by `lastPlayedAt` desc.
- `get` (query `{id}`) — single campaign.
- `create` (mutation) — all campaign fields; sets `lastPlayedAt = Date.now()`.
- `update` (mutation `{id, ...optional}`) — partial update.
- `delete` (mutation `{id}`) — cascades to characters/sessions/messages/npcMemory/sceneImages. Returns `{success:true}`.

### `characters`
- `listByCampaign` (query `{campaignId}`).
- `get` (query `{id}`).
- `create` (mutation) — campaignId, name, role, backstory, stats, inventory, appearance?, statusNotes?, portraitUrl?.
- `update` (mutation `{id, ...optional}`).
- `delete` (mutation `{id}`).

### `sessions`
- `listByCampaign` (query `{campaignId}`) — ordered by `startedAt` desc.
- `get` (query `{id}`).
- `create` (mutation) — campaignId, title, summary?, contextSummary?, status (default active).
- `endSession` (mutation `{sessionId}`) — takes the same session lock a turn holds (`CONFLICT` if a turn is in flight, `NOT_FOUND` if missing), then delegates to `server/pipeline/sessionEnd.ts`: waits for the background queues, generates a short summary (falls back to `"Session ended."` on error), marks the session completed, sets `endedAt`/`summary`, and refreshes the campaign journal. Returns `{summary}`. The turn lock itself is not exposed over tRPC.

### `messages`
- `listBySession` (query `{sessionId, limit (1–100, default 30), cursor?: {createdAt, id}}`) — keyset pagination on `(createdAt, id)`, so a page boundary inside one millisecond neither skips nor repeats a row; returns `{messages (chronological), nextCursor?: {createdAt, id}}`. The chat reads it as an infinite query (`hooks/use-session-messages.ts`, merged by `lib/messages.ts` `mergePages`).
  > Messages are created only by the chat pipeline (`POST /api/chat/stream`), so this router is read-only. `metadata.imageId` is written server-side by the image router only.

### `userSettings`
- `get` (query) — settings with keys stripped (`hasOpenaiKey`/`hasAnthropicKey`).
- `listModels` (query `{provider?}`) — Ollama: live `GET {baseUrl}/api/tags`. OpenAI/Anthropic: hardcoded lists (Anthropic includes `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`, …). Returns `{provider, models}`.
- `update` (mutation `{provider?, ollamaBaseUrl?, openaiApiKey?, anthropicApiKey?, selectedModel?, maxContextMessages? (1–200)}`) — upserts singleton, returns keys-stripped result.

### `npcMemory`
- `getByCampaign` (query `{campaignId}`).
- `upsert` (mutation) — matches existing NPC by **case-insensitive name** within the campaign; clamps relationship dispositions to `[−100,100]`; caps `memoryLog` to 20 entries.
  > Note: `upsert` input does not accept `speechPattern`/`vocabulary` even though those columns exist (they are written by the pipeline's `applyNpcUpdates` in `server/pipeline/turnCommit.ts`).

### `images`
- `illustrate` (mutation `{sessionId, characterId?}`) — fire-and-forget scene image for a player request; answers once the `generating` row and the message's `imageId` exist; returns `{status: "started", imageId} | {status: "already_generating", imageId?} | {status: "no_content"} | {status: "unavailable"}` (`unavailable` when ComfyUI is down).
- `regenerate` (mutation `{imageId, customPositive?, customNegative?}`) — atomically creates a replacement row, marks the old one `replaced`, repoints the message's `metadata.imageId`. Returns `{status, newImageId}`.
- `status` (query `{imageId}`) — the `sceneImages` row or null.
- `listBySessionWithContext` (query `{sessionId}`) — images joined with message narrative text.
- `listByCampaignGrouped` (query `{campaignId}`) — images joined with message + session title (limit 100).
- `uploadReference` (mutation `{campaignId, characterName, imageBase64}`) — saves an IP-Adapter character reference.
- `getReference` (query `{campaignId, characterName}`) — `{exists, url?}`.

---

## Request Flows

### Chat turn (the core loop)

1. Player sends a message (or quick action) in `ChatContainer`. `hooks/use-chat.ts` issues `POST /api/chat/stream` with `{sessionId, message, metadata}`. A brand-new session instead sends `{sessionId, opener: true}` (`hooks/use-session-opener.ts`): the server builds the opening prompt (`server/pipeline/sessionOpener.ts`, same text as before) and stores it as a hidden user turn flagged `metadata.opener`; the chat list hides it (`isHiddenOpener`, with a prefix fallback for rows saved before the flag).
2. The route validates the body with zod (`sessionId`, `message` of 1 to 8000 chars, optional `metadata`; 400 otherwise), opens a `ReadableStream` and calls `runPipeline(...)`, forwarding three SSE event types: `token`, `done`, `error` (`data: {...}\n\n`).
3. `runPipeline` (`server/pipeline/orchestrator.ts`) acquires the session lock, stores the user message, loads context (`turn/context.ts`), classifies the input, and runs either the **trivial** or **standard** path (see `docs/PIPELINE.md`).
4. Narrator tokens stream to the client via `onToken`. The client accumulates them in a ref and flushes `streamingText` at most once per animation frame; `MessageList` renders it as a separate streaming bubble after the memoized saved list.
5. `done` carries the saved assistant message's `messageId`. The client keeps the streamed text, records the id and invalidates `messages.listBySession` + `characters.listByCampaign`; `ChatContainer` drops the streamed text in the same render in which the saved message shows up in the list (no blank frame, no duplicate).
6. After `onComplete`, post-turn work goes through the per-session background queue (`backgroundQueue.ts`): step 3 (`turn/stateJob.ts`: extraction of story/scene state, consequence seeds and NPC updates, then one `commitTurnState` transaction), the context summary, the campaign journal and memory consolidation/gossip. Title generation is fire-and-forget. Errors are logged on the server, not sent over SSE.

### Narrative director & thread-linked consequences

Before the narrator, `runDirector` (`server/pipeline/director.ts`) reads `session.storyState` and picks a spotlight thread (highest-weight active thread). Consequences are **thread-linked**: each `consequenceSeed` on `sessions.consequenceSeeds` carries `{ trigger, echo, messagesUntilEcho, threadId? }`. The director surfaces **at most one eligible echo per turn** (`messagesUntilEcho <= 0`), preferring a seed whose `threadId` matches the spotlight, then any escalating thread, then the first eligible. The chosen echo is set as `decision.consequenceEcho` and rendered as a line inside the `[DIRECTOR]` control block (which is stripped from player-facing text). After the turn, the surfaced seed is **removed** from `session.consequenceSeeds`, the remaining seeds are decremented, and new seeds from the narrative extractor are appended (capped at 8). The long arc persists across sessions via `reconcileCampaignThreads`, run on a ~15-message cadence to promote session threads to campaign scope (`campaign.storyState`). `scripts/agency.test.mts` is the env-gated E2E proof that a seeded, eligible, spotlight-linked consequence surfaces and is consumed in one live turn.

### Image generation (player-triggered)

The player presses Illustrate (`images.illustrate`) → a two-pass LLM writes the SD prompt → the VRAM manager unloads Ollama and acquires the GPU → ComfyUI renders the SDXL workflow (progress streamed over WebSocket) → the PNG is written under `D:/ai-output/rpg/<campaignId>/` and served via `/api/images/rpg/...`. `images.illustrate` answers once the `generating` row exists (returning its `imageId`, or `unavailable` if ComfyUI is down); the client polls `trpc.images.status` every 2s while the row is `generating`. See `docs/IMAGE_GENERATION.md`.

---

## Pages & Routes

| Route | File | Type | Description |
|-------|------|------|-------------|
| `/` | `app/page.tsx` | Server | Redirects to `/dashboard` |
| `/dashboard` | `app/dashboard/page.tsx` | Client | Campaign list |
| `/settings` | `app/settings/page.tsx` | Client | LLM provider config |
| `/campaigns/new` | `app/campaigns/new/page.tsx` | Client | Create campaign |
| `/campaigns/[campaignId]` | `.../page.tsx` | Client | Campaign detail (characters, sessions, journal) |
| `/campaigns/[campaignId]/edit` | `.../edit/page.tsx` | Client | Edit campaign |
| `/campaigns/[campaignId]/gallery` | `.../gallery/page.tsx` | Client | Campaign-wide image gallery (grouped by session) |
| `/campaigns/[campaignId]/npcs` | `.../npcs/page.tsx` | Client | NPC memory view (relationships, secrets, memory log) |
| `/campaigns/[campaignId]/characters/new` | `.../new/page.tsx` | Client | Create character |
| `/campaigns/[campaignId]/characters/[characterId]` | `.../page.tsx` | Client | Edit character |
| `/campaigns/[campaignId]/sessions/[sessionId]` | `.../page.tsx` | Client | Play session (chat UI) |
| `/campaigns/[campaignId]/sessions/[sessionId]/gallery` | `.../gallery/page.tsx` | Client | Per-session gallery |

All page components are `"use client"`. Dynamic rendering is forced once, in the root `app/layout.tsx` (a server component, `export const dynamic = "force-dynamic"`): a dynamic root segment makes every route below it dynamic, so client files do not export route segment config. Dynamic params are unwrapped with React `use(params)`. Root `app/layout.tsx` wraps everything in `TRPCProvider` → `ThemeProvider`, forces dark mode, loads Inter. `[campaignId]/layout.tsx` applies a genre CSS class (`genre-fantasy`, etc.).

---

## Component Tree

Grouped by folder (`components/`). tRPC/streaming/state usage noted where relevant.

**providers/** — `trpc-provider` (QueryClient + tRPC client root), `theme-provider` (Context theme, persisted to `localStorage` `rpg-story-theme`).

**layout/** — `app-header` (nav + theme toggle), `campaign-nav` (breadcrumb), `page-container` (max-width wrapper).

**campaigns/** — `campaign-form` (create/edit; composes `quick-actions-editor` and `image-settings-fields` for image config), `detail/` (`campaign-header`, `characters-section`, `sessions-section`, `journal-section` for the campaign page).

**characters/** — `character-form` (composes `appearance-fields`, `stats-editor` and the reference portrait), `character-sheet` (desktop sidebar), `character-drawer` (mobile), `stat-block`, `inventory-list`, `reference-portrait` (tRPC `images.getReference`/`uploadReference`).

**chat/** — `chat-container` (orchestrator: `useChat`, `useSessionOpener`, tRPC hooks; composes `chat-toolbar`, `chat-banners` and `character-panel`), `chat-input`, `message-list` (memoized saved list + load-older + auto-scroll), `message-bubble`, `narrative-renderer` (strips `[MECHANIC:...]` markers and STATE_UPDATE blocks via `lib/narrative.ts`), `markdown-renderer`, `streaming-indicator`, `retry-button`, `dice-roller`, `dice-result`, `quick-actions`, `scene-image` (uses `useImageStatus`; progress bar in `scene-image-progress`).

**gallery/** — `image-card`, `image-gallery`, `image-lightbox` (regenerate/edit prompt; `lightbox-context` for the context snapshot), `session-group`.

**images/** — `prompt-editor` (positive/negative prompt fields shared by `scene-image` and `image-lightbox`).

**npcs/** — `npc-card`, `npc-sections`, `disposition-bar` (NPC memory page).

**settings/** — `provider-selector`, `provider-config-form`, `model-selector`, `connection-test`.

**ui/** (shadcn new-york) — `button`, `input`, `label`, `select`, `skeleton`, plus `confirm-dialog` (the single confirmation dialog: delete/end/replace flows, Escape cancels, `pending` state), `string-list-editor` (stats, plot hooks, inventory) and `form-styles` (shared input/label/select classes).

---

## State Management

- **Server/persistent state:** Drizzle/SQLite via tRPC + TanStack Query cache.
- **UI/local state:** React `useState`/`useReducer` and Context (theme). There is no global state store.
- **Streaming:** raw `fetch` + SSE in `hooks/use-chat.ts`; tokens are batched into one state update per animation frame and rendered as a separate streaming bubble, then swapped for the saved message (the `done` event carries its `messageId`) in a single render, after tRPC invalidation.
- **History:** `hooks/use-session-messages.ts` is a `useInfiniteQuery` over `messages.listBySession` (keyset cursor `{createdAt, id}`, order `(createdAt desc, id desc)`); `lib/messages.ts` merges the pages.
- **Image status:** `hooks/use-image-status.ts` uses `trpc.images.status` with a conditional `refetchInterval` (2s while `generating`, off otherwise); no timers guess when the server finished.

---

## LLM Providers

`server/llm/providers.ts` is the entry point (`callLLM`, `cleanGibberish`, `classifyError`, shared types) and dispatches to one module per provider: `ollama.ts`, `openai.ts`, `anthropic.ts`. The stream-reading loop they share lives in `streamLoop.ts`; `config.ts` builds the `ProviderConfig` from user settings and `gpuGate.ts` coordinates GPU use with the image subsystem.

- **Ollama** — `POST {baseUrl}/api/chat` with `stream:true`, `think:false`, `num_ctx:12288`. **180s timeout.** Includes live repetition detection (consecutive words, repeated bigrams, low unique-word/trigram ratios) that truncates and aborts looping output. Errors: 404 → `model_not_found`, else `connection_failed`.
- **OpenAI** — `POST /v1/chat/completions`, SSE, `Bearer` auth. **60s timeout.** Errors: 401/403 → `auth_failed`, 404 → `model_not_found`, 429 → `rate_limited`, 400+context → `context_too_long`.
- **Anthropic** — `POST /v1/messages`, separate `systemPrompt` argument, `x-api-key` + `anthropic-version: 2023-06-01`, `max_tokens:4096`. **60s timeout.** Same error taxonomy.

Error categories (`ClassifiedError.errorType`): `model_not_found`, `connection_failed`, `auth_failed`, `rate_limited`, `context_too_long`, `timeout`, `unknown`. `cleanGibberish` is a deterministic post-processor that truncates paragraphs with a high ratio of broken/garbage tokens.

> There is **no `listModels` function in `providers.ts`** — model discovery lives in the `userSettings.listModels` tRPC procedure.

---

## Narrative Pipeline (summary)

`runPipeline` is the heart of the app. Its stages live in `server/pipeline/turn/*` (`context` loads everything a turn reads, `prompt` builds the campaign/character/scene blocks, `mechanics` resolves dice and snippets, `stateJob` runs the post-turn extraction and commit, `auxTasks` holds the summary/journal/title jobs); `orchestrator.ts` sequences them. It distinguishes **trivial** input (OOC, one-word replies, stat queries — handled with a single fast narrator call) from **standard** input (full pipeline). The standard path layers in: NPC selection, a **story-aware director** (see below), GM initiative (proactive complications on an interval), consequence echoes (delayed payoffs seeded earlier), inline dice mechanics resolved deterministically and rewritten into prose, and character state mutations. After responding, background tasks update the story state, scene state, consequence seeds, NPC memory, the session context summary, the campaign journal, and the session title. Scene images are never started by a turn — only by the player's Illustrate button.

**The narrative arc/pacing system has been replaced by the story director.** `server/pipeline/director.ts` exports `runDirector` (produces a `DirectorDecision` with `phase`, `tension`, `intent`, `wordBudget`, `gmInitiative`, and `spotlight` thread), `coldStartState`, `mergeStoryState`, and `buildDirectorBlock`. `server/pipeline/narrativeExtractor.ts` extracts thread updates and tension readings from each LLM response. The live story state is persisted as `sessions.storyState` (a `SessionStoryState` JSON column) containing the arc phase, tension level, and the list of active `StoryThread` objects (label/kind/status/weight). The old per-session `narrativeArc`, `lastPacingBeats` and `messagesSinceEvent` columns no longer exist.

An important implementation note for future work:
- HP changes have two paths: STATE_UPDATE `statChanges` and dice `damage` markers. Both go through `commitTurn` (`server/pipeline/turnCommit.ts`) inside one transaction: STATE_UPDATE first, then dice damage re-reads the character and subtracts from the fresh HP. Keep that order.

See `docs/PIPELINE.md` for the full stage-by-stage breakdown.

---

## Tooling & Local Setup

- **Scripts:** `npm run dev` (Turbopack), `build`, `start`, `lint`, `test` (Vitest), `test:watch`.
- **Database:** Drizzle over better-sqlite3 at `./data/rpg.db`. Migrations via `drizzle-kit` (config in `drizzle.config.ts`, output `./drizzle`). `next.config.ts` marks `better-sqlite3` as a server-external package.
- **Docker services** (`docker-compose.yml`): `comfyui` (`yanwk/comfyui-boot:cu126-slim`, port 8188, GPU, mounts `D:/ai-models/*`, `D:/ai-output/rpg`, `D:/ai-input`) and `ollama` (gated behind the `ollama` profile; only needed if not running Ollama natively). The Next app itself runs natively, not in a container.
- **Helper scripts:** `scripts/start-services.sh` (compose up, wait for Ollama/ComfyUI, pull the default model) and `scripts/stop-services.sh`.
- **Tests (Vitest):** `tests/components/**` run in jsdom; pipeline tests in `tests/pipeline/**` and router/route/config/LLM/DB/image tests in `tests/server/**` and `tests/lib/**` run in node. `tests/helpers/testDb.ts` builds in-memory test databases. Components opt into jsdom with a `// @vitest-environment jsdom` docblock; `scripts/*.test.mts` (live e2e) are only collected with `PLAY_LOOP=1`.

See `README.md` for step-by-step setup.

---

## Security & Privacy Notes

- No authentication. Every tRPC procedure is public; anyone who can reach the server can read/modify all data and settings.
- API keys (`openaiApiKey`, `anthropicApiKey`) are stored **plaintext** in SQLite. They are stripped from all client responses but are not encrypted at rest.
- The image route `/api/images/rpg/[...path]` hardens against path traversal (rejects `..`/`\` and paths escaping the output base).
