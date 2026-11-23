# Fase 3 — Estructura del backend: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el backend tenga una sola fuente de verdad para tipos, enums y configuración, que valide los JSON que lee de la DB, que `runPipeline` quede partido en etapas legibles con dependencias explícitas y que no quede código muerto. Todo esto sin cambiar el comportamiento observable.

**Architecture:** refactor puro, protegido por la suite existente. La red de seguridad son los tests de integración de `runPipeline` (`tests/pipeline/runPipeline.test.ts`, Fase 2), que **no se modifican** salvo imports. Cada tarea deja la suite en verde.

**Tech Stack:** TypeScript strict, Drizzle 0.45 + better-sqlite3, zod 3, Vitest 2.

**Dónde:** worktree `D:/proyects/rpg-story-generator-refactor`, rama `refactor/phase-3-structure`, que sale de la punta de `refactor/phase-2-robustness` (ramas apiladas). Nunca push, nunca merge a `master` y nunca escribir `data/rpg.db`. **No correr `npm install` ni `npm uninstall`** (el worktree tiene su propio `node_modules`, instalado con `npm ci`; cambiar dependencias desincroniza el lockfile del usuario). **Nunca** crear junctions de `node_modules` ni borrar worktrees con `--force`: en Windows el borrado sigue el junction.

**Fuera de alcance de esta fase** (quedan anotados para después): partir `promptWriter.ts` (1011 líneas), el presupuesto de tokens del prompt (cambia la narración y necesita evaluación con el modelo real), sacar las dependencias `openai` y `@anthropic-ai/sdk` (requiere `npm uninstall`) y borrar las columnas `messages.streaming_text` / `is_streaming` (requiere una migración sobre la DB real).

**Línea de base:** la suite al final de la Fase 2.

---

## Orden y commits

3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9. Un commit por tarea. Después de cada una: `npm test && npm run typecheck && npm run lint`. Las tareas que mueven código **no cambian lógica**: si un test falla, la causa es el movimiento, no el test.

---

### Task 3.1: Reorganizar los tests

**Problema:** `tests/convex/` está mal nombrado: testea `server/pipeline`. `environmentMatchGlobs` en `vitest.config.mts` está deprecado. Y vitest recolecta los `scripts/*.test.mts` (los e2e con PLAY_LOOP) dentro de `npm test`.

- [ ] `git mv tests/convex/<cada archivo> tests/pipeline/`. Si algún nombre ya existe en `tests/pipeline/`, renombrar el que viene de convex con el sufijo `.legacy`, aunque no debería pasar. Arreglar los imports relativos (`../../server/...` quedan iguales porque la profundidad es la misma; los `../helpers/...` también). Borrar `tests/convex/` cuando quede vacío.
- [ ] `vitest.config.mts`: reemplazar `environmentMatchGlobs` por la opción de environment por archivo que soporte la versión instalada, preferiblemente `test.projects` o `workspace`:
  - **unit:** `tests/**/*.test.ts`, entorno node.
  - **components:** `tests/components/**`, entorno jsdom.
  - **e2e:** `scripts/*.test.mts`, que solo se incluye cuando `PLAY_LOOP` está seteado.

  Si la versión instalada de vitest (2.x) no soporta `projects`, alcanza con un `include` explícito más un comentario `// @vitest-environment jsdom` en `tests/components/*.test.tsx`, y sacar `environmentMatchGlobs`. Lo importante es el resultado: `npm test` no recolecta `scripts/`, y `PLAY_LOOP=1 npx vitest run scripts/ --no-file-parallelism` los sigue corriendo.
  Mantener `env: { DB_PATH: ":memory:" }` salvo con PLAY_LOOP, y mantener `setupFiles`.
