# CLAUDE.md — Agent Context for RPG Story Generator

This file orients AI coding agents working in this repo. Read it before making changes. For the full picture see `ARCHITECTURE.md` and the deep dives in `docs/`.

## What this project is

A single-user, local-first RPG story generator. The user creates campaigns and characters, then plays chat sessions where a local LLM is the game master. A server-side pipeline adds dice mechanics, a story director, NPC memory, and optional AI scene illustration via ComfyUI/SDXL.

## Stack — the single most important thing to get right

**This is a tRPC + Drizzle/SQLite app, NOT Convex.** Earlier documentation described a Convex architecture that was never the final implementation. There is no `convex/` directory. Do not introduce Convex, reactive queries, or `Id<"...">` types.

- Backend logic lives in `server/` (tRPC routers, pipeline, image, llm, db).
- Data is SQLite (`./data/rpg.db`) via Drizzle ORM (`server/db/schema.ts`).
- API is tRPC at `/api/trpc` (`server/root.ts` composes the routers).
- Chat streaming is **Server-Sent Events** over `POST /api/chat/stream`, consumed by `hooks/use-chat.ts` with `fetch` + a stream reader — **not** tRPC.
- Frontend is Next.js 15 App Router, React 18, Tailwind + shadcn/ui (new-york).
- Text generation defaults to **Ollama** (`gemma3:12b`); OpenAI/Anthropic are optional. Images via **ComfyUI/SDXL**.

## Commands

```bash
npm run dev          # Next dev server (Turbopack)
npm run build        # production build
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch
npm run lint         # eslint (type-aware), --max-warnings 0
npm run typecheck    # tsc --noEmit
npx drizzle-kit generate   # create a migration after schema changes (applied automatically when the DB is opened — see the migrations note under Stack)
npm run db:drift -- [db]   # verify a DB's schema matches ./drizzle (default data/rpg.db)
bash scripts/start-services.sh   # docker compose up + wait for ollama/comfyui + pull model
bash scripts/stop-services.sh
```

**CI** (`.github/workflows/ci.yml`, ubuntu + windows, Node 22): `npm ci`, `typecheck`, `lint`, `test`, plus (ubuntu) `npx drizzle-kit generate` followed by a check that it wrote nothing, i.e. `schema.ts` and `./drizzle` are in sync. `npm run db:drift` needs a live DB, so it stays a local tool. **Lint** runs type-aware (`projectService`) with `@typescript-eslint/no-floating-promises` and `no-misused-promises` on `.ts/.tsx/.mts`: await a promise, `.catch` it, or mark it `void` with a comment saying why it cannot reject or where the error is handled (`enqueueBackground` never rejects; tRPC cache `invalidate()` calls are `void`). Async JSX props are allowed (`checksVoidReturn.attributes: false`), but an async callback passed where a `void` return is expected is not. `@next/eslint-plugin-next` is not installed.

Run `npm test` after changing pipeline, dice, image, or state-parsing logic — these are the unit-tested areas.

**Migrations are the source of truth — don't use `drizzle-kit push`.** `server/db/open.ts` applies pending migrations from `./drizzle` every time the DB is opened (one IMMEDIATE transaction; FKs off during it, `foreign_key_check` before commit), and baselines push-era databases that have tables but no journal. `DB_PATH` overrides the DB file; vitest forces `DB_PATH=:memory:` (except `PLAY_LOOP=1` runs), so unit tests never touch `data/rpg.db`. **When it runs:** in dev the connection is cached on `globalThis`, so a new migration applies only after restarting `npm run dev`; `next build` also opens the DB (route imports) and therefore applies pending migrations to `data/rpg.db`. Use `tests/helpers/testDb.ts` (`createTestDb`, `seedSession`, `seedCharacter`) for DB-backed tests.

## Directory map (where things live)

