# Fase 2 — Robustez: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un turno sobreviva fallas, reintentos y desconexiones sin duplicar texto, sin dejar basura en la DB y sin perder lo que escribió el jugador; y que la generación de imágenes no se trabe ni pelee la GPU con Ollama.

**Architecture:** Una sola fuente de configuración LLM (`server/llm/config.ts`). `callLLM` acepta un `AbortSignal` y lanza `LLMAbortedError`. Un helper `narrate()` maneja reintentos y fallback con un sink nuevo por intento y avisa `onReset` al cliente. La ruta SSE propaga la desconexión del cliente. Las cadencias pasan a medirse en turnos. Del lado de imágenes: un "GPU gate" con dueño (token) reemplaza el lock de VRAM, Ollama espera mientras se genera una imagen, los jobs huérfanos se marcan `failed` y el cliente de ComfyUI abre el WebSocket antes de encolar.

**Tech Stack:** TypeScript strict, Next.js 15 (route handlers), tRPC 11, Drizzle 0.45 + better-sqlite3 12 (transacciones síncronas), Vitest 2, `ws`.

**Contexto previo:** la Fase 1 ya está en `master` (merge `fa13e02`). Ver `CLAUDE.md`: `sessionLock.ts`, `backgroundQueue.ts`, `turnCommit.ts`, `server/db/open.ts`, `tests/helpers/testDb.ts`. Vitest fuerza `DB_PATH=:memory:`, así que `import { db } from "@/server/db"` en un test da una DB en memoria ya migrada.

**Dónde se trabaja:** worktree `D:/proyects/rpg-story-generator-refactor`, rama `refactor/phase-2-robustness` (sale de `master`). `node_modules` es un junction al checkout principal. **Nunca** push ni merge a `master`. Nunca escribir `data/rpg.db`: para pruebas con modelo real, usar una copia hecha con `.backup()` (ver la memoria del proyecto `sqlite-wal-backups`).

**Línea de base:** 529 tests pasan y 4 se saltean; typecheck y lint limpios.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `server/llm/config.ts` | Crear | `buildProviderConfig`, `buildFallbackConfig` (null para cloud), `buildLocalConfig`, `DEFAULT_OLLAMA_URL`, `FALLBACK_OLLAMA_MODEL` |
| `server/llm/providers.ts` | Modificar | Parámetro `signal` en `callLLM` y en cada proveedor; `LLMAbortedError`; espera al GPU gate en `callOllama` |
| `server/llm/gpuGate.ts` | Crear | Hold exclusivo de la GPU con token, waiters y vencimiento por stale |
| `server/pipeline/narrate.ts` | Crear | Reintento + fallback con sink nuevo por intento, `onReset`, re-lanza los aborts |
| `server/pipeline/orchestrator.ts` | Modificar | Usa config, `narrate`, `signal`, `onReset`, limpia el mensaje huérfano, mensajes de error clasificados, cadencias por turno |
| `server/pipeline/utils.ts` | Modificar | `isDue(turn, lastTurn, every)` |
| `server/pipeline/director.ts` | Modificar | `mergeStoryState` conserva `lastReconcileTurn` y `lastJournalTurn` |
| `types/index.ts` | Modificar | Campos opcionales nuevos en `SessionStoryState`; `ImageStatus` (en `server/image/types.ts`) suma `"replaced"` |
| `app/api/chat/stream/route.ts` | Modificar | `AbortController` ligado a `req.signal` y a `cancel()`; eventos `reset` y `restoreInput` |
| `hooks/use-chat.ts` | Reescribir | Abort/stop, un solo `handleEvent`, `reset`, cierre sin `done`, cuerpo de error, invalidación de mensajes, devuelve el resultado |
| `components/chat/chat-container.tsx`, `chat-input.tsx` | Modificar | Restaurar el borrador y el dado si falla; botón Stop |
| `server/routers/sessions.ts`, `server/image/buildImageContext.ts`, `server/image/imageOrchestrator.ts`, `server/routers/images.ts`, `server/image/portraitGenerator.ts` | Modificar | Usan `server/llm/config.ts`; leases de VRAM |
| `server/image/vramManager.ts` | Reescribir | Lease con token sobre `gpuGate`; descarga los modelos realmente cargados (`/api/ps`) |
| `server/image/recovery.ts` | Crear | `failStaleImageJobs(db, now)` |
| `server/image/comfyuiClient.ts` | Modificar | Abre el WS con `clientId` antes del POST; completa por `prompt_id`; si el WS se cae, consulta `/history`; un único camino de submit |
| `server/image/paths.ts` | Crear | `sanitizeName`, `assertSafeSegment` |
| `server/image/referenceManager.ts` | Modificar | Valida `campaignId` |
| Tests nuevos | Crear | `tests/server/llm/config.test.ts`, `tests/server/llm/providers.test.ts`, `tests/server/llm/gpuGate.test.ts`, `tests/pipeline/narrate.test.ts`, `tests/pipeline/runPipeline.test.ts`, `tests/server/image/recovery.test.ts`, `tests/server/image/comfyuiWait.test.ts`, `tests/server/image/paths.test.ts`, `tests/server/routers/images.test.ts` |

Orden de tareas: 2.0 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 (chat) → 2.7 → 2.8 → 2.9 → 2.10 (imágenes) → 2.11 (cierre). Un commit por tarea. Después de cada una: `npm test && npm run typecheck && npm run lint`.

---

### Task 2.0: Preparación

- [ ] Verificar que la rama y el worktree están bien, y que la línea de base está en verde:

```bash
cd /d/proyects/rpg-story-generator-refactor && git branch --show-current && npm test 2>&1 | grep -E "Tests " && npm run typecheck && npm run lint
```
Esperado: `refactor/phase-2-robustness`, 529 tests pasan y 4 se saltean, sin errores.

---

### Task 2.1: Configuración LLM centralizada

**Problema:** `buildProviderConfig` y `buildFallbackConfig` viven sin exportar en `orchestrator.ts:48-69`; `routers/sessions.ts` (en `endSession`) los copia a mano. El fallback siempre es `mistral:7b-instruct` en Ollama, incluso para usuarios de OpenAI o Anthropic, que quizá ni tienen Ollama. Además, el prompt de imagen siempre va a Ollama con `settings.selectedModel`, que para un usuario cloud es un nombre de modelo cloud (`buildImageContext.ts:17-18`, `imageOrchestrator.ts:107-110`).

**Files:** Create `server/llm/config.ts`, `tests/server/llm/config.test.ts`. Modify `server/pipeline/orchestrator.ts`, `server/routers/sessions.ts`, `server/image/buildImageContext.ts`, `server/image/imageOrchestrator.ts`, `server/routers/images.ts`.

- [ ] **Paso 1: Test que falla.** `tests/server/llm/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildProviderConfig, buildFallbackConfig, buildLocalConfig, DEFAULT_OLLAMA_URL, FALLBACK_OLLAMA_MODEL } from "@/server/llm/config";
import { DEFAULT_OLLAMA_MODEL } from "@/server/llm/providers";
import type { UserSettingsRow } from "@/server/db/schema";

const settings = (over: Partial<UserSettingsRow>) => over as UserSettingsRow;

describe("buildProviderConfig", () => {
  it("defaults to local Ollama with the default model", () => {
    expect(buildProviderConfig(undefined)).toEqual({
      provider: "ollama", model: DEFAULT_OLLAMA_MODEL, ollamaBaseUrl: DEFAULT_OLLAMA_URL, apiKey: undefined,
    });
  });
  it("passes the matching API key for cloud providers only", () => {
    const s = settings({ provider: "openai", selectedModel: "gpt-4o", openaiApiKey: "sk-o", anthropicApiKey: "sk-a" });
    expect(buildProviderConfig(s).apiKey).toBe("sk-o");
    expect(buildProviderConfig({ ...s, provider: "anthropic" }).apiKey).toBe("sk-a");
    expect(buildProviderConfig({ ...s, provider: "ollama" }).apiKey).toBeUndefined();
  });
});

describe("buildFallbackConfig", () => {
  it("uses the small local model for Ollama users", () => {
    expect(buildFallbackConfig(settings({ provider: "ollama", ollamaBaseUrl: "http://gpu:11434" }))).toEqual({
      provider: "ollama", model: FALLBACK_OLLAMA_MODEL, ollamaBaseUrl: "http://gpu:11434",
    });
  });
  it("never switches a cloud user to a local model", () => {
    expect(buildFallbackConfig(settings({ provider: "openai" }))).toBeNull();
    expect(buildFallbackConfig(settings({ provider: "anthropic" }))).toBeNull();
  });
});

describe("buildLocalConfig", () => {
  it("keeps the user's model when they use Ollama", () => {
    expect(buildLocalConfig(settings({ provider: "ollama", selectedModel: "gemma4:e4b" })).model).toBe("gemma4:e4b");
  });
  it("falls back to the default local model for cloud users", () => {
    const c = buildLocalConfig(settings({ provider: "openai", selectedModel: "gpt-4o" }));
    expect(c).toMatchObject({ provider: "ollama", model: DEFAULT_OLLAMA_MODEL });
  });
});
```

`npx vitest run tests/server/llm/config.test.ts` → FAIL (falta el import).

- [ ] **Paso 2: Implementar `server/llm/config.ts`.**