- [ ] `package.json`: agregar el script `"test:e2e": "PLAY_LOOP=1 vitest run scripts/ --no-file-parallelism"`. En Windows, `npm` corre los scripts con cmd y `VAR=x` no anda en cmd. Si el repo no tiene `cross-env`, **no** instalarlo: documentar el comando en CLAUDE.md y no agregar el script.
- [ ] `.gitignore`: agregar `scripts/launch.log`. Si el archivo está trackeado, `git rm --cached scripts/launch.log` (el archivo queda en disco).
- [ ] Verificar: `npm test` da el mismo conteo de tests que antes de la tarea, sin los 4 skipped de scripts si ya no se recolectan. Commit `test: move pipeline tests out of tests/convex; drop deprecated environmentMatchGlobs; keep e2e out of npm test`.

---

### Task 3.2: Configuración central

**Problema:** la URL de Ollama está repetida en 6 lugares, las rutas `D:/` en 8 y el id `"default"` de settings en 5. `OUTPUT_BASE` tiene tres nombres distintos, y la ruta que sirve imágenes ignora `RPG_OUTPUT_DIR`.

**Files:** Create `server/config.ts`, `tests/server/config.test.ts`. Modify: `server/llm/config.ts`, `server/llm/providers.ts`, `lib/constants.ts`, `server/image/comfyuiClient.ts`, `server/image/imageOrchestrator.ts`, `server/image/portraitGenerator.ts`, `server/image/referenceManager.ts`, `app/api/images/rpg/[...path]/route.ts`, `server/db/index.ts`, `server/pipeline/orchestrator.ts`, `server/image/buildImageContext.ts`, `server/routers/images.ts`, `server/routers/sessions.ts`, `server/routers/userSettings.ts`, `server/pipeline/promptBuilder.ts`.

- [ ] **Test primero** (`tests/server/config.test.ts`): `readConfig(env)` es una función pura que recibe un objeto env.
  1. Con un env vacío devuelve los defaults actuales: `ollamaUrl "http://localhost:11434"`, `comfyuiUrl "http://localhost:8188"`, `comfyuiWsUrl "ws://localhost:8188/ws"`, `outputDir "D:/ai-output/rpg"`, `comfyuiInputDir "D:/ai-input"`, `dbPath` igual a `<cwd>/data/rpg.db`, `ollamaNumCtx 12288`.
  2. Respeta `OLLAMA_URL`, `COMFYUI_URL`, `COMFYUI_WS_URL`, `RPG_OUTPUT_DIR`, `COMFYUI_INPUT_DIR`, `DB_PATH` y `OLLAMA_NUM_CTX` (este último parseado a número).
  3. Un `OLLAMA_NUM_CTX` no numérico tira un error claro.
- [ ] **Implementar `server/config.ts`:**
  ```ts
  import { join } from "path";
  import { z } from "zod";

  const Env = z.object({
    OLLAMA_URL: z.string().url().default("http://localhost:11434"),
    COMFYUI_URL: z.string().url().default("http://localhost:8188"),
    COMFYUI_WS_URL: z.string().default("ws://localhost:8188/ws"),
    RPG_OUTPUT_DIR: z.string().default("D:/ai-output/rpg"),
    COMFYUI_INPUT_DIR: z.string().default("D:/ai-input"),
    DB_PATH: z.string().optional(),
    OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(12288),
  });

  export interface AppConfig {
    ollamaUrl: string; comfyuiUrl: string; comfyuiWsUrl: string;
    outputDir: string; comfyuiInputDir: string; dbPath: string; ollamaNumCtx: number;
  }

  export function readConfig(env: Record<string, string | undefined>): AppConfig {
    const e = Env.parse(env);
    return {
      ollamaUrl: e.OLLAMA_URL, comfyuiUrl: e.COMFYUI_URL, comfyuiWsUrl: e.COMFYUI_WS_URL,
      outputDir: e.RPG_OUTPUT_DIR, comfyuiInputDir: e.COMFYUI_INPUT_DIR,
      dbPath: e.DB_PATH ?? join(process.cwd(), "data", "rpg.db"),
      ollamaNumCtx: e.OLLAMA_NUM_CTX,
    };
  }

  /** Process-wide config, read once from the environment. */
  export const config = readConfig(process.env);

  /** The single user-settings row id (single-user app). */
  export const SETTINGS_ID = "default";
  ```
  Usar `z.string().url()` en las URLs HTTP solo si los tests lo soportan; `ws://` no siempre valida como URL en zod, por eso `COMFYUI_WS_URL` es un `string` simple. Ojo: `DB_PATH=":memory:"` tiene que seguir funcionando en vitest.