- `server/db/schema.ts` — **the source of truth for all data shapes.** Update here first, then generate a migration.
- `server/db/jsonTypes.ts` — types of every JSON column (`MessageMetadata`, `SceneState`, `SessionStoryState`, ...). Type-only, client-safe.
- `server/db/jsonSchemas.ts` — zod schemas + `read*` helpers that validate JSON columns on read (and the client-facing `clientMessageMetadataSchema` used by the chat route).
- `lib/enums.ts` — every enum-like value set (`GENRES`, `MESSAGE_ROLES`, `TRIGGER_TYPES`, ...) as `const` arrays; the schema, zod inputs and UI option lists are all built from them. Client-safe.
- `server/config.ts` — server-only env/config (see "Central server config" below). Never import it from client code.
- `server/routers/*.ts` — tRPC procedures (campaigns, characters, sessions, messages, userSettings, npcMemory, images). All are `publicProcedure`.
- `server/pipeline/orchestrator.ts` — `runPipeline`, the chat turn engine. Start here for any narration/gameplay change. It only sequences the stages in `server/pipeline/turn/*`.
- `server/pipeline/turn/*` — the turn stages: `context.ts` (`loadTurnContext`: everything a turn reads), `prompt.ts` (campaign/character/scene prompt blocks), `mechanics.ts` (dice + snippet rewrite + STATE_UPDATE parse), `stateJob.ts` (step 3: extraction → `commitTurnState`, memory consolidation/gossip), `auxTasks.ts` (context summary, campaign journal, title).
- `server/pipeline/sessionEnd.ts` — end-of-session service (summary, completion, journal); the `sessions.endSession` router takes the session lock and delegates here.
- `server/pipeline/promptBuilder.ts` — system-prompt assembly (`buildNarratorPrompt`, `buildSnippetPrompt`). This is the only prompt builder.
- `server/pipeline/*` — individual stages: classifier, sceneClassifier, diceResolver, npcSelection, snippetWriter, stateParser, utils, **plus the story-aware director subsystem**: `director.ts` (exports `runDirector`/`coldStartState`/`mergeStoryState`/`buildDirectorBlock`) and `narrativeExtractor.ts`. The old `narrativeArc` and `pacing` stages have been replaced by the director; `sessions.storyState` (a `SessionStoryState` JSON column) is the live source of truth for phase, tension, and story threads. **NPC agendas + director initiative (Phase 2):** each NPC row now carries `goal` (long-term want), `agenda` (next move), `agendaThreadId` (which story thread the NPC is pushing on), and `lastActedTurn`. Each turn, `runDirector(storyState, npcs)` selects an *acting NPC* — the one whose `agendaThreadId` matches the spotlight thread, provided it hasn't acted within `NPC_ACT_GAP` turns — and adds one line to the `[DIRECTOR]` block naming the NPC's aim and voice. `extractNarrativeState` (via the `npc` key in the JSON reply) updates goal/agenda/agendaThreadId after each turn; the orchestrator sets `lastActedTurn` for the acting NPC and links `thread.ownerNpcId`. **Thread-linked consequences (Phase 3):** each `sessions.consequenceSeeds` entry is `{ trigger, echo, messagesUntilEcho, threadId? }`. Before the narrator, `runDirector` surfaces at most ONE eligible echo per turn (`messagesUntilEcho <= 0`), preferring the seed whose `threadId` matches the spotlight (then any escalating thread, then the first eligible), setting `decision.consequenceEcho` as a `[DIRECTOR]` line. After the turn the orchestrator REMOVES the surfaced seed from `consequenceSeeds`, decrements the rest, and appends new extractor seeds (cap 8). The long campaign arc persists via `reconcileCampaignThreads`, run on a ~15-message cadence to promote session threads to `campaign.storyState`. E2E proof of consumption: `scripts/agency.test.mts` (env-gated `PLAY_LOOP=1`).
- `server/llm/providers.ts` — `callLLM` dispatch + error classification + gibberish cleanup; the per-provider clients are `server/llm/{ollama,openai,anthropic}.ts`, sharing the SSE/stream loop in `server/llm/streamLoop.ts`. `server/llm/config.ts` builds provider configs and `server/llm/gpuGate.ts` is the GPU hold.
- `server/image/*` — ComfyUI/SDXL pipeline (orchestrator, comfyuiClient, vramManager, promptWriter, stylePresets, etc.).
- `app/api/chat/stream/route.ts` — SSE entry point for chat.
- `hooks/use-chat.ts` — client SSE consumer. `hooks/use-session-messages.ts` — paginated history (infinite query, keyset cursor). `hooks/use-session-opener.ts` — fires the session opener once (one retry on abort/"already processing"). `hooks/use-image-status.ts` — `trpc.images.status` polled only while `generating`.
- `components/ui/confirm-dialog.tsx` — the one confirmation dialog (delete/end/replace flows); `components/ui/string-list-editor.tsx`, `components/ui/form-styles.ts` — shared form pieces.
- `server/pipeline/sessionOpener.ts` — builds the hidden opener turn (`openerPrompt`, `prepareOpener`); the chat route accepts `{ opener: true }`.
- `lib/` — `enums.ts` (enum value sets), `constants.ts` (genres/tones/dice/stat presets, `MAX_MESSAGE_LENGTH`), `dice.ts`, `stats.ts`, `utils.ts` (`cn`, `timeAgo`), `narrative.ts` (MECHANIC markers, `splitStateUpdate`, `narrationForDisplay`; also used by the pipeline), `json-scan.ts` (`scanBalanced`), `messages.ts` (`mergePages`, `isHiddenOpener`), `campaign-input.ts` (`CampaignFormData`, `toCampaignInput`), `character-links.ts` (`injectCharacterLinks`), `trpc.ts` (typed client).
- `types/index.ts` — shared TS types, now **derived from the schema** (no hand-mirrored copies): row types come from `server/db/schema.ts` (`InferSelectModel`), JSON shapes from `server/db/jsonTypes.ts`, enums from `lib/enums.ts`; validated reads of JSON columns go through `server/db/jsonSchemas.ts`.