```ts
import type { UserSettingsRow } from "../db/schema";
import { DEFAULT_OLLAMA_MODEL, type ProviderConfig } from "./providers";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
/** Smaller local model tried when the user's Ollama model fails. */
export const FALLBACK_OLLAMA_MODEL = "mistral:7b-instruct";

/** The user's chosen provider/model, from the settings row. */
export function buildProviderConfig(settings: UserSettingsRow | undefined): ProviderConfig {
  const provider = settings?.provider ?? "ollama";
  return {
    provider,
    model: settings?.selectedModel ?? DEFAULT_OLLAMA_MODEL,
    ollamaBaseUrl: settings?.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL,
    apiKey: provider === "openai"
      ? settings?.openaiApiKey ?? undefined
      : provider === "anthropic"
        ? settings?.anthropicApiKey ?? undefined
        : undefined,
  };
}

/**
 * Fallback narrator for Ollama users. Null for cloud providers: a cloud user
 * may not run Ollama at all, so a silent switch to a local model would fail
 * (or worse, quietly change the narrator) — retry the same provider instead.
 */
export function buildFallbackConfig(settings: UserSettingsRow | undefined): ProviderConfig | null {
  const primary = buildProviderConfig(settings);
  if (primary.provider !== "ollama") return null;
  return { provider: "ollama", model: FALLBACK_OLLAMA_MODEL, ollamaBaseUrl: primary.ollamaBaseUrl };
}

/** Local Ollama config for GPU-side work: the user's model if they use Ollama, else the default. */
export function buildLocalConfig(settings: UserSettingsRow | undefined): ProviderConfig {
  const primary = buildProviderConfig(settings);
  return {
    provider: "ollama",
    model: primary.provider === "ollama" ? primary.model : DEFAULT_OLLAMA_MODEL,
    ollamaBaseUrl: primary.ollamaBaseUrl,
  };
}
```
Verificar que `UserSettingsRow["provider"]` es asignable a `LLMProvider`; si es `string`, castear con `as ProviderConfig["provider"]` en ese único lugar y dejar anotado.

- [ ] **Paso 3:** `npx vitest run tests/server/llm/config.test.ts` → PASS (6).

- [ ] **Paso 4: Usar la config en el orchestrator.** En `server/pipeline/orchestrator.ts`, borrar `FALLBACK_MODEL`, `buildProviderConfig` y `buildFallbackConfig` (líneas ~45-69) e importar `import { buildProviderConfig, buildFallbackConfig } from "../llm/config";`. Quitar `DEFAULT_OLLAMA_MODEL` del import de providers y el `import type { UserSettingsRow }` (~:3), que quedan sin uso (lint los rechaza). `fallbackConfig` pasa a ser `ProviderConfig | null`. Hasta la Task 2.3, en los tres bloques `catch { ... callLLM(fallbackConfig, ...) }` agregar al principio: `if (!fallbackConfig) throw err;` (cambiar `catch {` por `catch (err) {`). La Task 2.3 reemplaza esos bloques.

- [ ] **Paso 5: `endSession`.** En `server/routers/sessions.ts`, reemplazar el bloque que arma `llmConfig` a mano (`const provider = settings?.provider ?? "ollama"; const llmConfig = {...}`) por `const llmConfig = buildProviderConfig(settings);`. Ajustar los imports (`DEFAULT_OLLAMA_MODEL` y `LLMProvider` pueden quedar sin uso).

- [ ] **Paso 6: Imágenes.**
  - `server/image/buildImageContext.ts`: reemplazar las líneas de `baseUrl` y `model` por:
    ```ts
    const llmConfig = buildProviderConfig(settings);
    const local = buildLocalConfig(settings);
    ```
    y devolver `{ ..., llmConfig, baseUrl: local.ollamaBaseUrl!, model: local.model }`. El prompt writer usa el proveedor del usuario; `baseUrl`/`model` quedan para la VRAM, que la Task 2.8 simplifica.
  - `server/image/imageOrchestrator.ts`: agregar `llmConfig: ProviderConfig;` a `ImagePipelineContext`, borrar `ctxToLLMConfig` y pasar `ctx.llmConfig` en las dos llamadas a `writeImagePrompt` (líneas ~171 y ~340).
  - `server/routers/images.ts`: en `illustrate` y en `regenerate`, pasar `llmConfig: context.llmConfig` en el objeto de `generateSceneImage`. En `generatePortrait`, reemplazar las líneas de `ollamaBaseUrl`/`ollamaModel` por `const local = buildLocalConfig(settings);` y usar `local.ollamaBaseUrl!` y `local.model`. Quitar `DEFAULT_OLLAMA_MODEL` del import si queda sin uso.

- [ ] **Paso 7:** `npm test && npm run typecheck && npm run lint` y commit:
```bash
git add server/llm/config.ts tests/server/llm/config.test.ts server/pipeline/orchestrator.ts server/routers/sessions.ts server/image/buildImageContext.ts server/image/imageOrchestrator.ts server/routers/images.ts
git commit -m "refactor(llm): one provider-config module; no local fallback for cloud users; image prompts use the user's provider"
```

---

### Task 2.2: `callLLM` cancelable

**Problema:** `callLLM` y los proveedores no aceptan `AbortSignal` (`providers.ts:583-642`, `:177`, `:314`, `:435`). Si el cliente se va, la generación sigue hasta el final. Los timeouts son el único abort.

**Files:** Modify `server/llm/providers.ts`. Create `tests/server/llm/providers.test.ts`.

- [ ] **Paso 1: Tests que fallan.** `tests/server/llm/providers.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { callLLM, LLMAbortedError } from "@/server/llm/providers";

const ollama = { provider: "ollama" as const, model: "m", ollamaBaseUrl: "http://x" };

/** fetch that never answers until its signal aborts (rejects at once if already aborted, like real fetch). */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("callLLM cancellation", () => {
  it("rejects with LLMAbortedError and does not retry when the caller aborts", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    const p = callLLM(ollama, [{ role: "user", content: "hi" }], async () => {}, {}, { priority: "streaming", retries: 2, retryDelayMs: 0, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(LLMAbortedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast when the signal is already aborted", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    ac.abort();
    await expect(callLLM(ollama, [], async () => {}, {}, { signal: ac.signal })).rejects.toBeInstanceOf(LLMAbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still retries ordinary failures", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callLLM(ollama, [], async () => {}, {}, { priority: "background", retries: 1, retryDelayMs: 0 })).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```
→ FAIL (`LLMAbortedError` no existe).

- [ ] **Paso 2: Implementar en `server/llm/providers.ts`.**
  1. Debajo de `LLMProvider` (línea ~24):
  ```ts
  /** The caller's AbortSignal fired (e.g. the client disconnected). Never retried. */
  export class LLMAbortedError extends Error {
    readonly errorType = "aborted";
    constructor() {
      super("LLM request aborted by caller");
      this.name = "LLMAbortedError";
    }
  }

  /** Abort `controller` when `signal` fires; returns the unlink function. */
  function linkSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!signal) return () => {};
    if (signal.aborted) controller.abort();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }
  ```
  2. `callOllama`: agregar el parámetro final `signal?: AbortSignal`. Después de crear `controller`/`timeoutId`: `const unlink = linkSignal(signal, controller);` y enseguida `if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");` (el abort pudo llegar mientras se esperaba el semáforo). En el `finally`: `unlink();`.
  3. `callOpenAI(apiKey, model, messages, onChunk, options, signal?: AbortSignal)` y `callAnthropic(apiKey, model, messages, systemPrompt, onChunk, options, signal?: AbortSignal)`: mismo cambio.
  4. `callLLM`: el tipo de `opts` suma `signal?: AbortSignal`. Leer `const signal = opts?.signal;`. Al principio de cada intento del `for`: `if (signal?.aborted) throw new LLMAbortedError();`. Pasar `signal` a los tres proveedores. En el `catch (err)`, como primera línea: `if (signal?.aborted) throw new LLMAbortedError();`.
  5. `classifyError`: agregar al principio del bloque `if (error instanceof Error)`: `if (error instanceof LLMAbortedError) return { errorType: "aborted", errorMessage: error.message };`.

- [ ] **Paso 3:** `npx vitest run tests/server/llm/providers.test.ts` → PASS (3). La suite completa debe seguir en verde. Commit:
```bash
git add server/llm/providers.ts tests/server/llm/providers.test.ts
git commit -m "feat(llm): AbortSignal support in callLLM and providers; LLMAbortedError is never retried"
```

---

### Task 2.3: `narrate()`: reintentos sin texto duplicado

**Problema:** un reintento o el fallback después de un stream parcial vuelve a streamear sobre el mismo sink (`callLLM` reintenta con el mismo `onChunk`), y el cliente acumula los dos intentos. El bloque "primary → catch → fallback" está copiado 3 veces (`orchestrator.ts` en el path trivial, el narrador y el snippet). Además, un abort cae en el `catch` y dispara el fallback.

**Files:** Create `server/pipeline/narrate.ts`, `tests/pipeline/narrate.test.ts`. Modify `server/pipeline/orchestrator.ts`, `app/api/chat/stream/route.ts`, `hooks/use-chat.ts` (solo el evento `reset`; la reescritura completa es la Task 2.6).