- [ ] **Reemplazos:**
  - Cada `?? "http://localhost:11434"` pasa a `config.ollamaUrl`. `server/llm/config.ts` exporta `DEFAULT_OLLAMA_URL = config.ollamaUrl`. `lib/constants.ts:97`: este archivo es **client-side** y no puede importar `server/config` (usa `process.env` del server). Dejar su literal con el comentario `// keep in sync with server/config.ts default`. El `schema.ts:114` (column default) queda igual.
  - Cada `OUTPUT_BASE`/`OUTPUT_DIR` local o `?? "D:/ai-output/rpg"` pasa a `config.outputDir`, y cada `"D:/ai-input"` a `config.comfyuiInputDir`. **`app/api/images/rpg/[...path]/route.ts`** pasa a usar `config.outputDir`; esto arregla que ignore `RPG_OUTPUT_DIR`.
  - `COMFYUI_URL`/`COMFYUI_WS_URL` de `comfyuiClient.ts` pasan a `config.*`.
  - `OLLAMA_NUM_CTX` en `providers.ts` pasa a `config.ollamaNumCtx`, y el default `maxCtx = 12288` de `promptBuilder.ts:42` pasa a `config.ollamaNumCtx`. `promptBuilder` importa server config; es server-only, verificarlo con grep: ningún componente cliente lo importa (sí lo importa `narrative-renderer`? **no**: ese importa `stateParser`. Verificar). Si `promptBuilder` llegara a un bundle cliente, dejar el literal.
  - `server/db/index.ts` usa `config.dbPath`.
  - Cada `eq(userSettings.id, "default")` en server pasa a `SETTINGS_ID`, incluido `userSettings.ts`, que tiene su propio `DEFAULT_ID` (reemplazarlo). Los `scripts/*.test.mts` pueden quedar como están.
- [ ] Verificar con grep:
  - `localhost:11434` en `server/` solo aparece en `server/config.ts` y en el default de `schema.ts`.
  - `D:/` en `server/` y `app/` solo aparece en `server/config.ts`.
  - `"default"` como id de settings en `server/` solo aparece en `config.ts` y `schema.ts`.

  Commit `refactor: central server config (env-driven); image serving honors RPG_OUTPUT_DIR`.

---

### Task 3.3: Tipos derivados del schema y enums únicos

**Problema:** `types/index.ts` copia las filas a mano y ya derivó: a `Session` le faltan `storyState`, `sceneState` y `consequenceSeeds`; a `Campaign`, `storyState`; a `SceneImage`, `contextSnapshot`; los enums aparecen como `string`. Los shapes JSON están inline en `schema.ts`, y `schema.ts` importa de `@/types` (inversión de capas). Los enums están copiados entre 4 y 6 veces.

**Files:** Create `lib/enums.ts` (client-safe, sin imports de server), `server/db/jsonTypes.ts`. Modify `server/db/schema.ts`, `types/index.ts`, `types/gallery.ts`, `server/image/types.ts`, `server/routers/campaigns.ts`, `server/routers/characters.ts`, `server/pipeline/turnCommit.ts`, `server/pipeline/promptBuilder.ts`, `components/campaigns/campaign-form.tsx`, `lib/constants.ts`, `server/llm/providers.ts`.

