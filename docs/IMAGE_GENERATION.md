# Image Generation Subsystem

Optional AI scene illustration via **ComfyUI + Stable Diffusion XL**. Generation is **player-triggered only**: the chat's Illustrate button calls `images.illustrate`; an LLM writes the SD prompt, and ComfyUI renders it — with IP-Adapter character consistency and GPU arbitration against Ollama. All code lives in `server/image/`.

## End-to-end flow

Entry point: `generateSceneImage(ctx: ImagePipelineContext)` in `server/image/imageOrchestrator.ts`, called fire-and-forget from `images.illustrate` / `images.regenerate`. Chat turns never call it (removed from `runPipeline` so images only happen on demand).

1. **Health/enable gate** — `checkImageGenHealth()` (once), then early-return if `!campaign.imageEnabled`. For the normal path, also early-return if ComfyUI is unreachable (avoids orphan DB rows).
2. **Trigger** (normal path) — every generation is an explicit player request, so `triggerType` is always `player_request` (the old automatic beat detector was removed).
3. **Record creation** — insert a `sceneImages` row (`status: "generating"`, default 1024×1024, empty prompts) and write its `id` into the triggering message's `metadata.imageId`.
4. **Prompt writing** — pick the target character, compose appearance + damage state, resolve the style, fetch the previous prompt, then run the two-pass `writeImagePrompt`. Save `sdPrompt`, `sdNegativePrompt`, `width`, `height`, and a `contextSnapshot`.
5. **VRAM handoff** — `acquireForImageGen(model, baseUrl)` (unloads Ollama, waits for free VRAM).
6. **ComfyUI dispatch** — resolve the character reference image, compute adaptive sampler params, call `generateImage(...)` with a throttled progress callback.
7. **Completion** — update the row to `completed` with `filePath`, `seed`, `generationTimeMs`; set `session.lastImageMessageCount`; auto-save the image as the character's reference if none exists.
8. **VRAM restore** — `finally`: `releaseToOllama(...)` (releases the lock; does **not** eagerly reload Ollama — it reloads on demand).
9. **Failure** — log to console + `D:/ai-output/rpg/error.log`, mark the row `failed`.

Regeneration (`_regenerateImageId` set) skips record creation, operating on an existing row, optionally with caller-supplied `_customPositive`/`_customNegative`.

## Prompt writing — `promptWriter.ts` (two-pass)

`writeImagePrompt(input, campaignId, triggerType, imageStyle, customConfig, baseUrl, model)` runs two LLM passes via `callOllama`:

- **Pass 1 — extraction** (`buildExtractionPrompt`, temp 0.4, ~550 tokens): pulls the visual MOMENT/SUBJECT/BODY/ACTION/EXPRESSION/ENVIRONMENT/LIGHTING/MOOD plus cinematographer framing (shot scale, camera angle, depth style, director note).
- **Pass 2 — optimization** (`buildOptimizerPrompt`, temp 0.5, ~300 tokens): converts the extraction into ≤35 SDXL tags, character-features first.

Then a deterministic post-processing chain: `reorderByPriority` → `applyEmphasis` (weights quality tags) → `cleanSdPrompt` (strips LLM preamble/refusals, dedupes, caps 35 tags) → `structureWithBreaks` (groups subject/environment/style with `BREAK`) → `boostCharacterFeatures` (weights distinctive traits like cybernetics/scars). Validity is checked with `looksLikeSdTags`; one retry on failure.

Dimensions come from the trigger / shot scale (`getDimensionsForTrigger`, `inferDimensionsFromContent`). The negative prompt is built dynamically (`buildDynamicNegative`) — e.g. it adds anti-photorealism terms for anime tags and vice versa. `getLastImagePrompt(campaignId)` provides continuity with the previous image.