- [ ] **Paso 1: Tests que fallan.** `tests/pipeline/narrate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { narrate } from "@/server/pipeline/narrate";
import { LLMAbortedError, type ProviderConfig } from "@/server/llm/providers";

const primary: ProviderConfig = { provider: "ollama", model: "big" };
const fallback: ProviderConfig = { provider: "ollama", model: "small" };
import type { callLLM } from "@/server/llm/providers";

/** Scripted fake callLLM: each entry streams its chunks, then returns or throws. */
function script(steps: { chunks: string[]; fail?: Error }[]) {
  const configs: string[] = [];
  const call = vi.fn<typeof callLLM>(async (config, _messages, onChunk) => {
    configs.push(config.model);
    const step = steps.shift()!;
    for (const c of step.chunks) await onChunk(c);
    if (step.fail) throw step.fail;
    return step.chunks.join("");
  });
  return { call, configs };
}

const base = { messages: [{ role: "user", content: "x" }], options: {}, retryDelayMs: 0 };

describe("narrate", () => {
  it("resets the client before re-streaming after a partial attempt", async () => {
    const { call } = script([{ chunks: ["Hel"], fail: new Error("socket hang up") }, { chunks: ["Hello there."] }]);
    const events: string[] = [];
    const text = await narrate({ ...base, primary, fallback, onToken: (t) => events.push(t), onReset: () => events.push("<reset>") }, call);
    expect(text).toBe("Hello there.");
    expect(events).toEqual(["Hel", "<reset>", "Hello there."]);
  });

  it("does not reset when the failed attempt sent nothing", async () => {
    const { call } = script([{ chunks: [], fail: new Error("ECONNREFUSED") }, { chunks: ["Hi."] }]);
    const onReset = vi.fn();
    await narrate({ ...base, primary, fallback, onToken: () => {}, onReset }, call);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("skips the primary's retries on a non-transient error and goes to the fallback", async () => {
    const authErr = Object.assign(new Error("bad key"), { errorType: "auth_failed" });
    const { call, configs } = script([{ chunks: [], fail: authErr }, { chunks: ["ok"] }]);
    await narrate({ ...base, primary, fallback, retries: 2 }, call);
    expect(configs).toEqual(["big", "small"]);
  });

  it("rethrows an abort without trying the fallback", async () => {
    const { call, configs } = script([{ chunks: ["a"], fail: new LLMAbortedError() }, { chunks: ["never"] }]);
    await expect(narrate({ ...base, primary, fallback }, call)).rejects.toBeInstanceOf(LLMAbortedError);
    expect(configs).toEqual(["big"]);
  });

  it("throws the last error when there is no fallback and retries run out", async () => {
    const { call, configs } = script([{ chunks: [], fail: new Error("e1") }, { chunks: [], fail: new Error("e2") }]);
    await expect(narrate({ ...base, primary, fallback: null, retries: 1 }, call)).rejects.toThrow("e2");
    expect(configs).toEqual(["big", "big"]);
  });

  it("stops forwarding at a mechanic marker (streamBeforeMarker per attempt)", async () => {
    const { call } = script([{ chunks: ["You swing. ", "[MECHANIC:damage:1d6] more"] }]);
    const seen: string[] = [];
    await narrate({ ...base, primary, fallback: null, onToken: (t) => seen.push(t) }, call);
    expect(seen.join("")).toBe("You swing. ");
  });
});
```
→ FAIL.

- [ ] **Paso 2: Implementar `server/pipeline/narrate.ts`.**

```ts
import { callLLM, LLMAbortedError, type LLMMessage, type LLMOptions, type ProviderConfig } from "../llm/providers";
import { streamBeforeMarker } from "./utils";

const NON_TRANSIENT = new Set(["auth_failed", "model_not_found", "context_too_long"]);

export interface NarrateArgs {
  primary: ProviderConfig;
  /** Tried once after the primary's attempts; null = no fallback (cloud users). */
  fallback: ProviderConfig | null;
  messages: LLMMessage[];
  options: LLMOptions;
  /** Streamed text up to the first control marker. Omit for a silent call. */
  onToken?: (token: string) => void;
  /** Called before a new attempt when the failed one already streamed text. */
  onReset?: () => void;
  signal?: AbortSignal;
  /** Extra attempts on the primary (default 1). */
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Streaming narrator call with retry-then-fallback. Every attempt gets a fresh
 * marker-aware sink and is made with callLLM retries disabled, so a failed
 * attempt's partial text is never mixed into the next one; the client is told
 * to discard it via onReset. Aborts propagate immediately.
 */
export async function narrate(a: NarrateArgs, call: typeof callLLM = callLLM): Promise<string> {
  const attempts: ProviderConfig[] = [
    ...Array.from({ length: (a.retries ?? 1) + 1 }, () => a.primary),
    ...(a.fallback ? [a.fallback] : []),
  ];
  let lastErr: unknown;
  let streamed = false;
  let skipPrimary = false;

  for (let i = 0; i < attempts.length; i++) {
    const config = attempts[i];
    const isPrimary = i <= (a.retries ?? 1);
    if (isPrimary && skipPrimary) continue;
    if (i > 0 && isPrimary) await new Promise((r) => setTimeout(r, a.retryDelayMs ?? 1500));
    if (streamed) {
      a.onReset?.();
      streamed = false;
    }
    const onToken = a.onToken;
    const sink = onToken
      ? streamBeforeMarker((t) => { streamed = true; onToken(t); })
      : async () => {};
    try {
      return await call(config, a.messages, sink, a.options, { priority: "streaming", retries: 0, signal: a.signal });
    } catch (err) {
      if (err instanceof LLMAbortedError) throw err;
      lastErr = err;
      const type = (err as { errorType?: string }).errorType;
      if (isPrimary && type && NON_TRANSIENT.has(type)) skipPrimary = true;
    }
  }
  throw lastErr;
}
```
Verificar que `LLMMessage` está exportado desde providers (sí, `providers.ts:5`).

- [ ] **Paso 3:** `npx vitest run tests/pipeline/narrate.test.ts` → PASS (6).

- [ ] **Paso 4: Conectarlo en el orchestrator.**
  - Parámetros de `runPipeline`: agregar `onReset?: () => void;` y `signal?: AbortSignal;`, y desestructurarlos.
  - **Path trivial**: borrar `let fullResponse = "";` (~:167) y el bloque `try { fullResponse = await callLLM(llmConfig, ...) } catch { ... fallback ... }`, y reemplazarlos por:
    ```ts
    let fullResponse = await narrate({
      primary: llmConfig, fallback: fallbackConfig,
      messages: [{ role: "system", content: trivialPrompt }, { role: "user", content: message }],
      options: NARRATOR_OPTIONS, onToken, onReset, signal,
    });
    ```
    Mantener la línea `fullResponse = cleanGibberish(fullResponse);` que sigue.
  - **Narrador del path standard**: igual, con `narratorPrompt` y `narratorOptions`, asignando a `narratorDraft`.
  - **Short-draft retry**: dejar el `callLLM` silencioso, pero pasar `signal` en las opts (`{ priority: "streaming", retries: 0, signal }`) y cambiar el `catch {` por `catch (err) { if (err instanceof LLMAbortedError) throw err; /* keep the short draft rather than fail the turn */ }`.
  - **Snippet**: `snippetResponse = await narrate({ primary: llmConfig, fallback: fallbackConfig, messages: [{ role: "user", content: snippetPrompt }], options: SNIPPET_OPTIONS, signal });` (sin `onToken`: es silencioso).
  - Imports: `narrate` desde `./narrate` y `LLMAbortedError` desde `../llm/providers`. Quitar `streamBeforeMarker` del import de `./utils` si queda sin uso.
  - **Cambio de comportamiento a documentar en el commit:** el fallback ahora se intenta una vez (antes eran 2 por el `retries` default de `callLLM`), así que el peor caso es más corto.

- [ ] **Paso 5: Evento `reset` por SSE.** En `app/api/chat/stream/route.ts`, extraer un helper dentro de `start(controller)`:
  ```ts
  const send = (event: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // Stream already closed by the client
    }
  };
  ```
  Reescribir `onToken`, `onComplete` y `onError` con `send` (manteniendo los `controller.close()` en try/catch) y agregar `onReset: () => send({ type: "reset" })`.
  En `hooks/use-chat.ts`, en los dos lugares donde se procesa un evento, agregar: `else if (event.type === "reset") { setStreamingText(""); }`. La Task 2.6 unifica esos dos lugares.

- [ ] **Paso 6:** `npm test && npm run typecheck && npm run lint` y commit:
```bash
git add server/pipeline/narrate.ts tests/pipeline/narrate.test.ts server/pipeline/orchestrator.ts app/api/chat/stream/route.ts hooks/use-chat.ts
git commit -m "fix(pipeline): narrate() retries with a fresh sink per attempt and a client reset; aborts skip the fallback"
```

---

### Task 2.4: Cancelación de punta a punta y mensaje huérfano

**Problema:** si el cliente cierra la pestaña, el turno sigue entero (LLM más writes). Si el turno falla después del insert del mensaje de usuario (`orchestrator.ts:96`), ese mensaje queda en la DB sin respuesta, y el reintento suma otro. El input del cliente se borra al enviar (`chat-input.tsx:48`), así que el jugador pierde lo que escribió.

**Files:** Modify `server/pipeline/orchestrator.ts`, `app/api/chat/stream/route.ts`, `hooks/use-chat.ts`, `components/chat/chat-container.tsx`, `components/chat/chat-input.tsx`. Create `tests/pipeline/runPipeline.test.ts`.

- [ ] **Paso 1: Primer test de integración de `runPipeline` (falla).** `tests/pipeline/runPipeline.test.ts`. Usa la DB en memoria compartida (`@/server/db` con `DB_PATH=:memory:`) y mockea solo `callLLM`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/server/llm/providers", async (orig) => {
  const actual = await orig<typeof import("@/server/llm/providers")>();
  return { ...actual, callLLM: vi.fn() };
});

import { db } from "@/server/db";
import { messages, sessions } from "@/server/db/schema";
import { callLLM, LLMAbortedError } from "@/server/llm/providers";
import { runPipeline } from "@/server/pipeline/orchestrator";
import { waitForBackground, turnStateKey, sessionAuxKey } from "@/server/pipeline/backgroundQueue";
import { seedSession, seedCharacter } from "../helpers/testDb";