- [ ] **`lib/enums.ts`:**
  ```ts
  export const GENRES = ["fantasy", "sci-fi", "horror", "post-apocalyptic", "custom"] as const;
  export const TONES = ["serious", "humorous", "dark", "lighthearted"] as const;
  export const DIFFICULTIES = ["easy", "normal", "hard", "nightmare"] as const;
  export const IMAGE_STYLES = [/* copiar exactamente de schema.ts:20 */] as const;
  export const LLM_PROVIDERS = ["ollama", "openai", "anthropic"] as const;
  export const TRIGGER_TYPES = ["scene_change", "consequence", "combat", "gm_event", "player_request"] as const;
  export const IMAGE_STATUSES = ["generating", "completed", "failed", "replaced"] as const;
  export const SESSION_STATUSES = ["active", "completed"] as const;
  export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
  export type Genre = (typeof GENRES)[number]; // ...one type per array
  ```
  Antes de copiar, comparar cada array con **todas** las definiciones existentes, incluido el listado del relevamiento. Si difieren, la fuente de verdad es `schema.ts`; si `schema.ts` y el router difieren, reportarlo y usar la unión del schema.
- [ ] **`server/db/jsonTypes.ts`:** mover acá, sin cambios de forma, los shapes JSON que hoy están inline en `schema.ts`:
  - `QuickAction`, `CustomImageConfig`, `Appearance`, `ConsequenceSeed`, `SceneState`, `MessageMetadata`, `NpcRelationship`, `NpcMemoryLogEntry`, `ContextSnapshot` (con `rating?`).
  - Desde `types/index.ts`, los de story: `SessionStoryState`, `CampaignStoryState`, `StoryThread`, `CampaignStoryThread`, `ThreadKind`, `ThreadStatus`, `ArcPhase`, `DirectorIntent`, y lo que esos necesiten.

  `schema.ts` usa estos tipos en sus `$type<...>()` y sus enums de `lib/enums.ts`, y deja de importar de `@/types`.
- [ ] **`types/index.ts`:**
  - Re-exportar los tipos de story y JSON desde `server/db/jsonTypes`, y los enums/tipos desde `lib/enums`.
  - Reemplazar las interfaces de fila por los row types: `Campaign = CampaignRow`, `Character = CharacterRow`, `Session = SessionRow`, `NPCMemoryDoc = NpcMemoryRow`, `NPCMemoryEntry = MemoryRow` y `SceneImage = SceneImageRow`. Usar `import type`, que es seguro para el cliente porque los tipos se borran en compilación.
  - `Message` pasa a `MessageRow`. Las columnas `streamingText`/`isStreaming` existen en la fila, así que el cliente sigue funcionando.
  - `UserSettings` queda como tipo de API (sin keys y con `has*Key`), pero derivado: `Omit<UserSettingsRow, "openaiApiKey" | "anthropicApiKey"> & { hasOpenaiKey: boolean; hasAnthropicKey: boolean }`. Verificar contra lo que devuelve `userSettings.get`.
  - `LLMProvider` sale de `lib/enums`, y `server/llm/providers.ts` lo re-exporta para no romper imports.
- [ ] `types/gallery.ts` `ContextSnapshot` pasa a re-exportar el de `jsonTypes`. `server/image/types.ts` toma `ImageStatus`, `TriggerType` y `CustomImageConfig` de las fuentes únicas.
- [ ] Los routers (`campaigns.ts`, `characters.ts`) usan `z.enum(GENRES)` etc. Los `<option>` de `campaign-form.tsx` para estilos de imagen se generan desde `IMAGE_STYLES` con un mapa de labels, si los labels no son triviales. `lib/constants.ts` usa los arrays para sus listas de opciones.
- [ ] Los duplicados de `SceneState` (`turnCommit.ts:11`, `promptBuilder.ts:32-39`) y de `ConsequenceSeed` (`turnCommit.ts:12`, `ConsequenceSeedLite`) pasan a usar los de `jsonTypes`. `ConsequenceSeedLite` puede quedar como `Pick<ConsequenceSeed, ...>` si lo usa el director.
- [ ] `CampaignFormData`, que está triplicado en `campaign-form.tsx:8`, `new/page.tsx:12` y `edit/page.tsx:12`, se exporta desde `campaign-form.tsx` y se importa en las páginas.
- [ ] **Verificar:**
  - `npm run typecheck` es el juez. Los errores que aparecen son exactamente las derivas que esta tarea arregla: corregir los call sites, **no** volver a ensanchar los tipos.
  - `grep -n '@/types' server/db/schema.ts` no devuelve nada.

  Commit `refactor(types): derive row types from the schema; one definition per enum and JSON shape`.