Supporting modules:
- **`appearanceComposer.ts`** — `composeAppearance(traits)` turns character appearance into SD descriptors; `composeDamageState(statusNotes)` maps game state to visual tags (bloodied, exhausted, wet, etc.).
- **`buildImageContext.ts`** — `buildImageContext(sessionId)` assembles the data the orchestrator needs (session, campaign, characters, relevant NPCs, recent narrative, baseUrl, model).

## Character consistency — `referenceManager.ts` (IP-Adapter)

- `getCharacterRef(campaignId, name)` — finds a saved reference PNG, copies it into ComfyUI's input dir (`D:/ai-input/ref_<campaign8>_<name>.png`), returns the filename for `LoadImage`.
- `saveCharacterRef(campaignId, name, buffer)` — writes a reference PNG (used by `images.uploadReference`).
- `ensureCharacterRef(campaignId, name, generatedImagePath)` — if no reference exists, promotes a generated scene image to be the character's reference.

Reference base: `D:/ai-output/rpg`; ComfyUI input: `D:/ai-input`.

## VRAM arbitration — `vramManager.ts`

Ollama and ComfyUI both want the GPU. A module-level lock arbitrates:

- `acquireForImageGen(model, baseUrl, {skipVramCheck?})` — clears stale locks (`STALE_TIMEOUT = 60s`), acquires the lock, tells Ollama to unload (`POST /api/generate` with `keep_alive: 0`), waits 1.5s, then `waitForVRAM(10 GB threshold, 30s timeout)` polling `nvidia-smi`. Returns false if it can't free enough VRAM.
- `releaseToOllama(model, baseUrl)` — releases the lock only (Ollama reloads on demand).
- `isImageGenActive()` — true if the lock is held (used by `images.illustrate`/`regenerate` to avoid concurrent gen).
- `_resetForTests()` — test helper.

If `nvidia-smi` is unavailable, the VRAM check is skipped (returns true).

## ComfyUI integration — `comfyuiClient.ts`

- Base URL `http://localhost:8188`; WebSocket `ws://localhost:8188/ws`. `GENERATION_TIMEOUT = 120s`.
- `buildWorkflow(params)` — parameterizes the base graph (`workflows/sdxl-scene.json`, a minimal 7-node SDXL graph: checkpoint → CLIP encodes → empty latent → KSampler → VAE decode → save). Optional nodes are injected dynamically: LoRA (8), IP-Adapter (10/11/12), CLIP skip (15), VAE loader (9), img2img (25/26), hires fix (20/21), face detailer (30/31).
- `generateImage(params, campaignId, imageId, onProgress?)` — sets the filename prefix, `POST /prompt`, awaits completion over WebSocket, fetches the output filename from `GET /history/{promptId}`, downloads via `GET /view`, writes to `D:/ai-output/rpg/<campaignId>/<imageId>.png`, returns the relative path + seed.
- **Progress** comes over the WebSocket (`progress`/`progress_state`/`status` events mapped to phases: loading → sampling → decoding → saving → done).
- **Graceful degradation:** if `POST /prompt` 400s due to missing custom nodes (FaceDetailer/IPAdapter), the client deletes those nodes, rewires the graph, and retries — so the app still renders on a vanilla ComfyUI install.
- `isComfyUIAvailable()` — `GET /system_stats` health check (3s timeout).

KSampler defaults when unset: `cfg 6.5`, `steps 35`, `dpmpp_2m`/`karras`, random 32-bit seed.

## Adaptive sampler tuning (orchestrator)

- `getAdaptiveIpaWeight(shotScale)` — IP-Adapter weight scales with shot tightness (extreme close-up 0.8 → extreme wide 0.25; default 0.5).
- `TRIGGER_SAMPLER_OVERRIDE` — combat & consequence force `dpmpp_2m_sde`/`karras` unless the style already uses it.
- Archetype + shot-scale modifiers adjust final `cfg` and `steps`.
- Hires fix is enabled for the higher-fidelity styles (extreme-horror, photorealistic).

## Style presets — `stylePresets.ts`