const ACTION = "I search the abandoned warehouse for clues about the missing shipment.";
const mockLLM = vi.mocked(callLLM);

function run(sessionId: string, signal?: AbortSignal) {
  const out = { tokens: [] as string[], resets: 0, done: null as string | null, error: null as string | null, restore: undefined as string | undefined };
  const p = runPipeline({
    sessionId, message: ACTION, signal,
    onToken: (t) => out.tokens.push(t),
    onReset: () => { out.resets++; },
    onComplete: (t) => { out.done = t; },
    onError: (e, details) => { out.error = e; out.restore = details?.restoreInput; },
  });
  return { p, out };
}

async function settle(sessionId: string) {
  await waitForBackground(turnStateKey(sessionId));
  await waitForBackground(sessionAuxKey(sessionId));
}

beforeEach(() => mockLLM.mockReset());

describe("runPipeline", () => {
  it("narrates, commits the turn and releases the lock", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      if (opts?.priority === "streaming") { await onChunk("The warehouse is dark and cold. Crates loom in rows."); return "The warehouse is dark and cold. Crates loom in rows."; }
      return "{}";
    });
    const { p, out } = run(session.id);
    await p;
    await settle(session.id);
    expect(out.error).toBeNull();
    expect(out.done).toContain("warehouse");
    const rows = db.select().from(messages).where(eq(messages.sessionId, session.id)).all();
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.processingStartedAt).toBeNull();
  });

  it("removes the user message and asks the client to restore it when the turn fails", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    mockLLM.mockRejectedValue(new Error("ECONNREFUSED"));
    const { p, out } = run(session.id);
    await p;
    expect(out.error).toBeTruthy();
    expect(out.restore).toBe(ACTION);
    expect(db.select().from(messages).where(eq(messages.sessionId, session.id)).all()).toHaveLength(0);
  });

  it("stops quietly and leaves nothing behind when the client aborts mid-stream", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    const ac = new AbortController();
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      await onChunk("The ware");
      ac.abort();
      if (opts?.signal?.aborted) throw new LLMAbortedError();
      return "unreachable";
    });
    const { p, out } = run(session.id, ac.signal);
    await p;
    expect(out.done).toBeNull();
    expect(out.error).toBeNull();
    expect(db.select().from(messages).where(eq(messages.sessionId, session.id)).all()).toHaveLength(0);
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.processingStartedAt).toBeNull();
  });

  it("tells the client to reset when a retry follows a partial stream", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    let streamingCalls = 0;
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      if (opts?.priority !== "streaming") return "{}";
      streamingCalls++;
      if (streamingCalls === 1) { await onChunk("Half a sent"); throw new Error("socket hang up"); }
      await onChunk("A full, fresh narration of the warehouse search.");
      return "A full, fresh narration of the warehouse search.";
    });
    const { p, out } = run(session.id);
    await p;
    await settle(session.id);
    expect(out.resets).toBe(1);
    expect(out.done).toContain("fresh narration");
  });
});
```
Notas para el implementador:
- Si `classifyInput(ACTION)` no da `"standard"`, cambiar `ACTION` por otra acción que sí lo dé (ver `server/pipeline/classifier.ts`).
- Si el path standard hace más llamadas `streaming` de las previstas (short-draft retry si el borrador tiene menos de 12 palabras, o snippet si hay markers), ajustar los textos mock para que tengan 12 palabras o más y no tengan markers.
- El test del reset llega en verde desde la Task 2.3. Los otros dos deben fallar antes del Paso 2.

→ Correr y confirmar que fallan los tests "removes the user message" y "stops quietly". `onError` todavía no recibe `details`, así que también hay error de tipos.

- [ ] **Paso 2: Servidor.**
  - Firma: `onError: (error: string, details?: { restoreInput?: string }) => void;`.
  - El insert del mensaje de usuario pasa a devolver el id:
    ```ts
    const userMessageId = db.insert(messages).values({ sessionId, role: "user", content: message, metadata })
      .returning({ id: messages.id }).get().id;
    ```
  - Declarar `let turnCommitted = false;` antes del `try` y ponerlo en `true` justo después de cada `commitTurn(...)` (en el path trivial y en el standard). Declarar `let userMessageId: string | undefined;` fuera del `try` para poder usarlo en el `catch`.
  - Antes de cada `commitTurn` (trivial y standard): `if (signal?.aborted) throw new LLMAbortedError();`. Así un abort que llega después del último token tampoco persiste nada.
  - Reemplazar el `catch` final:
    ```ts
    } catch (error: unknown) {
      // Nothing of a failed or abandoned turn may stay behind: the next attempt would see a dangling player message.
      if (!turnCommitted && userMessageId) {
        try {
          db.delete(messages).where(eq(messages.id, userMessageId)).run();
        } catch (err) {
          console.error("[pipeline] orphan cleanup failed", err);
        }
      }
      if (error instanceof LLMAbortedError || signal?.aborted) return; // client is gone
      const { errorMessage } = classifyError(error, llmConfigForErrors);
      onError(errorMessage, { restoreInput: turnCommitted ? undefined : message });
    } finally {
    ```
    `classifyError(error, provider)` necesita el provider como string. Usar `"unknown"` si `llmConfig` todavía no existía (se arma dentro del `try`): declarar `let providerName = "unknown";` fuera del `try` y asignarlo cuando se arma `llmConfig`. Importar `classifyError`.
  - Si `onError` se llama porque el lock no se pudo tomar, no hay mensaje que restaurar: pasar `{ restoreInput: message }` también ahí, así el texto vuelve al input.

- [ ] **Paso 3: Ruta.** En `app/api/chat/stream/route.ts`:
  ```ts
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  ```
  antes de crear el stream; pasar `signal: abort.signal` a `runPipeline`; agregar al `ReadableStream` un `cancel() { abort.abort(); }`. Envolver el `await runPipeline(...)` de `start()` con un `finally { try { controller.close(); } catch { /* already closed */ } }`, porque en un abort `runPipeline` vuelve sin llamar a `onComplete` ni a `onError`. `onError: (error, details) => { send({ type: "error", message: error, restoreInput: details?.restoreInput }); close(); }`.

- [ ] **Paso 4: Cliente.**
  - `hooks/use-chat.ts`:
    - Un `useRef<AbortController | null>` y una función `stop()` que hace `abortRef.current?.abort()`.
    - `useEffect(() => () => abortRef.current?.abort(), [])` para abortar al desmontar.
    - `fetch(..., { signal: controller.signal })`. Si salta un `AbortError` (`e instanceof DOMException && e.name === "AbortError"`), no se muestra error.
    - `sendMessage` pasa a devolver `Promise<{ ok: boolean; restoreInput?: string }>`; el `restoreInput` sale del evento `error`.
    - Exportar `stop` desde el hook.
  - `components/chat/chat-input.tsx`:
    - Props nuevas: `restore?: { text: string; nonce: number }` y `onStop?: () => void`.
    - `useEffect(() => { if (restore) setValue(restore.text); }, [restore?.nonce])`; el eslint de hooks exige depender de `restore`, así que usar `[restore]` y comparar el nonce con un ref si hace falta.
    - Cuando `disabled && onStop`, mostrar al lado del hint "The narrator is writing…" un botón `Stop` (texto chico, mismo estilo que "dismiss" del banner de error).
  - `components/chat/chat-container.tsx`:
    - Agregar `const [restore, setRestore] = useState<{ text: string; nonce: number }>();`.
    - En `handleSend`, guardar `text` y el `pendingDice` original antes de limpiarlo. Después de `const res = await sendMessage(...)`: `if (!res.ok && res.restoreInput !== undefined) { setRestore({ text, nonce: Date.now() }); if (dice) setPendingDice(dice); }`. Se restaura el texto tipeado, sin el sufijo del dado.
    - Pasar `restore={restore}` y `onStop={stop}` a `ChatInput`.
    - El auto-opener ignora el resultado (no se restaura un prompt de sistema). Las quick actions pasan por `handleSend`, así que un fallo deja su prompt en el input; es aceptable (el jugador puede reenviarlo o borrarlo).

- [ ] **Paso 5:** `npx vitest run tests/pipeline/runPipeline.test.ts` → PASS (4). Después `npm test && npm run typecheck && npm run lint` y commit:
```bash
git add -A server/pipeline/orchestrator.ts app/api/chat/stream/route.ts hooks/use-chat.ts components/chat/chat-container.tsx components/chat/chat-input.tsx tests/pipeline/runPipeline.test.ts
git commit -m "fix(chat): client disconnect aborts the turn; failed turns leave no orphan message and restore the player's draft"
```

---

### Task 2.5: Cadencias por turno

**Problema:** el reconcile corre cuando `msgCount % 15 === 0` y el journal cuando `msgCount % 16 === 0`. Cuentan mensajes, y los mensajes de error o huérfanos históricos rompen la paridad para siempre. El turno (`storyState.turn`) es el reloj correcto. Además, `mergeStoryState` (`director.ts:359-370`) arma un objeto nuevo campo por campo, así que cualquier campo nuevo en `SessionStoryState` se perdería.

**Files:** Modify `types/index.ts`, `server/pipeline/director.ts`, `server/pipeline/utils.ts`, `server/pipeline/orchestrator.ts`. Tests: `tests/pipeline/turnUtils.test.ts`, `tests/pipeline/director.test.ts`.

- [ ] **Paso 1: Tests que fallan.**
  - En `tests/pipeline/turnUtils.test.ts`:
  ```ts
  import { isDue } from "@/server/pipeline/utils"; // sumar al import existente

  describe("isDue", () => {
    it("fires every N turns counting from the last run", () => {
      expect(isDue(7, undefined, 8)).toBe(false);
      expect(isDue(8, undefined, 8)).toBe(true);
      expect(isDue(15, 8, 8)).toBe(false);
      expect(isDue(16, 8, 8)).toBe(true);
    });
  });
  ```
  - En `tests/pipeline/director.test.ts`, un test de que `mergeStoryState({ ...coldStartState(), lastReconcileTurn: 8, lastJournalTurn: 16 }, { threadUpdates: [], newThreads: [], tensionRead: 3 }, 17)` conserva ambos campos.
  → FAIL.

- [ ] **Paso 2: Implementar.**
  - `types/index.ts`, en `SessionStoryState`:
    ```ts
      /** Turn of the last campaign-thread reconcile (cadence bookkeeping). */
      lastReconcileTurn?: number;
      /** Turn of the last mid-session campaign-journal rewrite. */
      lastJournalTurn?: number;
    ```
  - `server/pipeline/director.ts`, en el `return` de `mergeStoryState` (~:359): agregar `lastReconcileTurn: prev.lastReconcileTurn, lastJournalTurn: prev.lastJournalTurn,`.
  - `server/pipeline/utils.ts`:
    ```ts
    /** True when at least `every` turns passed since `lastTurn` (never run = turn 0). */
    export function isDue(turn: number, lastTurn: number | undefined, every: number): boolean {
      return turn - (lastTurn ?? 0) >= every;
    }
    ```
  - `server/pipeline/orchestrator.ts`:
    - Constantes al principio: `const RECONCILE_EVERY_TURNS = 8;` y `const JOURNAL_EVERY_TURNS = 8;`, con un comentario: "~15/16 messages at two per turn; sessions from before these fields existed run both once on their next turn, which is harmless".
    - Reconcile en step 3: borrar la consulta `count(*)` y cambiar `if (msgCount % 15 === 0)` por `if (isDue(nextTurn, merged.lastReconcileTurn, RECONCILE_EVERY_TURNS))`. Dentro, después de calcular: `merged.lastReconcileTurn = nextTurn;`. El `try/catch` sigue envolviendo el cálculo.
    - Journal: borrar el `enqueueBackground(sessionAuxKey(sessionId), () => updateCampaignJournal(...))` que hoy se encola junto al summary. Dentro del job de step 3, antes de `commitTurnState`:
      ```ts
      const journalDue = isDue(nextTurn, merged.lastJournalTurn, JOURNAL_EVERY_TURNS);
      if (journalDue) merged.lastJournalTurn = nextTurn;
      ```
      y después de `commitTurnState(...)`:
      ```ts
      // Queued behind this turn's summary, so the journal reads the fresh contextSummary.
      if (journalDue) enqueueBackground(sessionAuxKey(sessionId), () => updateCampaignJournal(session.campaignId, sessionId, llmConfig));
      ```
    - En `updateCampaignJournal`, borrar la consulta del conteo y el `if (msgCount % 16 !== 0) return;`. La cadencia ahora la decide el caller; `endSession` pasa `latestEvents` y no cambia.
  - El summary sigue con `nextSummaryWindow`, que cuenta mensajes: está bien, porque ya no quedan huérfanos.

- [ ] **Paso 3:** tests en verde, typecheck y lint. Commit:
```bash
git add types/index.ts server/pipeline/director.ts server/pipeline/utils.ts server/pipeline/orchestrator.ts tests/pipeline/turnUtils.test.ts tests/pipeline/director.test.ts
git commit -m "fix(pipeline): reconcile and journal cadences count turns, not messages"
```

---

### Task 2.6: Errores visibles y cliente SSE robusto

**Problema:** quedan `catch {}` vacíos en `orchestrator.ts` (journal ~657, summary ~710, título ~743, `maybeGenerateTitle(...).catch(() => {})` ~485), `routers/images.ts:57,106,138`, `imageOrchestrator.ts:480` y `use-chat.ts`. En el cliente: los handlers de evento están duplicados (`use-chat.ts:43-55` y `:64-78`); si el stream se cierra sin `done`, no se avisa nada; ante un error no se invalidan los mensajes; y el cuerpo de una respuesta no-OK se descarta.

**Files:** Modify `server/pipeline/orchestrator.ts`, `server/routers/images.ts`, `server/image/imageOrchestrator.ts`, `hooks/use-chat.ts`.

- [ ] **Paso 1: Servidor.** Reemplazar cada catch vacío por un log con tag, siguiendo el patrón existente (`console.error("[memories]", err)`):
  - `orchestrator.ts`: `} catch (err) { console.error("[journal]", err); }`, `[summary]` y `[title]`. Además, `maybeGenerateTitle(...).catch((err) => console.error("[title]", err));`.
  - `routers/images.ts:57` y `:138`: `.catch((err) => console.error("[ImageGen] job crashed", err));`. En `:106` (rollback): `.catch((err) => console.error("[ImageGen] regenerate rollback failed", err));`.
  - `imageOrchestrator.ts:480`: `.catch((err) => console.warn("[ImageGen] auto-reference failed", err));`. El `catch {}` de `appendFile(error.log)` (~496) queda como está, con el comentario `// logging the log failure would loop`.
  - Verificar con `grep -rn "catch {}\|catch(() => {})" server app hooks components`: solo debe quedar el de `error.log`.