---

### Task 3.4: Validar las columnas JSON al leerlas

**Problema:** `storyState`, `consequenceSeeds`, `sceneState` y `relationships` se leen y se usan sin validar (por ejemplo `promptBuilder.ts:99-121` lee `.activeNPCs.length`). Un blob corrupto o viejo tira el turno.

**Files:** Create `server/db/jsonSchemas.ts`, `tests/server/db/jsonSchemas.test.ts`. Modify `server/pipeline/orchestrator.ts` (las lecturas de `session.storyState`, `session.sceneState`, `session.consequenceSeeds` y `campaign.storyState`), y `server/pipeline/promptBuilder.ts` (guardas en `relationships` y `secrets`).

- [ ] **Tests primero.** Para cada función:
  - `readSessionStoryState(raw)`: válido → igual; `null` → `coldStartState()`; sin `threads` o con `version` distinto → `coldStartState()` más un `console.warn`; threads con un elemento roto → se descarta ese elemento y se conservan los demás.
  - `readSceneState(raw)`: válido → igual; si faltan arrays (`activeNPCs`, `pendingThreats`), se completan con `[]`; basura → `null`.
  - `readConsequenceSeeds(raw)`: se filtran los elementos sin `echo` o con `messagesUntilEcho` no numérico; no-array → `[]`.
  - `readCampaignStoryState(raw)`: válido → igual; basura → `null`.
- [ ] **Implementar** con zod (`safeParse`) los schemas que reflejan los tipos de `jsonTypes.ts`, con `z.ZodType<T>` anotado para que no puedan derivar. Loggear con `console.warn("[json] invalid <col>", issues)` cuando se cae al fallback. **No** se escribe nada en la DB: la versión limpia se persiste naturalmente en el próximo commit del turno.
- [ ] **Conectar** en el orchestrator, justo después de cargar `session` y `campaign`: `const storyState0 = readSessionStoryState(session.storyState)`, etc. A partir de ahí, usar esas variables en lugar de los campos crudos (`session.storyState ?? coldStartState()` desaparece). En `promptBuilder.ts`, `npc.relationships ?? []` y `npc.secrets ?? []`.
- [ ] Commit `fix(pipeline): validate JSON columns on read with safe fallbacks`.

---

### Task 3.5: Helpers compartidos

**Files:** Create `server/pipeline/text.ts`, `lib/stats.ts`. Modify los sitios listados.

- [ ] **`server/pipeline/text.ts`** (con tests en `tests/pipeline/text.test.ts`):
  - `MECHANIC_MARKER_RE = /\[MECHAN\w*:[^\]]*\]/gi`.
  - `stripMechanicMarkers(text)`: borra los markers completos y colapsa espacios. Reemplaza `orchestrator.ts:265, :281, :393, :404`.
  - `stripMechanicMarkersLoose(text)`: `/\[MECHAN[^\]]*\]?/g`, para el historial donde puede haber markers truncados. Reemplaza `orchestrator.ts:118`.
  - Mover `sameName` desde `turnCommit.ts` y exportarlo. Reemplazar los compares inline de nombres de NPC en `turnCommit.ts:19, :155`, `orchestrator.ts:456` y `npcSelection.ts:40` (solo donde el compare es igualdad trim+lower; no tocar los `includes` de `utils.ts:11`, que son otra semántica).

  `diceResolver.ts` usa regexes de **parseo** (con grupos de captura): no tocar. Los regexes del cliente (`narrative-renderer`, `chat-container`) se ven en la Fase 4.