All presets use checkpoint `juggernautXL_v9.safetensors`, VAE `sdxl_vae.safetensors`, `karras` scheduler.

| Preset | Dimensions | CFG | Steps | Sampler | Notes |
|--------|-----------|-----|-------|---------|-------|
| `painterly-fantasy` | 1216×832 | 6.5 | 40 | dpmpp_2m | SFW default |
| `cinematic-scifi` | 1216×832 | 6 | 40 | dpmpp_2m | SFW |
| `dark-ink` | 1216×832 | 7 | 40 | dpmpp_2m | SFW |
| `anime-rpg` | 1024×1024 | 7 | 30 | dpmpp_2m | SFW, clipSkip 2 |
| `sketch-parchment` | 1024×1024 | 6 | 30 | dpmpp_2m | SFW |
| `grimdark-horror` | 1216×832 | 7 | 40 | dpmpp_2m | SFW horror |
| `photorealistic` | 1216×832 | 4.5 | 40 | dpmpp_2m_sde | SFW, faceDetailer |
| `extreme-horror` | 1216×832 | 5.5 | 45 | dpmpp_2m_sde | SFW (graphic horror) |
| `custom` | — | — | — | — | driven by `campaign.customImageConfig` |

Other exports: `getStyleConfig(style, custom?)` (resolves a preset, overlays custom config), `GENRE_DEFAULT_STYLE` (genre → preset), `GENRE_ANCHORS` (per-genre anchor phrases), and the shared negative-prompt constants.

## API routes & status polling

- **`GET /api/images/rpg/[...path]`** — serves PNGs from `D:/ai-output/rpg`. Path-traversal guarded (rejects `..`/`\` and paths escaping the base); immutable cache headers.
- **`trpc.images.status`** — returns the full `sceneImages` row (status, progress, progressPhase, filePath, seed, …) or `null`. Polled every 2s by `hooks/use-image-status.ts` while `status === "generating"` (the former REST route was removed).

## tRPC surface — `server/routers/images.ts`

`illustrate`, `regenerate`, `status`, `listBySession`, `listBySessionWithContext`, `listByCampaignGrouped`, `uploadReference`, `getReference`. See `ARCHITECTURE.md` for signatures. The galleries (`/campaigns/[id]/gallery`, `/.../sessions/[id]/gallery`) and the in-chat `scene-image` component consume these.

## Frontend surfaces

- `components/chat/scene-image.tsx` — inline scene image in the chat with lazy load, fullscreen, edit-prompt + regenerate, copy-seed (uses `useImageStatus`); the progress bar is `scene-image-progress.tsx`.
- `components/images/prompt-editor.tsx` — positive/negative prompt fields (with Copy) shared by `scene-image` and `image-lightbox`.
- `components/gallery/*` — `image-card`, `image-gallery`, `image-lightbox` (regenerate/edit, context snapshot), `session-group`.
- `components/characters/reference-portrait.tsx` — upload/view a character's IP-Adapter reference.

## Storage paths (hardcoded — Windows)

| Path | Contents |
|------|----------|
| `D:/ai-output/rpg/<campaignId>/<imageId>.png` | generated scene images (DB stores relative `rpg/...`) |
| `D:/ai-output/rpg/<campaignId>/refs/<name>.png` | character references |
| `D:/ai-input/ref_<campaign8>_<name>.png` | refs staged for ComfyUI `LoadImage` |
| `D:/ai-output/rpg/error.log` | image-gen failure log |
| `D:/ai-models/{sdxl,sdxl-vae,sdxl-lora}/` | model files (mounted into ComfyUI via docker-compose) |

These paths are baked into `comfyuiClient.ts`, `referenceManager.ts`, the image API route, and `docker-compose.yml`. Porting to another OS/layout requires changing all of them together.

## Testing

`tests/server/image/` covers `appearanceComposer`, `comfyuiClient` (workflow building + node injection), `promptWriter` (dimensions, prompt context), `stylePresets`, and `vramManager` (lock arbitration).