- [ ] **Paso 2: Cliente.** Reescribir `hooks/use-chat.ts` manteniendo la API (`sendMessage`, `stop`, `streamingText`, `isSending`, `error`, `clearError`) y el resultado de la Task 2.4:
  - **Un solo evento:** una función `handleEvent(event, sessionId): "done" | "error" | null` dentro de `sendMessage`. Maneja `token`, `reset`, `done` (invalida `messages.listBySession` y `characters.listByCampaign`) y `error` (setea el error, guarda `restoreInput`, invalida `sessions.get` **y** `messages.listBySession`).
  - **Parseo:** se parten los frames por `\n\n` y cada línea `data:` se acepta con o sin espacio (`line.replace(/^data: ?/, "")`). Al final se procesa el buffer restante con la misma función.
  - **Respuesta no-OK:** `const body = await response.json().catch(() => null); throw new Error(body?.error ?? \`Request failed (${response.status})\`);`.
  - **Cierre sin `done` ni `error`:** `setError("The connection closed before the narrator finished.")`, invalidar los mensajes y devolver `{ ok: false }`. Si fue un abort del usuario (`stop`), no mostrar error.
  - **Parseo malformado:** el `catch` de JSON se queda con un comentario (`// ignore malformed SSE line`), sin log, para no spamear la consola.

- [ ] **Paso 3:** `npm test && npm run typecheck && npm run lint`. Commit:
```bash
git add server/pipeline/orchestrator.ts server/routers/images.ts server/image/imageOrchestrator.ts hooks/use-chat.ts
git commit -m "fix: log background failures; one SSE event handler with reset, early-close and error-body handling"
```

---

### Task 2.7: GPU gate y lease de VRAM

**Problema:** el lock de VRAM (`vramManager.ts`) es una variable de módulo que vence a los 60 s mientras ComfyUI tiene 120 s. `releaseToOllama` libera sin chequear quién tiene el lock. Ollama (chat y extractores) recarga el modelo a mitad de una generación. Y el modelo que se descarga es `settings.selectedModel`, que puede no ser el que está cargado.

**Files:** Create `server/llm/gpuGate.ts`, `tests/server/llm/gpuGate.test.ts`. Rewrite `server/image/vramManager.ts`, `tests/server/image/vramManager.test.ts`. Modify `server/llm/providers.ts` (`callOllama`), `server/image/imageOrchestrator.ts`, `server/image/portraitGenerator.ts`, `server/routers/images.ts`, `server/image/buildImageContext.ts`.

- [ ] **Paso 1: Tests del gate (fallan).** `tests/server/llm/gpuGate.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { tryHoldGpu, releaseGpu, isGpuHeld, waitForGpu, GPU_HOLD_STALE_MS, _resetGpuGateForTests } from "@/server/llm/gpuGate";

beforeEach(() => _resetGpuGateForTests());
afterEach(() => vi.useRealTimers());

describe("gpuGate", () => {
  it("is exclusive until the holder releases", () => {
    const t = tryHoldGpu(1_000)!;
    expect(t).toBeTruthy();
    expect(tryHoldGpu(1_001)).toBeNull();
    expect(releaseGpu(t)).toBe(true);
    expect(tryHoldGpu(1_002)).toBeTruthy();
  });

  it("ignores a release by a token that doesn't hold it", () => {
    const t = tryHoldGpu(1_000)!;
    expect(releaseGpu("someone-else")).toBe(false);
    expect(isGpuHeld(1_001)).toBe(true);
    releaseGpu(t);
  });

  it("expires a stale hold", () => {
    tryHoldGpu(1_000);
    expect(isGpuHeld(1_000 + GPU_HOLD_STALE_MS + 1)).toBe(false);
    expect(tryHoldGpu(1_000 + GPU_HOLD_STALE_MS + 1)).toBeTruthy();
  });

  it("wakes waiters on release", async () => {
    const t = tryHoldGpu()!;
    let woke = false;
    const w = waitForGpu(10_000).then(() => { woke = true; });
    await Promise.resolve();
    expect(woke).toBe(false);
    releaseGpu(t);
    await w;
    expect(woke).toBe(true);
  });

  it("gives up waiting after the timeout", async () => {
    vi.useFakeTimers();
    tryHoldGpu();
    const w = waitForGpu(5_000);
    vi.advanceTimersByTime(5_001);
    await expect(w).resolves.toBeUndefined();
  });
});
```