- [ ] **`lib/stats.ts`** (client-safe; tests en `tests/lib/stats.test.ts`):
  ```ts
  /** The stat key holding current HP ("HP" or "hp"), if the character tracks it. */
  export function hpKey(stats: Record<string, number>): "HP" | "hp" | null { ... }
  /** The stat key holding max HP ("MaxHP" or "maxHp"), if any. */
  export function maxHpKey(stats: Record<string, number>): "MaxHP" | "maxHp" | null { ... }
  ```
  Reemplazar la resolución inline en `turnCommit.ts`, `promptBuilder.ts`, `stateParser.ts:176-177`, `stat-block.tsx:58-59` y `character-form.tsx:75-77`. `character-card.tsx` es código muerto (Task 3.9): no tocarlo. Mantener **exactamente** la precedencia actual: primero `HP` y después `hp`; primero `MaxHP` y después `maxHp`. Si algún sitio usa otra precedencia, reportarlo en lugar de unificarlo a ciegas.
- [ ] **Brace scanner:** extraer a `server/pipeline/json.ts` un `scanBalanced(text, start, opener)` con el manejo de strings y escapes que comparten `stateParser.ts:19-32` y `narrativeExtractor.ts:131-152`. Las dos funciones llaman al helper conservando su semántica: la de objetos sola, y la de `{`/`[` con auto-cierre. Los tests existentes de `stateParser` y `narrativeExtractor` son la red de seguridad. Mover también el JSDoc mal ubicado (`narrativeExtractor.ts:110-114`) a `repairJson`.
- [ ] Commit `refactor: shared marker-strip, NPC-name, HP-key and brace-scan helpers`.

---

### Task 3.6: Partir `runPipeline` en etapas

**Problema:** `runPipeline` tiene unas 530 líneas (`orchestrator.ts:50-577`) y mezcla lock, carga de datos, armado de prompts, mecánicas, commit y el job de fondo. El contexto del prompt está duplicado entre el path trivial (134-150) y el standard (228-244).

**Red de seguridad:** `tests/pipeline/runPipeline.test.ts` (los 6 tests), más toda la suite. **No se modifican** esos tests.

**Files:** Create `server/pipeline/turn/context.ts`, `turn/prompt.ts`, `turn/mechanics.ts`, `turn/stateJob.ts`. Modify `server/pipeline/orchestrator.ts`.

- [ ] **`turn/context.ts`:** `loadTurnContext(db, sessionId)`. Hace todas las lecturas que hoy están en las líneas 90-120: session, campaign, chars, settings, NPCs, recent messages (con strip y dedupe), `lastAssistantMessages`, configs (`buildProviderConfig`/`buildFallbackConfig`) y los JSON ya validados (Task 3.4). Devuelve un objeto `TurnContext` tipado. Si falta la session o la campaign, tira los mismos errores que hoy.
- [ ] **`turn/prompt.ts`:**
  - `promptCampaign(campaign)` y `promptCharacters(chars)` reemplazan los bloques duplicados de las líneas 134-150 y 228-244.
  - `buildSceneSummary(recentMessages, mode: "trivial" | "standard")` concentra las dos variantes (127-130 y 209-215), con exactamente la misma salida.
- [ ] **`turn/mechanics.ts`:** el bloque de las líneas 290-425. Abarca draft STATE_UPDATE, `resolveMechanics`, emisión de tiradas por `onToken`, snippet writer, cleanup/dedupe/echo strip, STATE_UPDATE tardío y texto fallback por género. Se expone como `resolveTurnMechanics(args): Promise<{ finalText, mechanics, stateUpdate, damage }>`. Recibe `onToken`, `signal`, configs y `narratorDraft`.
- [ ] **`turn/stateJob.ts`:** el cuerpo del job de step 3 (466-555) como `runStateJob(args)`, que `runPipeline` encola con `enqueueBackground(turnStateKey(...), () => runStateJob({...}))`. Mismas lecturas, mismo orden y mismo `commitTurnState`.
- [ ] **`orchestrator.ts`** queda como coordinador:
  - Lock, keep-alive, wait, insert del user message, `loadTurnContext`, rama trivial/standard (cada una de unas 30 líneas usando los helpers), `commitTurn`, `onComplete`, handoff y encolado del job y del aux.
  - Los `catch`/`finally` siguen como están hoy.
  - `updateCampaignJournal`, `updateContextSummary` y `maybeGenerateTitle` se mueven a `turn/aux.ts`. `updateCampaignJournal` sigue exportado y `sessions.ts` lo importa desde la nueva ubicación.
  - Objetivo: `orchestrator.ts` con 250 líneas o menos, y ningún archivo de `turn/` con más de 250.