## Conventions

- **TypeScript strict.** Path alias `@/*` maps to repo root.
- **Adding/changing data:** edit `server/db/schema.ts` (and `server/db/jsonTypes.ts` / `lib/enums.ts` / `server/db/jsonSchemas.ts` if a JSON shape or enum changes; `types/index.ts` follows automatically) → update the relevant zod input schema in the router → `npx drizzle-kit generate` (review the SQL; it is applied when the DB connection is next opened — in dev that means restarting `npm run dev`, see the migrations note under Stack).
- **Adding an API procedure:** add to the appropriate `server/routers/*.ts`, validate input with zod, throw `TRPCError` for not-found/conflict. It is automatically typed on the client via `trpc.<router>.<proc>`.
- **Secrets:** never return `openaiApiKey`/`anthropicApiKey` to the client. Follow the existing pattern in `userSettings` (expose `hasOpenaiKey`/`hasAnthropicKey` only).
- **Client components:** pages are `"use client"`; dynamic rendering is forced once in the root layout (`app/layout.tsx`, a server component) — don't export route segment config (`dynamic`, `revalidate`, ...) from client files. Unwrap dynamic params with `use(params)`.
- **Styling:** Tailwind tokens + shadcn `new-york`; genre accent colors come from CSS classes (`genre-*`) in `app/globals.css`. Use `cn()` for class merging.
- **State:** prefer React state / TanStack Query cache. There is no global store (Zustand was removed as unused); don't add one unless there's a clear reason.

## Known gotchas / footguns