- [ ] **Paso 2: Implementar `server/llm/gpuGate.ts`.**

```ts
/**
 * Exclusive GPU hold for image generation. Ollama calls wait while it is held,
 * so a chat turn can't reload the model onto the GPU mid-render. The holder
 * gets a token; only that token releases it. A hold older than
 * GPU_HOLD_STALE_MS is presumed abandoned (crashed job). Kept on globalThis so
 * Next dev HMR doesn't fork the state.
 */
export const GPU_HOLD_STALE_MS = 300_000;

interface GateState {
  holder: { token: string; since: number } | null;
  waiters: Set<() => void>;
}
const g = globalThis as typeof globalThis & { __rpgGpuGate?: GateState };
const state = (g.__rpgGpuGate ??= { holder: null, waiters: new Set() });

function expireStale(now: number): void {
  if (state.holder && now - state.holder.since > GPU_HOLD_STALE_MS) {
    console.warn("[gpu] stale hold expired");
    state.holder = null;
    wake();
  }
}

function wake(): void {
  for (const w of state.waiters) w();
  state.waiters.clear();
}

export function tryHoldGpu(now = Date.now()): string | null {
  expireStale(now);
  if (state.holder) return null;
  const token = crypto.randomUUID();
  state.holder = { token, since: now };
  return token;
}

export function releaseGpu(token: string): boolean {
  if (state.holder?.token !== token) return false;
  state.holder = null;
  wake();
  return true;
}

export function isGpuHeld(now = Date.now()): boolean {
  expireStale(now);
  return state.holder !== null;
}

/** Resolves when the GPU is free, after `timeoutMs`, or when `signal` aborts — whichever comes first. */
export function waitForGpu(timeoutMs = GPU_HOLD_STALE_MS, signal?: AbortSignal): Promise<void> {
  if (!isGpuHeld() || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      state.waiters.delete(done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    state.waiters.add(done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function _resetGpuGateForTests(): void {
  state.holder = null;
  state.waiters.clear();
}
```

- [ ] **Paso 3:** `npx vitest run tests/server/llm/gpuGate.test.ts` → PASS (5).

- [ ] **Paso 4: Reescribir `server/image/vramManager.ts`.**

```ts
import { exec } from "child_process";
import { promisify } from "util";
import { tryHoldGpu, releaseGpu, isGpuHeld } from "../llm/gpuGate";

const execAsync = promisify(exec);

export interface VramLease {
  release(): Promise<void>;
}

interface AcquireOptions {
  skipVramCheck?: boolean;
}

/**
 * Take the GPU for an image generation: hold the gate (so Ollama calls wait),
 * unload whatever models Ollama has loaded, and wait for VRAM to free up.
 * Returns null if another generation holds it or VRAM never frees.
 */
export async function acquireForImageGen(ollamaBaseUrl: string, options?: AcquireOptions): Promise<VramLease | null> {
  const token = tryHoldGpu();
  if (!token) return null;
  const lease: VramLease = { release: async () => { releaseGpu(token); } };
  try {
    if (!options?.skipVramCheck && await checkVRAMOnce(10_000)) return lease;
    await unloadOllamaModels(ollamaBaseUrl);
    if (options?.skipVramCheck) return lease;
    if (await waitForVRAM(10_000, 30_000)) return lease;
    await lease.release();
    return null;
  } catch (err) {
    await lease.release();
    throw err;
  }
}

export function isImageGenActive(): boolean {
  return isGpuHeld();
}

/** Unload every model Ollama reports as loaded (not just the user's selected one). */
async function unloadOllamaModels(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const { models } = (await res.json()) as { models?: { name: string }[] };
    await Promise.all((models ?? []).map((m) =>
      fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      }).catch((err) => console.warn("[vram] unload failed for", m.name, err))));
  } catch {
    // Ollama not running — nothing is holding VRAM
  }
}
```
Mantener `checkVRAMOnce` y `waitForVRAM` tal cual. Borrar `releaseToOllama`, `lockHolder`, `lockAcquiredAt`, `STALE_TIMEOUT` y `_resetForTests` (los tests usan `_resetGpuGateForTests`).

- [ ] **Paso 5: Reescribir `tests/server/image/vramManager.test.ts`.** Con `vi.stubGlobal("fetch", ...)` y `{ skipVramCheck: true }`:
  1. `acquireForImageGen` devuelve un lease e `isImageGenActive()` pasa a `true`.
  2. Un segundo acquire devuelve `null`.
  3. `lease.release()` libera.
  4. Llama `GET {base}/api/ps` y hace `POST /api/generate` con `keep_alive: 0` para **cada** modelo listado. El mock de `/api/ps` devuelve `new Response(JSON.stringify({ models: [{ name: "a" }, { name: "b" }] }))`; el de los POST, una promesa resuelta (`mockResolvedValue`), porque el código encadena `.catch`.
  5. Si `/api/ps` falla (fetch rechaza), igual devuelve un lease.
  6. Release después de stale + reacquire por otro: el release del primer lease no libera al segundo. Usar `tryHoldGpu`/`isGpuHeld` con `now`, o `vi.spyOn(Date, "now")`.
  `beforeEach(_resetGpuGateForTests)`.

- [ ] **Paso 6: Call sites.**
  - `imageOrchestrator.ts` en los dos lugares (regenerate ~204/255 y principal ~365/485):
    ```ts
    const lease = await acquireForImageGen(ctx.baseUrl);
    if (!lease) { ...igual que hoy... }
    try { ... } finally { await lease.release(); }
    ```
  - `portraitGenerator.ts` (~99/160): igual. Borrar el arg `ollamaModel` de `generateCharacterPortrait` y su paso en `routers/images.ts`.
  - `ImagePipelineContext.model` queda sin uso: borrarlo, junto con `model` en `buildImageContext` y en los objetos de `routers/images.ts`.

- [ ] **Paso 7: Ollama espera la GPU.** En `server/llm/providers.ts`, `callOllama`, primera línea: `await waitForGpu(undefined, signal);` (importar desde `./gpuGate`). Así un Stop durante el render no deja el turno esperando. Agregar al test del gate un caso: `waitForGpu` con un signal que se aborta resuelve enseguida. Comentario: `// An image render holds the GPU; loading the model now would evict it or OOM.` Los proveedores cloud no esperan.

- [ ] **Paso 8:** `npm test && npm run typecheck && npm run lint`. Commit:
```bash
git add server/llm/gpuGate.ts tests/server/llm/gpuGate.test.ts server/image/vramManager.ts tests/server/image/vramManager.test.ts server/llm/providers.ts server/image/imageOrchestrator.ts server/image/portraitGenerator.ts server/routers/images.ts server/image/buildImageContext.ts
git commit -m "fix(image): token-owned GPU gate; Ollama waits during renders; unload the models actually loaded"
```

---

### Task 2.8: Recuperar jobs de imagen huérfanos

**Problema:** los jobs son promesas en memoria. Si el server reinicia a mitad de una generación, la fila queda en `generating` para siempre: `illustrate` rechaza esa sesión (`images.ts:28-32`) y el cliente hace polling cada 3 s sin fin. El mapa de estado de retratos (`portraitGenerator.ts:24`) es de módulo, así que el HMR lo pierde.

**Files:** Create `server/image/recovery.ts`, `tests/server/image/recovery.test.ts`. Modify `server/routers/images.ts`, `app/api/images/status/[imageId]/route.ts`, `server/image/portraitGenerator.ts`, `server/image/types.ts`.

- [ ] **Paso 1: Test que falla.** `tests/server/image/recovery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedSession } from "../../helpers/testDb";
import { messages, sceneImages } from "@/server/db/schema";
import { failStaleImageJobs, IMAGE_JOB_STALE_MS } from "@/server/image/recovery";

function seedImage(db: ReturnType<typeof createTestDb>, createdAt: number, status: "generating" | "completed" = "generating") {
  const { campaign, session } = seedSession(db);
  const msg = db.insert(messages).values({ sessionId: session.id, role: "assistant", content: "x" }).returning().get();
  return db.insert(sceneImages).values({
    messageId: msg.id, campaignId: campaign.id, sessionId: session.id, triggerType: "player_request",
    sdPrompt: "", sdNegativePrompt: "", width: 1, height: 1, status, createdAt,
  }).returning().get();
}

describe("failStaleImageJobs", () => {
  it("fails jobs started before this process (their worker died with the old one)", () => {
    const db = createTestDb();
    const old = seedImage(db, 1_000);
    const n = failStaleImageJobs(db, { now: 10_000, processStartedAt: 5_000 });
    expect(n).toBe(1);
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, old.id)).get()?.status).toBe("failed");
  });

  it("fails jobs running longer than the stale window", () => {
    const db = createTestDb();
    const hung = seedImage(db, 6_000);
    failStaleImageJobs(db, { now: 6_000 + IMAGE_JOB_STALE_MS + 1, processStartedAt: 5_000 });
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, hung.id)).get()?.status).toBe("failed");
  });

  it("leaves live and finished jobs alone", () => {
    const db = createTestDb();
    const live = seedImage(db, 9_000);
    const done = seedImage(db, 1_000, "completed");
    expect(failStaleImageJobs(db, { now: 10_000, processStartedAt: 5_000 })).toBe(0);
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, live.id)).get()?.status).toBe("generating");
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, done.id)).get()?.status).toBe("completed");
  });
});
```