- [ ] **Regla de oro:** mover y no reescribir. Cada función nueva es un *cut & paste* del bloque original más parámetros explícitos. Cualquier cambio de lógica es un bug de esta tarea.
- [ ] `npm test` (con los 6 tests de `runPipeline` sin tocar), typecheck y lint. Commit `refactor(pipeline): split runPipeline into context, prompt, mechanics and state-job stages`.

---

### Task 3.7: Proveedores LLM

**Problema:** `providers.ts` tiene 851 líneas, el loop de stream con chequeo de repetición está copiado 3 veces (Ollama 268-324, OpenAI 411-450, Anthropic 545-588), OpenAI y Anthropic no procesan el buffer final, y `truncateToFit` no tiene callers.

**Files:** Create `server/llm/streamLoop.ts`, `server/llm/ollama.ts`, `server/llm/openai.ts`, `server/llm/anthropic.ts`, `tests/server/llm/streamLoop.test.ts`. Modify `server/llm/providers.ts`.

- [ ] **`streamLoop.ts`:** `readStream(body, parseLine, onChunk): Promise<string>`.
  - Lee el `ReadableStream`, parte por líneas y aplica `parseLine(line) → string | null` para el delta de texto.
  - Acumula, llama a `onChunk` y aplica el `repeatWindow` + `checkRepetition` (mover `checkRepetition` acá). Corta con `reader.cancel()` si detecta repetición.
  - **Procesa el buffer final** para los tres proveedores.
  - Tests: deltas en varios chunks, línea partida entre chunks, buffer final, corte por repetición, línea malformada ignorada.
- [ ] Mover `callOllama`, `callOpenAI` y `callAnthropic` a sus archivos, usando `readStream` con su `parseLine` (Ollama NDJSON con `message.content`, OpenAI SSE con `data:` y `choices[0].delta.content`, Anthropic SSE con `content_block_delta`). El path no-streaming de Ollama queda igual. Comparar línea por línea con el original los headers, el body y el manejo de errores.
- [ ] `providers.ts` queda con los tipos, `LLMAbortedError`, `linkSignal`, el semáforo (si lo usa solo Ollama, va a `ollama.ts`), `callLLM`, `cleanGibberish`, `estimateTokens` y `classifyError`, y re-exporta lo que importan otros archivos. Borrar `truncateToFit`. Dejar de exportar lo que no tiene importers externos.
- [ ] `tests/server/llm/providers.test.ts` (Fase 2) sigue en verde sin cambios, salvo imports. Commit `refactor(llm): one shared stream loop; providers in their own modules`.

---

### Task 3.8: Lógica fuera de los routers

- [ ] **`server/pipeline/sessionEnd.ts`:** mover desde `sessions.ts` `endSession` (líneas ~84-179) la parte de dominio. Abarca: esperar las colas, cargar los últimos mensajes y el summary, el prompt del recap, la llamada LLM con `cleanRecap`, el update de la sesión y el encolado del journal. Se expone como `endSession(db, sessionId): Promise<{ summary: string }>`. El router queda con validación y lock: toma el lock, llama al servicio, libera en `finally` y mapea a `TRPCError`. Los imports dinámicos (`await import(...)`) pasan a estáticos, salvo que haya un ciclo real; en ese caso dejarlo comentado.
- [ ] `routers/images.ts` y `routers/memories.ts` usan `ctx.db` en lugar del `db` global en todas sus queries. Las funciones de `server/image/*` que reciben `db` implícito pueden seguir con el global, porque no son routers.
- [ ] `app/api/chat/stream/route.ts`: validar el body con zod (`sessionId` string no vacío, `message` string de 1 a 8000 caracteres, `metadata` opcional con el schema de `MessageMetadata` de `jsonTypes`, convertido a zod en `jsonSchemas.ts`). Ante un body inválido devolver 400 con el mismo formato que hoy. Tests de la ruta en `tests/server/chatRoute.test.ts`: llamar `POST(new Request(...))` con un `runPipeline` mockeado; casos de body inválido → 400, y válido → stream que contiene el `done` del mock.
- [ ] Los tests de `sessions` existentes quedan en verde. Commit `refactor: session-end service; routers use ctx.db; validate chat stream input`.