- **All prompts come from `promptBuilder.ts`.** (An older, unused `server/pipeline/systemPrompt.ts` was removed — don't reintroduce a second prompt builder.)
- **Test layout.** Pipeline tests live in `tests/pipeline/` (there is no `tests/convex/` any more); router, chat-route, config, LLM, DB and image tests live in `tests/server/{routers,llm,db,image}` plus `tests/server/*.test.ts`; `tests/lib/`, `tests/hooks/` and `tests/components/` cover `lib/`, hooks and React components; shared helpers (`createTestDb`, `seedSession`, `seedCharacter`) are in `tests/helpers/testDb.ts`. `npm test` collects only `tests/**/*.test.{ts,tsx}`; `tests/components/*.test.tsx` opt into jsdom via a `// @vitest-environment jsdom` docblock. The live-model e2e harnesses in `scripts/*.test.mts` are collected only when `PLAY_LOOP` is set: `PLAY_LOOP=1 npx vitest run scripts/ --no-file-parallelism` (there is no `npm run` script for it: `VAR=x` does not work under cmd and `cross-env` is not a dependency; in PowerShell use `$env:PLAY_LOOP=1; npx vitest run scripts/ --no-file-parallelism`).
- **HP has two mutation paths** (STATE_UPDATE `statChanges` and dice `damage` markers). Both go through `commitTurn` in `server/pipeline/turnCommit.ts`, inside one transaction: STATE_UPDATE first, then dice damage re-reads the character and subtracts from the fresh HP. Keep that order.
- **Client code never imports `server/` at runtime** (`import type` is fine). Shared pure logic lives in `lib/`; `tests/lib/clientBoundary.test.ts` enforces it for `app/` (except `app/api/`), `components/`, `hooks/`, `lib/` and `types/`.
- **The session opener is a hidden user turn built by the server** (`server/pipeline/sessionOpener.ts`, `metadata.opener`); legacy rows saved before the flag are matched by prefix in `isHiddenOpener` (`lib/messages.ts`).
- **Turns are serialized per session.** `sessionLock.ts` rejects a concurrent turn (atomic conditional UPDATE, kept alive every 60s while the turn runs); `backgroundQueue.ts` makes each turn wait for the previous turn's step 3 (extraction → `commitTurnState`) before reading `storyState`. Post-turn work goes through `enqueueBackground` (keys `turnStateKey` / `sessionAuxKey`), never bare fire-and-forget. `sessions.endSession` takes the same session lock (CONFLICT if a turn is in flight) before waiting on the queues and summarizing.
- **Turn writes are transactional.** better-sqlite3 transactions are synchronous: do LLM calls and reads first, then one `db.transaction((tx) => …)` block using `.run()/.get()/.all()`. Helpers take `DbOrTx`. Memory formation/consolidation/gossip still write outside the state commit.
- **`metadata.imageId`** is written by the image router via raw DB update; it's intentionally absent from the `messages` router input schema.
- **`npcMemory.upsert`** doesn't accept `speechPattern`/`vocabulary` — those are written only by the pipeline's `applyNpcUpdates` (`server/pipeline/turnCommit.ts`), called from step 3 (`commitTurnState`). A concurrent first-insert collision on `uq_npc_memory_campaign_lname` is folded into an update.
- **VRAM contention:** Ollama and ComfyUI compete for the GPU. `server/llm/gpuGate.ts` is a token-owned exclusive hold: `acquireForImageGen(baseUrl)` (`server/image/vramManager.ts`) takes it, unloads every model `/api/ps` reports, and returns a lease you must `release()` in `finally`. `callOllama` waits on the gate (`waitForGpu`, abortable) for up to `GPU_HOLD_STALE_MS` (300s), then proceeds anyway; calls already in flight when a render starts keep running. While a chat turn waits it holds its session lock (kept alive) and the client just sees "The narrator is writing…". `images.illustrate`/`regenerate` first wait for the session's step-3 queue (`turnStateKey`) so the prompt sees fresh scene state, and a per-session starting guard stops double clicks; on a ComfyUI timeout the client POSTs `/interrupt` before the lease is released. Don't run a generation without a lease.
- **Orphaned image jobs.** Jobs are in-process promises; `failStaleImageJobs` (`server/image/recovery.ts`) marks `generating` rows from before this process started (or older than 20 min) as `failed`. It runs at the start of `illustrate`/`regenerate`/`status`. The ComfyUI client opens its WebSocket (with `clientId`) before queueing, completes per `prompt_id`, and falls back to polling `/history`.
- **LLM config comes only from `server/llm/config.ts`** (`buildProviderConfig`, `buildFallbackConfig` — `null` for cloud users, who never get a silent local fallback — and `buildLocalConfig` for GPU-side work).
- **Narrator calls go through `narrate()`** (`server/pipeline/narrate.ts`): retries/fallback with a fresh marker-aware sink per attempt, an SSE `reset` event before re-streaming, and `LLMAbortedError` (never retried, never falls back). `runPipeline` takes a `signal`; the SSE route aborts it when the client disconnects. A failed or aborted turn deletes its user message, and the SSE `error` event carries `restoreInput` so the client puts the draft back.
- **Cadences count turns:** reconcile and the mid-session journal run via `isDue(turn, lastTurn, every)` with `storyState.lastReconcileTurn` / `lastJournalTurn` (both carried by `mergeStoryState`).
- **Background extractors never reach the client.** Step 3, summary and journal run in the per-session background queue after `onComplete`; their errors are logged to the server console (`[background:<key>]`, `[memories]`, `[reconcile]`), not sent over SSE. Title generation is still fire-and-forget (errors logged as `[title]`).
- **Central server config.** `server/config.ts` (`config`, `readConfig`, `SETTINGS_ID`) is the single place for the Ollama/ComfyUI URLs, the output/input directories (`D:/ai-output/rpg`, `D:/ai-input` by default), `DB_PATH` and `OLLAMA_NUM_CTX`; override via env (`OLLAMA_URL`, `COMFYUI_URL`, `COMFYUI_WS_URL`, `RPG_OUTPUT_DIR`, `COMFYUI_INPUT_DIR`, `DB_PATH`, `OLLAMA_NUM_CTX`). Fields resolve from `process.env` on access. **Server-only: never import it from client code** (`lib/constants.ts` keeps its own `DEFAULT_OLLAMA_URL` literal). `docker-compose.yml` still hardcodes the `D:/ai-*` mounts and must be changed together with the env vars.
- **No auth.** Every procedure is public. Don't assume any access control exists.

## Default models & endpoints

- Ollama: `http://localhost:11434`, default model `gemma3:12b`, pipeline fallback `mistral:7b-instruct` (Ollama users only).
- ComfyUI: `http://localhost:8188` (HTTP) / `ws://localhost:8188/ws` (progress).
- SDXL checkpoint used by all presets: `juggernautXL_v9.safetensors`.

## When in doubt

`server/db/schema.ts` and `server/pipeline/orchestrator.ts` are the two anchor files. If a doc and the code disagree, the **code wins** — and please update the doc.
