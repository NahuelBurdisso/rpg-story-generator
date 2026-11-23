# RPG Story Generator

A local-first, single-user RPG story generator. Create campaigns and characters, then play chat-based sessions where a local LLM acts as your game master — complete with dice mechanics, pacing and narrative-arc tracking, persistent NPC memory, and optional AI-generated scene art.

## Features

- **Campaigns** with genre, tone, difficulty, world lore, custom rules, configurable stat definitions, quick actions, and plot hooks.
- **Characters** with dynamic stats, inventory, appearance traits, and reference portraits.
- **Chat play** with a streaming GM narrator, inline dice mechanics, and automatic character state updates (inventory, stats, status).
- **Narrative intelligence:** scene classification, story-thread and tension tracking (story director), GM-initiated complications, and delayed "consequence echoes."
- **NPC memory:** NPCs persist personality, relationships, secrets, speech patterns, and a memory log across sessions.
- **AI scene illustration** (optional) via ComfyUI + Stable Diffusion XL, with IP-Adapter character consistency.
- **Multiple text providers:** Ollama (default, local), OpenAI, or Anthropic.

## Tech Stack

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS + shadcn/ui · tRPC v11 + TanStack Query · Drizzle ORM + better-sqlite3 · Vitest. AI: Ollama (text) + ComfyUI/SDXL (images), orchestrated with Docker Compose.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and [`docs/`](./docs) for subsystem deep dives.

## Prerequisites

- **Node.js 18+** and npm.
- **An NVIDIA GPU** is strongly recommended (the default text model is large and image generation requires CUDA).
- **Docker + Docker Compose** (for ComfyUI, and optionally Ollama).
- **Ollama** — either run natively or via the Docker `ollama` profile.
- For image generation: SDXL models placed under `D:/ai-models/` (the image subsystem currently uses hardcoded Windows paths — see [Image generation](#image-generation-optional)).

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the SQLite database schema
npx drizzle-kit push     # creates ./data/rpg.db from server/db/schema.ts

# 3. Start the AI services (ComfyUI, and Ollama if using the docker profile)
bash scripts/start-services.sh
#   - brings up docker compose
#   - waits for Ollama, installs the narrator models (default + alternatives)
#   - waits for ComfyUI

# 4. Run the app
npm run dev              # http://localhost:3000
```

Then open the app, go to **Settings**, pick your provider (Ollama by default) and model, and create your first campaign.

> If you run Ollama natively (recommended), you don't need the docker `ollama` service. The compose file gates it behind a profile (`docker compose --profile ollama up`).

## Configuration

Provider settings (which LLM, base URL, API keys, model, max context messages) are configured in the app's **Settings** page and stored in SQLite — not in env files. `.env.local` only holds `NEXT_PUBLIC_APP_URL`.

Default endpoints:

- Ollama: `http://localhost:11434`
- ComfyUI: `http://localhost:8188`

### Narrator models

The default narrator model is `gemma3:12b` (~8GB VRAM at Q4; any instruction-following Ollama model works as long as it follows the extractor JSON and dice-marker instructions), installed by `scripts/start-services.sh`.

**Switch models in-app:** go to Settings -> Model, click the refresh button to load installed Ollama models, pick one, and Save. The chat pipeline reads the selected model on the next turn — no restart needed.

## Image generation (optional)

Image generation is **off by default** per campaign (`imageEnabled`). Enable it in the campaign form and pick an image style. Images are only generated when you press **Illustrate** in the chat. Requirements:

- ComfyUI running (via `docker-compose.yml`) with the SDXL checkpoint `juggernautXL_v9.safetensors` and an SDXL VAE installed.
- Model/output/input directories on disk. The subsystem currently uses **hardcoded Windows paths**:
  - `D:/ai-models/` — checkpoints, VAE, LoRAs, IP-Adapter, etc.
  - `D:/ai-output/rpg/` — generated images and character references.
  - `D:/ai-input/` — references staged for ComfyUI's `LoadImage`.
- An NVIDIA GPU. The VRAM manager (`server/image/vramManager.ts`) unloads Ollama before generating to avoid GPU contention.

Image generation is optional and player-triggered. See [`docs/IMAGE_GENERATION.md`](./docs/IMAGE_GENERATION.md).

## Database

- Schema: `server/db/schema.ts` (Drizzle, SQLite).
- DB file: `./data/rpg.db` (WAL mode, foreign keys enforced).
- After changing the schema: `npx drizzle-kit generate` then `npx drizzle-kit push`.

## Testing

```bash
npm test           # run all Vitest suites
npm run test:watch
```

Tests cover the narrative pipeline (`tests/pipeline/`), the image subsystem (`tests/server/image/`), and key components (`tests/components/`).

## Project Structure

```
app/        Next.js routes + API handlers (trpc, chat stream, images)
components/ React UI (campaigns, characters, chat, gallery, settings, ui)
hooks/      use-chat (SSE), use-image-status
lib/        constants, dice, utils, trpc client
server/     backend — db, trpc routers, pipeline, image, llm
types/      shared TypeScript types
tests/      Vitest suites
scripts/    docker service helpers
docs/       deep-dive documentation
```

## Security note

This app has **no authentication** and is built for local single-user use. API keys are stored unencrypted in SQLite (though never sent to the browser). Do not expose it on an untrusted network without adding access control.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture, data models, API surface.
- [`CLAUDE.md`](./CLAUDE.md) — context for AI coding agents.
- [`docs/PIPELINE.md`](./docs/PIPELINE.md) — the narrative/chat pipeline.
- [`docs/NPC_MEMORY.md`](./docs/NPC_MEMORY.md) — NPC memory system.
- [`docs/IMAGE_GENERATION.md`](./docs/IMAGE_GENERATION.md) — image generation subsystem.