---

### Task 3.9: Código muerto y docs

Commit propio, así el usuario puede revertirlo aislado.

- [ ] **Procedimientos tRPC sin callers** (verificar de nuevo con grep en `app/`, `components/`, `hooks/` y `tests/` antes de borrar):
  - `images.listBySession`
  - `messages.listRecent`, `countBySession`, `send` y `storeAssistant`
  - `sessions.update`
  - el router `memories` completo (`listByNpc`), incluido su registro en `server/root.ts`

  **Se conservan** `images.status` (lo va a usar la Fase 4) y `npcMemory.upsert` (está documentado y tiene tests).
- [ ] **Componentes sin importers** (re-verificar):
  - campaign-list, campaign-card, campaign-settings, delete-campaign-dialog
  - character-list, character-card
  - session-list, session-card, new-session-button, session-summary
  - state-update-notification
  - `components/ui/badge`, `components/ui/sheet`, `components/ui/textarea`
  - `hooks/use-dice-roller.ts`

  Ajustar el comentario de `scripts/play-loop.test.mts:124` que menciona `character-card.tsx`.
- [ ] **`ImagePipelineContext`:** borrar `step3Promises`, `resolutions`, `markers`, `readyEchoes`, `gmInitiative` e `isPlayerRequest`, que siempre valen `[]`, `""` o `true`. Simplificar sus consumidores:
  - Los `Promise.allSettled([])` se borran.
  - `detectBeat`, si con `isPlayerRequest` siempre `true` vuelve temprano, se reemplaza en el call site por lo que devuelve esa rama.
  - Si `beatDetector.ts` queda sin uso, borrarlo junto con su test, que solo cubre la rama muerta. Verificar antes de borrar que el test no cubre otra cosa usada.
- [ ] **Docs:**
  - `ARCHITECTURE.md`: sacar pacing/narrativeArc (:7, :17, :59, :76, :122-124, :250); actualizar las columnas de Session (storyState, sceneState, consequenceSeeds) y los procedimientos; reemplazar `extractNpcMemory` por `applyNpcUpdates`.
  - `CLAUDE.md`, "Directory map": agregar `server/config.ts`, `server/db/jsonTypes.ts`, `server/db/jsonSchemas.ts`, `lib/enums.ts`, `server/pipeline/turn/*`, `server/llm/*` y `server/pipeline/sessionEnd.ts`; actualizar el gotcha de `tests/convex`.
- [ ] Commit `chore: remove dead procedures, components and image-context fields; refresh docs`.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La Task 3.3 revela muchas derivas de tipos en el cliente | Son bugs latentes reales. Se corrigen los call sites; si la corrección requiere cambiar comportamiento de UI, se anota y se deja un cast local con `// TODO(phase-4)`. |
| La Task 3.6 cambia la lógica sin querer | Mover sin reescribir; los tests de integración de `runPipeline` quedan intactos; revisión con diff "moved lines" (`git diff --color-moved`). |
| Vitest 2 no soporta `projects` | Plan B en la Task 3.1: `include` explícito más comentarios de environment por archivo. |
| `server/config.ts` llega a un bundle de cliente | Solo lo importan módulos de `server/` y route handlers. El cliente usa `lib/` (client-safe). Verificarlo con grep en la Task 3.2. |