- [ ] **Paso 2: Implementar `server/image/recovery.ts`.**

```ts
import { and, eq, lt, or } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { sceneImages } from "../db/schema";

/** Longer than prompt writing + VRAM handoff + a 120s ComfyUI render. */
export const IMAGE_JOB_STALE_MS = 10 * 60_000;

const g = globalThis as typeof globalThis & { __rpgProcessStartedAt?: number };
/** When this server process started (survives Next dev HMR). */
export const PROCESS_STARTED_AT = (g.__rpgProcessStartedAt ??= Date.now());

/**
 * Image jobs run as in-process promises, so a row still "generating" from
 * before this process started has no worker left; one older than the stale
 * window is hung. Mark both failed so the session can illustrate again.
 */
export function failStaleImageJobs(
  db: DbOrTx,
  opts: { now?: number; processStartedAt?: number } = {},
): number {
  const now = opts.now ?? Date.now();
  const startedAt = opts.processStartedAt ?? PROCESS_STARTED_AT;
  const rows = db.update(sceneImages)
    .set({ status: "failed" })
    .where(and(
      eq(sceneImages.status, "generating"),
      or(lt(sceneImages.createdAt, startedAt), lt(sceneImages.createdAt, now - IMAGE_JOB_STALE_MS)),
    ))
    .returning({ id: sceneImages.id })
    .all();
  if (rows.length > 0) console.warn(`[ImageGen] marked ${rows.length} orphaned job(s) failed`);
  return rows.length;
}
```

- [ ] **Paso 3:** PASS (3). **Conectar:**
  - `routers/images.ts`: llamar `failStaleImageJobs(db)` al principio de `illustrate` (antes de la consulta de `pending`), de `regenerate` y de `status`.
  - `app/api/images/status/[imageId]/route.ts`: llamarlo antes del select.
  - `server/image/types.ts`: `export type ImageStatus = "generating" | "completed" | "failed" | "replaced";`.
  - `portraitGenerator.ts`: `export const portraitStatus = (gp.__rpgPortraitStatus ??= new Map<string, PortraitStatusEntry>());`, con `gp = globalThis as typeof globalThis & { __rpgPortraitStatus?: Map<string, PortraitStatusEntry> }` y el comentario `// survives Next dev HMR`.

- [ ] **Paso 4:** suite completa, typecheck y lint. Commit:
```bash
git add server/image/recovery.ts tests/server/image/recovery.test.ts server/routers/images.ts "app/api/images/status/[imageId]/route.ts" server/image/types.ts server/image/portraitGenerator.ts
git commit -m "fix(image): fail orphaned/hung generating rows so sessions can illustrate again"
```

---

### Task 2.9: Cliente ComfyUI: WebSocket antes del submit y completitud por `prompt_id`

**Problema:** `generateImage` (`comfyuiClient.ts:396-487`) hace el POST `/prompt` y recién después abre el WS (`:513`), sin `clientId`, así que los eventos tempranos se pierden. La completitud depende de `queue_remaining === 0` global (`:554-556`), que con otro prompt en cola no llega nunca y termina en timeout. Un `close` inesperado del WS cuelga hasta el timeout. El camino de reintento (`:423-445`) duplica el de éxito.

**Files:** Modify `server/image/comfyuiClient.ts`. Create `tests/server/image/comfyuiWait.test.ts`.

- [ ] **Paso 1: Tests que fallan.** `waitForCompletion` se exporta con una firma inyectable. `tests/server/image/comfyuiWait.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { waitForCompletion } from "@/server/image/comfyuiClient";

class FakeWs extends EventEmitter {
  close = vi.fn();
  msg(obj: unknown) { this.emit("message", Buffer.from(JSON.stringify(obj))); }
}
const noHistory = async () => false;

describe("waitForCompletion", () => {
  it("resolves when ComfyUI reports our prompt finished executing (node null)", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "p1" } });
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on execution_success for our prompt", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "execution_success", data: { prompt_id: "p1" } });
    await expect(p).resolves.toBeUndefined();
  });

  it("ignores other prompts' events", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 60, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "other" } });
    await expect(p).rejects.toThrow(/timed out/);
  });

  it("rejects on our execution_error", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "execution_error", data: { prompt_id: "p1", exception_message: "OOM" } });
    await expect(p).rejects.toThrow(/OOM/);
  });

  it("falls back to polling history when the socket drops", async () => {
    const ws = new FakeWs();
    let polls = 0;
    const isDone = async () => ++polls >= 2;
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 5, isDone });
    ws.emit("close");
    await expect(p).resolves.toBeUndefined();
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("reports sampling progress for our prompt", async () => {
    const ws = new FakeWs();
    const onProgress = vi.fn();
    const p = waitForCompletion(ws, "p1", onProgress, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "progress", data: { prompt_id: "p1", value: 5, max: 10 } });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "p1" } });
    await p;
    expect(onProgress).toHaveBeenCalledWith({ percent: 50, phase: "sampling" });
  });
});
```

- [ ] **Paso 2: Implementar en `comfyuiClient.ts`.**
  1. Reemplazar `waitForCompletion` por la versión exportada:
  ```ts
  type ProgressSocket = Pick<EventEmitter, "on"> & { close(): void };

  /**
   * Wait for one prompt to finish. Completion is per prompt: an `executing`
   * event with node null, an `execution_success`, or the SaveImage node ("7")
   * reaching "finished" in progress_state. If the socket drops, poll /history
   * until the prompt has outputs.
   */
  export function waitForCompletion(
    ws: ProgressSocket,
    promptId: string,
    onProgress?: (info: ProgressInfo) => void,
    opts: { timeoutMs?: number; pollMs?: number; isDone?: (promptId: string) => Promise<boolean> } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? GENERATION_TIMEOUT;
    const pollMs = opts.pollMs ?? 2000;
    const isDone = opts.isDone ?? historyHasOutputs;
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(pollTimer);
        try { ws.close(); } catch { /* already closed */ }
        if (err) reject(err);
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error("ComfyUI generation timed out")), timeoutMs);
      const poll = async () => {
        if (settled) return;
        try {
          if (await isDone(promptId)) return finish();
        } catch {
          // ComfyUI briefly unreachable — keep polling until the timeout
        }
        pollTimer = setTimeout(poll, pollMs);
      };

      ws.on("message", (data: Buffer) => {
        let msg: { type?: string; data?: Record<string, unknown> };
        try { msg = JSON.parse(data.toString()); } catch { return; } // binary preview frames
        const d = msg.data ?? {};
        if (d.prompt_id !== promptId) return;
        if (msg.type === "execution_error") return finish(new Error(`ComfyUI execution error: ${String(d.exception_message ?? "unknown error")}`));
        if (msg.type === "execution_success" || (msg.type === "executing" && d.node === null)) return finish();
        if (msg.type === "progress") {
          onProgress?.({ percent: Math.round((Number(d.value) / Number(d.max)) * 100), phase: "sampling" });
        }
        if (msg.type === "progress_state") {
          const nodes = d.nodes as Record<string, { state: string }>;
          for (const [nodeId, node] of Object.entries(nodes ?? {})) {
            if (node.state !== "running") continue;
            if (nodeId === "1") onProgress?.({ percent: 0, phase: "loading" });
            else if (nodeId === "6") onProgress?.({ percent: 95, phase: "decoding" });
            else if (nodeId === "7") onProgress?.({ percent: 98, phase: "saving" });
          }
          if (nodes?.["7"]?.state === "finished") finish();
        }
      });
      let polling = false;
      const startPolling = () => {
        if (polling) return;
        polling = true;
        void poll();
      };
      ws.on("error", startPolling);
      ws.on("close", startPolling);
    });
  }

  async function historyHasOutputs(promptId: string): Promise<boolean> {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (!res.ok) return false;
    const history = await res.json();
    const outputs = history[promptId]?.outputs as Record<string, { images?: unknown[] }> | undefined;
    return !!outputs && Object.values(outputs).some((o) => (o.images?.length ?? 0) > 0);
  }
  ```
  Importar `EventEmitter` (como tipo) desde `"events"`.
  2. Reemplazar el cuerpo de `generateImage` desde el `fetch` del `/prompt` hasta el final por un solo camino:
  ```ts
  const clientId = crypto.randomUUID();
  const ws = await openProgressSocket(clientId);
  try {
    let promptId: string;
    try {
      promptId = await submitPrompt(workflow, clientId);
    } catch (err) {
      // Strip only the optional feature groups ComfyUI rejected, then retry once
      if (!(err instanceof PromptRejectedError) || err.status !== 400) throw err;
      const stripped = stripFailedOptionalNodes(workflow, err.body);
      if (stripped.length === 0) throw err;
      for (const group of stripped) console.warn(`[ComfyUI] Stripping ${group} nodes (rejected by ComfyUI)`);
      promptId = await submitPrompt(workflow, clientId);
    }
    onProgress?.({ percent: 0, phase: "loading" });
    await waitForCompletion(ws, promptId, onProgress);
    const filename = await getOutputFilename(promptId);
    onProgress?.({ percent: 100, phase: "done" });
    return { filePath: await downloadOutput(filename, campaignId, imageId), seed };
  } finally {
    ws.close();
  }
  ```
  con estos helpers privados:
  ```ts
  class PromptRejectedError extends Error {
    constructor(readonly status: number, readonly body: string) {
      super(`ComfyUI prompt submission failed: ${status} — ${body.slice(0, 200)}`);
    }
  }

  /** Open the progress socket BEFORE queueing, so no event for our prompt is missed. */
  function openProgressSocket(clientId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${COMFYUI_WS_URL}?clientId=${clientId}`);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("ComfyUI WebSocket connect timed out")); }, 10_000);
      ws.once("open", () => { clearTimeout(timer); resolve(ws); });
      ws.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async function submitPrompt(workflow: Workflow, clientId: string): Promise<string> {
    const res = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!res.ok) throw new PromptRejectedError(res.status, await res.text().catch(() => ""));
    return (await res.json()).prompt_id;
  }

  async function downloadOutput(filename: string, campaignId: string, imageId: string): Promise<string> {
    const imageResponse = await fetch(`${COMFYUI_URL}/view?filename=${encodeURIComponent(filename)}`);
    if (!imageResponse.ok) throw new Error("Failed to fetch generated image from ComfyUI");
    const buffer = stripPngTextChunks(Buffer.from(await imageResponse.arrayBuffer()));
    const outputDir = join(OUTPUT_BASE, campaignId);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, `${imageId}.png`), buffer);
    return `rpg/${campaignId}/${imageId}.png`;
  }
  ```
  `getOutputFilename` pasa a reintentar: ComfyUI emite `executing {node:null}` / `execution_success` **antes** de escribir la entrada de `/history` (el código viejo esperaba `queue_remaining === 0`, que llega después). Envolver el cuerpo actual en un bucle de hasta 10 intentos con 300 ms de pausa, que reintenta mientras la respuesta no sea OK, no exista `history[promptId]` o no haya imágenes en `outputs`; después del último intento lanzar el error actual. Agregar a `tests/server/image/comfyuiWait.test.ts` un test con `fetch` stubbeado: la primera respuesta de `/history` viene vacía (`{}`) y la segunda trae el filename, y `getOutputFilename` (exportarlo para el test) lo devuelve. Borrar `preloadWorkflow` (no tiene callers; `grep -rn preloadWorkflow` para confirmarlo).

- [ ] **Paso 3:** `npx vitest run tests/server/image/` → PASS (los tests existentes de `buildWorkflow` e `isComfyUIAvailable` más los 6 nuevos). Suite completa, typecheck y lint. Commit:
```bash
git add server/image/comfyuiClient.ts tests/server/image/comfyuiWait.test.ts
git commit -m "fix(comfyui): connect the progress socket before queueing; complete per prompt_id; poll history if the socket drops"
```

---

### Task 2.10: Uploads seguros

**Problema:** `uploadReference` (`routers/images.ts:231-241`) pasa `campaignId` sin validar a `join(REFS_BASE, campaignId, "refs")` (`referenceManager.ts:7-9`), lo que permite path traversal. Tampoco hay límite de tamaño ni chequeo de tipo, y `sanitizeName` está duplicado (`images.ts:16` y `referenceManager.ts:11`). La ruta que sirve imágenes (`app/api/images/rpg/[...path]/route.ts`) ya rechaza `..` y verifica `startsWith`: no se toca.

**Files:** Create `server/image/paths.ts`, `tests/server/image/paths.test.ts`, `tests/server/routers/images.test.ts`. Modify `server/image/referenceManager.ts`, `server/routers/images.ts`.

- [ ] **Paso 1: Tests que fallan.**
  - `tests/server/image/paths.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { sanitizeName, assertSafeSegment, imageKind } from "@/server/image/paths";

  describe("paths", () => {
    it("sanitizes character names to file-safe slugs", () => {
      expect(sanitizeName("Sera Vance!")).toBe("sera_vance_");
    });
    it("rejects path segments that could escape the output dir", () => {
      for (const bad of ["../x", "a/b", "a\\b", "", ".", "..", "x\0y"]) expect(() => assertSafeSegment(bad)).toThrow();
      expect(assertSafeSegment("3f2c9a1e-0000-4000-8000-000000000000")).toBe("3f2c9a1e-0000-4000-8000-000000000000");
    });
    it("recognizes PNG and JPEG by magic bytes only", () => {
      expect(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
      expect(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
      expect(imageKind(Buffer.from("<svg/>"))).toBeNull();
    });
  });
  ```
  - `tests/server/routers/images.test.ts`, vía `imagesRouter.createCaller({ db })` con `db` de `@/server/db` (en memoria). Para los casos 2 y 3, sembrar antes una campaña con `seedSession(db)`, porque el chequeo `NOT_FOUND` va primero:
    1. Un `campaignId` inexistente (`"../../etc"`) da `NOT_FOUND`.
    2. Un base64 que no es imagen da `BAD_REQUEST`.
    3. Un base64 de más de `MAX_REFERENCE_BYTES` da `BAD_REQUEST`. Generarlo con `Buffer.alloc(MAX_REFERENCE_BYTES + 1)` y un header PNG.

    El happy path escribiría en `RPG_OUTPUT_DIR`: no se testea (o se apunta `RPG_OUTPUT_DIR` a un tmpdir con `vi.stubEnv` **antes** de importar el router, si es simple).

- [ ] **Paso 2: Implementar.** `server/image/paths.ts`:
  ```ts
  /** File-safe slug for character names (refs/<slug>.png). */
  export function sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
  }

  /** Accept only a single plain path segment (ids are UUIDs); throws otherwise. */
  export function assertSafeSegment(segment: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error(`Unsafe path segment: ${JSON.stringify(segment)}`);
    return segment;
  }

  export function imageKind(buf: Buffer): "png" | "jpeg" | null {
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    return null;
  }
  ```
  - `referenceManager.ts`: importar `sanitizeName` y `assertSafeSegment` desde `./paths`; borrar el `sanitizeName` local. `getRefDir(campaignId)` pasa a `join(REFS_BASE, assertSafeSegment(campaignId), "refs")`.
  - `routers/images.ts`:
    - Borrar el `sanitizeName` local e importarlo desde `../image/paths`.
    - `export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;`
    - En `uploadReference`: input con `characterName: z.string().min(1).max(100)` e `imageBase64: z.string().max(Math.ceil(MAX_REFERENCE_BYTES * 4 / 3) + 4)`. En el handler:
      1. Buscar la campaña; si no existe, `NOT_FOUND`.
      2. Decodificar. Si `imageData.length > MAX_REFERENCE_BYTES` o `imageKind(imageData) === null`, `BAD_REQUEST` ("Reference must be a PNG or JPEG up to 10 MB").
      3. Recién entonces llamar `saveCharacterRef`.
    - `getReference`: también buscar la campaña (si no existe → `{ exists: false, url: null }`).

- [ ] **Paso 3:** tests en verde, typecheck y lint. Commit:
```bash
git add server/image/paths.ts server/image/referenceManager.ts server/routers/images.ts tests/server/image/paths.test.ts tests/server/routers/images.test.ts
git commit -m "fix(image): validate campaign ids and reference uploads (type, size); one sanitizeName"
```

---

### Task 2.11: Verificación con modelo real y docs

- [ ] **Paso 1: Smoke test** contra una copia de la DB (online backup, ver la memoria `sqlite-wal-backups`), con Ollama real, usando un script en el scratchpad que importe `runPipeline`. Casos:
  1. Turno normal: completa y `storyState.turn` sube 1.
  2. Abort a mitad del stream (`AbortController.abort()` al llegar el primer token): no queda ningún mensaje nuevo y el lock se libera.
  3. Fallo forzado con `ollamaBaseUrl` inválido en una copia de `user_settings` de la DB copiada: `onError` con `restoreInput` y sin mensaje huérfano.
- [ ] **Paso 2: E2E:** `DB_PATH=<copia> PLAY_LOOP=1 npx vitest run scripts/ --no-file-parallelism` → 4/4.
- [ ] **Paso 3: `CLAUDE.md`.**
  - Agregar en gotchas:
    - **LLM config:** viene solo de `server/llm/config.ts`. Los usuarios cloud no tienen fallback local.
    - **Llamadas al narrador:** van por `narrate()`, que hace reintento con sink nuevo y emite el evento SSE `reset`.
    - **Señal de abort:** `runPipeline` acepta `signal`. Un turno abortado o fallido borra su mensaje de usuario, y el error SSE lleva `restoreInput`.
    - **Cadencias:** reconcile y journal se miden en turnos (`isDue`, `lastReconcileTurn`, `lastJournalTurn`).
    - **GPU gate:** `server/llm/gpuGate.ts`. Ollama espera mientras se genera una imagen. `acquireForImageGen` devuelve un lease, y se libera con `lease.release()`.
    - **Jobs `generating` huérfanos:** se marcan `failed` (`server/image/recovery.ts`).
  - Actualizar el bullet de VRAM contention.
- [ ] **Paso 4:** commit `docs: phase 2 robustness notes` y una revisión final de toda la rama con un subagente revisor. **Sin merge.**

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| `req.signal` no se aborta en algún entorno de Next al desconectarse el cliente | También está el `cancel()` del `ReadableStream`. El smoke test lo verifica con abort explícito; si en dev no se dispara, queda documentado. |
| Un chat que espera la GPU parece colgado mientras se renderiza una imagen | La espera tiene tope (`GPU_HOLD_STALE_MS`) y el input ya muestra "The narrator is writing…". Si molesta, se puede emitir un evento `status` en una fase posterior. |
| La detección de completitud de ComfyUI depende de la versión | Se aceptan los tres señales (`executing` con node null, `execution_success`, y SaveImage `finished`), y queda el polling de `/history` como red. |
| `vi.mock` de providers en `runPipeline.test.ts` no alcanza a `narrate.ts` | Ambos importan el mismo módulo resuelto. Si fallara, inyectar `call` vía un parámetro opcional de `runPipeline` (solo para tests). |
