# Fase 4 — Frontend: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el cliente muestre siempre datos frescos y correctos (cache invalidada, paginación sin huecos ni duplicados), que el streaming no re-renderice toda la pantalla por token, que no queden timers adivinando cuándo terminó el server, que el cliente no importe código de `server/` y que ningún componente pase de 300 líneas.

**Architecture:** la lógica pura que hoy está en componentes o en `server/pipeline` y la usan ambos lados pasa a `lib/` (client-safe, testeable en node). Las queries de una pantalla salen en paralelo (el layout deja de bloquear a los hijos). El historial del chat es un `useInfiniteQuery` con cursor compuesto `(createdAt, id)`. El estado de imágenes es `trpc.images.status` con `refetchInterval` condicional. El opener de sesión lo arma el server (mismo texto, marcado con `metadata.opener`). Tres cambios chicos de server acompañan al cliente: cursor de `messages.listBySession`, `images.illustrate` devuelve el `imageId` y el evento SSE `done` lleva el `messageId`.

**Tech Stack:** Next.js 15 App Router, React 18, tRPC 11 + TanStack Query 5, Tailwind, Vitest 2 + @testing-library/react 16 (jsdom por docblock `// @vitest-environment jsdom`).

**Dónde:** worktree `D:/proyects/rpg-story-generator-refactor`, rama `refactor/phase-4-frontend`, que sale de la punta de `refactor/phase-3-structure` (ramas apiladas): `git switch -c refactor/phase-4-frontend refactor/phase-3-structure`. Reglas:
- **Nunca** push ni merge a `master`. Nunca escribir `data/rpg.db`.
- **No correr** `npm install`/`uninstall` (sin dependencias nuevas: si una tarea necesitara una, queda fuera de alcance), ni `npm run dev`, ni `next build` (abre la DB y aplica migraciones), ni scripts con `PLAY_LOOP`.
- Los implementadores **no tienen browser**: cada tarea se verifica con `npm test && npm run typecheck && npm run lint`. Las tareas marcadas 🖐 necesitan además el chequeo manual del usuario (lista al final).
- Nunca crear junctions de `node_modules` ni borrar worktrees con `--force`.

**Fuera de alcance:** prefetch con server components (`createCaller` + `HydrationBoundary`, opcional en el roadmap; la guía de "Fuera de alcance" del roadmap descarta migrar a server components), virtualización de la lista de mensajes (necesita dependencia), migración de datos para marcar openers viejos (se usa un fallback por prefijo, ver 4.7), mostrar `goal`/`agenda` de NPCs en la página de NPCs (feature nueva).

**Línea de base:** 631 tests (fin de la Fase 3, ver `docs/superpowers/refactor-progress.md`). Anotar el conteo real al arrancar.

---

## Relevamiento: roadmap vs. código actual

| Ítem del roadmap (FASE 4) | Estado en `refactor/phase-3-structure` | Tarea |
|---|---|---|
| 4.1 Invalidación de cache | Sigue: ninguna mutación de campañas/personajes/settings/sesión nueva invalida. Además: `endSession` y los forms dejan promesas rechazadas sin manejar; "New session" admite doble click. | 4.2 |
| 4.2 Paginación | Sigue: `chat-container.tsx:55-62` fija el cursor una vez; el server usa `createdAt < cursor` (`messages.ts:25`), que **saltea** mensajes con el mismo ms en el borde (el comentario dice lo contrario). | 4.5 |
| 4.3 Rendimiento del streaming | Sigue: `MessageBubble` sin memo, `allMessages` se rearma por token (`chat-container.tsx:149`), `scrollIntoView` smooth por token (`message-list.tsx:60-65`), `setStreamingText("")` en `done` antes del refetch (flicker). | 4.6 |
| 4.4 Opener del lado del server | Sigue: `chat-container.tsx:113-142` arma el prompt; `message-list.tsx:133` lo oculta por prefijo. La lógica de reintento ante abort (Fase 2) ya está y se conserva. | 4.7 |
| 4.5 Waterfall | Sigue: `[campaignId]/layout.tsx:31-50` no renderiza hijos hasta tener la campaña; `ChatContainer` vuelve a pedir `sessions.get` (`:64`) y recién al montar pide mensajes. | 4.8 |
| 4.6 Imágenes sin timers | Sigue: `setTimeout` 1.5 s/4 s en `chat-container.tsx:74-75`, `scene-image.tsx:30-31` y `image-lightbox.tsx:40-47`; `use-image-status.ts` usa la ruta REST. | 4.4 |
| 4.7 Componentes | **Parcial.** Los componentes muertos ya se borraron (Fase 3, 3.9). Siguen los 7 archivos >300 líneas, el mapa de géneros duplicado (`layout.tsx:13`, `dashboard/page.tsx:13`), `timeAgo` duplicado (`dashboard/page.tsx:21`), diálogos de confirmación a mano (3) y `confirm()` nativo (`campaign-form.tsx:76`). | 4.3, 4.9, 4.10 |
| 4.8 Parser fuera del bundle | Sigue: `narrative-renderer.tsx:6` importa `server/pipeline/stateParser` en runtime. | 4.1 |

**Nuevos hallazgos** (se suman a las tareas indicadas): borrar personaje no pide confirmación (4.3); `SceneImage` muestra la barra de progreso para siempre si el status devuelve `null` (4.4); `illustrate` contesta `started` aunque ComfyUI esté caído y la imagen nunca se cree (4.4); `MechanicPlaceholder` es inalcanzable en producción (el server no streamea markers, `server/pipeline/utils.ts:16` `streamBeforeMarker`, y además `chat-container.tsx:157` los borra) (4.1); `QuickActions` solo se deshabilita con `isSending`, no con `isProcessing` (4.9); la página de NPCs castea a un tipo copiado a mano (`npcs/page.tsx:26-41`, `:341`) (4.9); la página de sesión queda en "Loading session..." para siempre si la sesión no existe (4.8); `statusLabel` maneja un estado `"ended"` que no existe (4.9); `CharacterLink` está declarado tres veces (4.1).

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `lib/json-scan.ts` | Crear (mover) | `scanBalanced` (desde `server/pipeline/json.ts`) |
| `lib/narrative.ts` | Crear | Markers `[MECHANIC]`, `splitStateUpdate`, `narrationForDisplay` |
| `lib/character-links.ts` | Crear (mover) | `CharacterLink`, `injectCharacterLinks` |
| `lib/campaign-input.ts` | Crear | `CampaignFormData`, `toCampaignInput` |
| `lib/messages.ts` | Crear | `mergePages`, `isHiddenOpener` |
| `hooks/use-session-messages.ts` | Crear | Historial paginado (infinite query) |
| `hooks/use-session-opener.ts` | Crear | Dispara el opener una vez (con reintento ante abort) |
| `hooks/use-image-status.ts` | Reescribir | `trpc.images.status` con polling condicional |
| `components/ui/confirm-dialog.tsx` | Crear | Diálogo de confirmación compartido |
| `components/ui/string-list-editor.tsx`, `components/ui/form-styles.ts` | Crear | Editor de listas (stats, hooks, inventario) y clases de inputs |
| `server/pipeline/sessionOpener.ts` | Crear | `openerPrompt`, `prepareOpener` |
| `server/routers/messages.ts` | Modificar | Cursor `(createdAt, id)` |
| `server/routers/images.ts`, `server/image/imageOrchestrator.ts` | Modificar | `illustrate` espera la fila y devuelve `imageId` |
| `server/pipeline/orchestrator.ts`, `app/api/chat/stream/route.ts` | Modificar | `done` con `messageId`; body `{ opener: true }` |
| `app/api/images/status/[imageId]/route.ts`, `components/chat/mechanic-placeholder.tsx` | Borrar | Reemplazados |
| Componentes/páginas >300 líneas | Partir | Ver 4.9 |

---

## Orden y commits

4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7 → 4.8 → 4.9 → 4.10. Un commit por tarea (mensaje indicado en cada una). Después de cada tarea: `npm test && npm run typecheck && npm run lint`. Los mensajes de commit terminan con la línea `Co-Authored-By` que indique la sesión.

---

### Task 4.1: Texto narrativo compartido en `lib/` (roadmap 4.8)

**Problema:** `narrative-renderer.tsx:6` importa `parseStateUpdate` de `server/pipeline/stateParser` (y con él `server/pipeline/json`), así que el parser del pipeline viaja en el bundle del cliente y hasta loguea `console.warn` en el browser con JSON malformado. Los regex de markers están copiados en `chat-container.tsx:157` y `narrative-renderer.tsx:29,68`. `splitByMarkers` + `MechanicPlaceholder` solo corren con `isStreaming`, y el texto que streamea nunca trae markers (`streamBeforeMarker` corta antes y el container los borra): es UI muerta, cubierta solo por tests.

**Files:** Create `lib/json-scan.ts`, `lib/narrative.ts`, `lib/character-links.ts`, `tests/lib/narrative.test.ts`, `tests/lib/characterLinks.test.ts`, `tests/lib/clientBoundary.test.ts`. Modify `server/pipeline/json.ts`, `server/pipeline/text.ts`, `server/pipeline/stateParser.ts`, `lib/dice.ts`, `components/chat/narrative-renderer.tsx`, `message-bubble.tsx`, `message-list.tsx`, `chat-container.tsx`, `tests/components/narrative-renderer.test.tsx`. Delete `components/chat/mechanic-placeholder.tsx`.

- [ ] **Test de frontera primero** (`tests/lib/clientBoundary.test.ts`), queda como guardia permanente:
  ```ts
  import { describe, it, expect } from "vitest";
  import { readdirSync, readFileSync, statSync } from "fs";
  import { join, relative } from "path";

  const ROOT = process.cwd();
  // A runtime import/re-export of server code. `import type` is erased at compile time and allowed.
  const SERVER_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["'](?:@\/server\/|(?:\.\.\/)+server\/)/m;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  describe("client bundle boundary", () => {
    it("client code imports nothing from server/ at runtime (route handlers excepted)", () => {
      const offenders = ["app", "components", "hooks", "lib"]
        .flatMap((d) => sourceFiles(join(ROOT, d)))
        .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
        .filter((f) => !f.startsWith("app/api/"))
        .filter((f) => SERVER_IMPORT.test(readFileSync(join(ROOT, f), "utf8")));
      expect(offenders).toEqual([]);
    });
  });
  ```
  Correr: falla con `["components/chat/narrative-renderer.tsx"]`.
- [ ] **Test de paridad** (`tests/lib/narrative.test.ts`), escrito antes de mover:
  ```ts
  import { describe, it, expect } from "vitest";
  import { narrationForDisplay, splitStateUpdate } from "@/lib/narrative";
  import { parseStateUpdate } from "@/server/pipeline/stateParser";

  // Canonical, extra-brace, lone-brace, prose-block, bare and unclosed STATE_UPDATE shapes.
  const samples = [
    "Just some narrative text.",
    'Hola.\n\n<!-- STATE_UPDATE {"characters":{"Ilse":{}}}} STATE_UPDATE -->',
    "Hola.\n\n---\n}",
    "[STATE_UPDATE]\nInventory: rope\n\nNext paragraph.",
    'A bare block.\nSTATE_UPDATE\n{"characters":{}}',
    'Unclosed <!-- STATE_UPDATE {"characters":{"A":\n\nTail paragraph.',
  ];

  describe("splitStateUpdate", () => {
    it.each(samples)("matches parseStateUpdate's cleanedContent: %j", (s) => {
      expect(splitStateUpdate(s).cleanedContent).toBe(parseStateUpdate(s).cleanedContent);
    });
  });

  describe("narrationForDisplay", () => {
    it("drops complete and cut-off mechanic markers", () => {
      expect(narrationForDisplay("a [MECHANIC:stat_check:DEX:DC12] b [MECHAN")).toBe("a  b");
    });
    it("drops STATE_UPDATE blocks", () => {
      expect(narrationForDisplay('Prose.\n\n<!-- STATE_UPDATE {"characters":{}} STATE_UPDATE -->')).toBe("Prose.");
    });
  });
  ```
- [ ] **`lib/json-scan.ts`:** mover `BalancedScan` y `scanBalanced` **sin cambios** desde `server/pipeline/json.ts`. Ese archivo queda como `export { scanBalanced, type BalancedScan } from "@/lib/json-scan";` (así `narrativeExtractor.ts`, `stateParser.ts` y `tests/pipeline/json.test.ts` no cambian).
- [ ] **`lib/narrative.ts`:**
  ```ts
  /**
   * Narration text helpers shared by the pipeline (server/pipeline/text.ts,
   * stateParser.ts) and the chat UI. Client-safe: imports only lib/.
   */
  import { scanBalanced } from "./json-scan";

  /** A complete `[MECHANIC:...]` marker (non-global: safe for .test()/.exec()) (also matches truncated keywords like `[MECHAN_:...]`). */
  export const MECHANIC_MARKER_RE = /\[MECHAN\w*:[^\]]*\]/i;
  const MECHANIC_MARKER_GLOBAL = new RegExp(MECHANIC_MARKER_RE.source, "gi");

  /** Removes complete mechanic markers and tidies the whitespace they leave behind. */
  export function stripMechanicMarkers(text: string): string {
    return text.replace(MECHANIC_MARKER_GLOBAL, "").replace(/[^\S\n]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** Removes markers including truncated ones (no colon or closing bracket). Does not touch whitespace. */
  export function stripMechanicMarkersLoose(text: string): string {
    return text.replace(/\[MECHAN[^\]]*\]?/g, "");
  }

  // extractStateBlocks: moved verbatim from server/pipeline/stateParser.ts (with its
  // endOfJsonObject helper and doc comment). Not exported.

  export interface StateUpdateSplit {
    /** The prose with every STATE_UPDATE block removed. */
    cleanedContent: string;
    /** Raw JSON payloads, in order (not parsed). */
    payloads: string[];
  }

  export function splitStateUpdate(response: string): StateUpdateSplit {
    // Safety net: models sometimes emit STATE_UPDATE as prose with no JSON to parse.
    const withoutProseBlocks = response
      .replace(/\[STATE_UPDATE\][\s\S]*?(?=\n\s*\n|$)/gi, "")
      .replace(/^\s*STATE_UPDATE\s*:.*$/gim, "");
    const { prose, payloads } = extractStateBlocks(withoutProseBlocks);
    const cleanedContent = prose
      .replace(/\n\s*[{}]+\s*$/, "") // a lone brace left on the last line
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { cleanedContent, payloads };
  }

  /** What the chat shows for a stored narrator message (older rows were saved with markers / STATE_UPDATE blocks). */
  export function narrationForDisplay(content: string): string {
    return splitStateUpdate(stripMechanicMarkersLoose(content)).cleanedContent;
  }
  ```
- [ ] `server/pipeline/text.ts`: borrar las tres definiciones de markers y re-exportarlas: `export { MECHANIC_MARKER_RE, stripMechanicMarkers, stripMechanicMarkersLoose } from "@/lib/narrative";` (`sameName` queda). `server/pipeline/stateParser.ts`: borrar `endOfJsonObject`/`extractStateBlocks` y el bloque inicial de `parseStateUpdate`; ahora empieza con `const { cleanedContent, payloads } = splitStateUpdate(response);` y el resto (merge de payloads, `cleanItems`) queda igual. `tests/pipeline/stateParser.test.ts` y `text.test.ts` pasan sin cambios.
- [ ] **`lib/character-links.ts`:** mover `injectCharacterLinks` desde `narrative-renderer.tsx:48-61` y exportar `interface CharacterLink { name: string; id: string; campaignId: string }`; `message-list.tsx:6`, `message-bubble.tsx:13` y `narrative-renderer.tsx:8` importan el tipo de acá. Test (`tests/lib/characterLinks.test.ts`): enlaza el nombre más largo primero ("Sera Vane" antes que "Sera") y no re-enlaza texto que ya es link.
- [ ] `lib/dice.ts`: junto a `formatDiceResult`, agregar
  ```ts
  /** Drops the trailing roll that formatDiceResult appended for the narrator (the dice card shows it). */
  export function stripRollSuffix(text: string): string {
    return text.replace(/\s*\[(?:ROLL|DADO|DICE): [^\]]*\]\s*$/, "");
  }
  ```
  y `message-bubble.tsx:51` usa `diceRoll ? stripRollSuffix(rawText) : rawText`.
- [ ] **`narrative-renderer.tsx`:** borrar `Segment`, `splitByMarkers`, `injectCharacterLinks` y la rama de placeholders; los imports pasan a `MarkdownRenderer`, `narrationForDisplay`/`stripMechanicMarkersLoose` (`@/lib/narrative`) e `injectCharacterLinks`/`CharacterLink` (`@/lib/character-links`), con `const NO_LINKS: CharacterLink[] = []` como default estable de `characterLinks`. El cuerpo:
  ```tsx
  export function NarrativeRenderer({ content, isStreaming, characterLinks = NO_LINKS }: NarrativeRendererProps) {
    const linked = useMemo(() => {
      // The server never streams markers (streamBeforeMarker); the loose strip is a cheap guard.
      const clean = isStreaming ? stripMechanicMarkersLoose(content) : narrationForDisplay(content);
      return characterLinks.length > 0 ? injectCharacterLinks(clean, characterLinks) : clean;
    }, [content, isStreaming, characterLinks]);

    return (
      <div className="narrative-drop-cap">
        <MarkdownRenderer content={linked} isNarrator />
      </div>
    );
  }
  ```
  `chat-container.tsx:157` pasa `content: streamingText` (sin regex). `git rm components/chat/mechanic-placeholder.tsx`.
- [ ] `tests/components/narrative-renderer.test.tsx`: reemplazar los dos tests de placeholders por "a stored message hides markers and STATE_UPDATE blocks" (`content="The door opens. [MECHANIC:damage:2d6]\n\n<!-- STATE_UPDATE {\"characters\":{}} STATE_UPDATE -->"`, sin `isStreaming`: aparece "The door opens." y no aparece "STATE_UPDATE") y "a cut-off marker never shows while streaming" (`content="You swing [MECHAN"`, `isStreaming`: `queryByText(/MECHAN/)` es null).
- [ ] Verificar: el test de frontera pasa; `grep -rn "MECHAN" components hooks app --include=*.tsx` no devuelve regex. Commit `refactor(chat): narration helpers in lib/; client imports nothing from server/; drop unreachable mechanic placeholder`.

---

### Task 4.2: Mutaciones — cache y errores visibles (roadmap 4.1) 🖐

**Problema:**
- Ninguna mutación invalida: crear/editar/borrar campaña, crear/editar/borrar personaje, guardar settings (`hasOpenaiKey` queda viejo), nueva sesión, terminar sesión (la lista de sesiones sigue "active").
- `mutateAsync` sin `catch`: `CampaignForm`/`CharacterForm` (`try/finally`), `handleEndSession` (`chat-container.tsx:90-93`: un CONFLICT cierra el diálogo y queda como rejection sin manejar) y `handleNewSession` (`[campaignId]/page.tsx:74-79`, además sin guardia de doble click).

**Files:** Create `lib/campaign-input.ts`, `tests/lib/campaignInput.test.ts`. Modify `components/campaigns/campaign-form.tsx`, `components/characters/character-form.tsx`, `app/campaigns/new/page.tsx`, `app/campaigns/[campaignId]/edit/page.tsx`, `app/campaigns/[campaignId]/page.tsx`, `app/campaigns/[campaignId]/characters/new/page.tsx`, `.../characters/[characterId]/page.tsx`, `app/settings/page.tsx`, `components/chat/chat-container.tsx`.

- [ ] **Test primero** (`tests/lib/campaignInput.test.ts`): `toCampaignInput(form)` devuelve los campos del form tal cual (nombre, estilo de imagen, stats) y no toca `customImageConfig`.
- [ ] **`lib/campaign-input.ts`:** mover `CampaignFormData` desde `campaign-form.tsx:24-38` (el form hace `export type { CampaignFormData } from "@/lib/campaign-input";` para no romper imports) y agregar `toCampaignInput(data)`, que arma los campos que `campaigns.create` y `campaigns.update` comparten a partir del form (`import type` desde `@/types`).
- [ ] **Forms:** `CampaignForm` y `CharacterForm` reciben `error?: string` y lo muestran arriba del botón de submit (`{error && <p role="alert" className="text-sm text-destructive">{error}</p>}`); su `handleSubmit` agrega `catch { /* the page renders mutation.error */ }` antes del `finally`.
- [ ] **Páginas** (antes → después; cada una toma `const utils = trpc.useUtils();`):
  - `campaigns/new`: `useMutation()` → `useMutation({ onSuccess: () => utils.campaigns.list.invalidate() })`; `mutateAsync(toCampaignInput(data))`; `<CampaignForm error={createCampaign.error?.message} …>`.
  - `[campaignId]/edit`: `mutateAsync({ id: campaignId, ...toCampaignInput(data) })`; `onSuccess: (updated) => { utils.campaigns.get.setData({ id: updated.id }, updated); void utils.campaigns.list.invalidate(); }`.
  - `[campaignId]/page.tsx` delete: `onSuccess: () => utils.campaigns.list.invalidate()`. **No** invalidar `campaigns.get` (el layout todavía montado lo re-pediría y mostraría "Campaign not found" antes de navegar).
  - `[campaignId]/page.tsx` new session:
    ```ts
    const createSession = trpc.sessions.create.useMutation({
      onSuccess: () => utils.sessions.listByCampaign.invalidate({ campaignId }),
    });
    async function handleNewSession() {
      if (createSession.isPending) return;
      try {
        const session = await createSession.mutateAsync({ campaignId, title: `Session ${(sessions?.length ?? 0) + 1}` });
        router.push(`/campaigns/${campaignId}/sessions/${session.id}`);
      } catch {
        // createSession.error is rendered under the Sessions header
      }
    }
    ```
    Los dos botones "New"/"Start First Session" con `disabled={createSession.isPending}`.
  - `characters/new`: `onSuccess: () => utils.characters.listByCampaign.invalidate({ campaignId })`, `error` al form.
  - `characters/[characterId]`: update `onSuccess: (c) => { utils.characters.get.setData({ id: c.id }, c); void utils.characters.listByCampaign.invalidate({ campaignId }); }`; delete `onSuccess: () => utils.characters.listByCampaign.invalidate({ campaignId })`. Verificar que `characters.update` devuelve la fila (si no, invalidar `characters.get` en vez de `setData`).
  - `settings`: `useMutation({ onSuccess: () => utils.userSettings.get.invalidate() })`.
  - `chat-container.tsx` end session: `onSuccess` suma `void utils.sessions.listByCampaign.invalidate({ campaignId: session.campaignId })`; `handleEndSession` pasa a `endSession.mutate({ sessionId })` (sin `await`), y si `endSession.error` existe se muestra en el banner de error (mensaje del server, p. ej. "A turn is still in progress…").
- [ ] Commit `fix(ui): invalidate caches after mutations; surface mutation errors`.

---

### Task 4.3: `ConfirmDialog` compartido 🖐

**Problema:** tres diálogos escritos a mano (`chat-container.tsx:297-323`, `[campaignId]/page.tsx:397-436`), un `confirm()` nativo dentro de un `useEffect` con `eslint-disable` (`campaign-form.tsx:72-81`) y "Delete Character" (`character-form.tsx:381-396`) que borra de un click, sin confirmar.

**Files:** Create `components/ui/confirm-dialog.tsx`, `tests/components/confirm-dialog.test.tsx`. Modify `chat-container.tsx`, `app/campaigns/[campaignId]/page.tsx`, `character-form.tsx`, `campaign-form.tsx`.

- [ ] **Test primero** (`// @vitest-environment jsdom`, `render`/`screen`/`fireEvent` de `@testing-library/react`): (1) cerrado no renderiza nada; (2) "Delete" llama `onConfirm`, "Cancel" llama `onCancel`; (3) Escape llama `onCancel`; (4) con `pending`, ambos botones `disabled`, Escape no hace nada y se ve `pendingLabel`; (5) el `alertdialog` tiene nombre accesible = `title` (`getByRole("alertdialog", { name: "Delete Campaign" })`).
- [ ] **Implementación:**
  ```tsx
  "use client";

  import { useEffect, useId, useRef, type ReactNode } from "react";
  import { Loader2 } from "lucide-react";
  import { cn } from "@/lib/utils";

  interface ConfirmDialogProps {
    open: boolean; title: string; description: ReactNode;
    confirmLabel: string; pendingLabel?: string; cancelLabel?: string;
    /** Red confirm button (default). False uses the genre accent. */
    destructive?: boolean;
    pending?: boolean;
    onConfirm: () => void; onCancel: () => void;
  }

  export function ConfirmDialog({
    open, title, description, confirmLabel, pendingLabel, cancelLabel = "Cancel",
    destructive = true, pending = false, onConfirm, onCancel,
  }: ConfirmDialogProps) {
    const id = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
      if (!open) return;
      cancelRef.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !pending) onCancel();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, pending, onCancel]);

    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={pending ? undefined : onCancel} />
        <div
          role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}
          className="relative mx-4 w-full max-w-sm rounded-md border border-border bg-card p-6 shadow-2xl"
        >
          <h3 id={`${id}-title`} className="mb-2 text-sm font-semibold">{title}</h3>
          <div id={`${id}-desc`} className="mb-6 text-sm text-muted-foreground">{description}</div>
          <div className="flex justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50">
              {cancelLabel}
            </button>
            <button type="button" onClick={onConfirm} disabled={pending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50",
                destructive ? "bg-destructive text-destructive-foreground" : "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]"
              )}>
              {pending && <Loader2 className="h-3 w-3 animate-spin" />}
              {pending ? pendingLabel ?? confirmLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```
- [ ] **Usos:**
  - Chat: `<ConfirmDialog open={confirmEnd} title="End this session?" description="A summary will be generated from recent messages. This cannot be undone." confirmLabel="End Session" pendingLabel="Ending..." pending={endSession.isPending} onConfirm={handleEndSession} onCancel={closeConfirm} />` (`closeConfirm` con `useCallback`).
  - Campaña: reemplaza `:397-436`; `pending={removeCampaign.isPending}` y se borra el estado `isDeleting`.
  - Personaje: `CharacterForm` abre el diálogo ("Delete {name}? This permanently deletes the character and cannot be undone.") en vez de borrar directo.
  - Género en edición: borrar `prevGenre` y el `useEffect` (`campaign-form.tsx:72-81`):
    ```ts
    const [pendingGenre, setPendingGenre] = useState<Genre | null>(null);
    function applyPresets(g: Genre) {
      setStatDefinitions([...STAT_PRESETS[g]]);
      setQuickActions([...QUICK_ACTION_PRESETS[g]]);
    }
    function handleGenreChange(g: Genre) {
      setGenre(g);
      if (isEdit) setPendingGenre(g); // ask before replacing what the user already edited
      else applyPresets(g);
    }
    ```
    con `<ConfirmDialog open={pendingGenre !== null} title="Load genre presets?" description="Replace the stats and quick actions with the presets for this genre." confirmLabel="Load presets" cancelLabel="Keep current" destructive={false} onConfirm={() => { applyPresets(pendingGenre!); setPendingGenre(null); }} onCancel={() => setPendingGenre(null)} />`. El comportamiento es el mismo de hoy (crear: siempre carga; editar: pregunta).
- [ ] Verificar: `grep -rn "confirm(" components app` no devuelve `confirm()` nativo. Commit `feat(ui): shared ConfirmDialog; confirm character deletion; genre presets prompt without window.confirm`.

---

### Task 4.4: Estado de imágenes sin timers (roadmap 4.6) 🖐

**Problema:** `use-image-status.ts` hace `fetch` a la ruta REST `app/api/images/status/[imageId]` (duplica `trpc.images.status`, `server/routers/images.ts:170-176`). Tres lugares invalidan a ciegas con `setTimeout` 1.5 s/4 s. En `illustrate`, la fila `generating` y `metadata.imageId` se escriben **después** de contestar (`imageOrchestrator.ts:266-277`, tras el health check y `isComfyUIAvailable()`), así que los timers a veces llegan antes, y si ComfyUI está caído el router contesta `started` aunque nunca se cree nada. Si el status devuelve `null`, `scene-image.tsx:105` muestra "Preparing illustration..." para siempre.

**Files:** Modify `server/image/imageOrchestrator.ts`, `server/routers/images.ts`, `tests/server/routers/illustrate.test.ts`, `hooks/use-image-status.ts`, `components/chat/chat-container.tsx`, `components/chat/scene-image.tsx`, `components/gallery/image-lightbox.tsx`. Delete `app/api/images/status/[imageId]/route.ts`.

- [ ] **Test primero** (`illustrate.test.ts`): en `beforeEach`, `generateSceneImage.mockImplementation(async (ctx: { onRecordCreated?: (id: string) => void }) => { ctx.onRecordCreated?.("img-1"); })`. Agregar:
  - "returns the new image id once the generating row exists": `resolves.toEqual({ status: "started", imageId: "img-1" })`.
  - "returns unavailable when the job ends without creating a row" (`generateSceneImage.mockResolvedValueOnce(undefined)`): `{ status: "unavailable" }`.
  - "returns unavailable when the job throws before creating a row" (`mockRejectedValueOnce(new Error("boom"))`).
  Los tests existentes (`toMatchObject({ status: "started" })`) siguen valiendo.
- [ ] **`imageOrchestrator.ts`:** `ImagePipelineContext` suma `/** Called once the "generating" row and message metadata are written (normal path only). */ onRecordCreated?: (imageId: string) => void;` y se invoca justo después del `db.update(messages)…` de `:277`.
- [ ] **`images.illustrate`** (`images.ts:59-74`), antes → después:
  ```ts
  let createdId: string | undefined;
  let markCreated!: () => void;
  const created = new Promise<void>((resolve) => { markCreated = resolve; });
  job = generateSceneImage({
    /* ...same fields... */
    onRecordCreated: (id) => { createdId = id; markCreated(); },
  });
  job.catch((err) => console.error("[ImageGen] job crashed", err));
  // Answer once the row exists (or the job gave up before creating one): the client then shows progress right away.
  await Promise.race([created, job.then(() => undefined, () => undefined)]);
  return createdId
    ? { status: "started" as const, imageId: createdId }
    : { status: "unavailable" as const };
  ```
  El `finally` con `illustrateStarting` queda igual. `regenerate` no cambia: ya reescribe `metadata.imageId` antes de contestar (`images.ts:126-131`).
- [ ] **`hooks/use-image-status.ts`:**
  ```ts
  "use client";

  import { trpc } from "@/lib/trpc";

  /** Poll interval while a scene image is rendering. */
  export const IMAGE_POLL_MS = 2000;

  export function useImageStatus(imageId: string | undefined) {
    return trpc.images.status.useQuery(
      { imageId: imageId ?? "" },
      {
        enabled: !!imageId,
        // Re-evaluated after every fetch: polls only while the row says "generating".
        refetchInterval: (query) => (query.state.data?.status === "generating" ? IMAGE_POLL_MS : false),
      }
    );
  }
  ```
  `git rm "app/api/images/status/[imageId]/route.ts"` (verificar antes con grep que nadie más la llama).
- [ ] **Componentes:**
  - `chat-container.tsx:69-77`:
    ```ts
    const ILLUSTRATE_NOTES = {
      already_generating: "An illustration is already being generated.",
      no_content: "Nothing to illustrate yet.",
      unavailable: "Image generation is unavailable right now (is ComfyUI running?).",
    } as const;
    const [illustrateNote, setIllustrateNote] = useState<string | null>(null);
    const illustrate = trpc.images.illustrate.useMutation({
      onSuccess: (res) => {
        if (res.status === "started") {
          setIllustrateNote(null);
          void utils.messages.listBySession.invalidate({ sessionId });
        } else {
          setIllustrateNote(ILLUSTRATE_NOTES[res.status]);
        }
      },
    });
    ```
    `illustrateNote` se muestra con el estilo del banner de error pero en ámbar y con "dismiss".
  - `scene-image.tsx:26-33`: `onSuccess: () => void utils.messages.listBySession.invalidate()`. Y antes del bloque "Generating": `if (image === null) return null; // the row is gone`.
  - `image-lightbox.tsx:38-50`: `onSuccess: () => { void utils.images.listBySessionWithContext.invalidate(); void utils.images.listByCampaignGrouped.invalidate(); onClose(); }`. Mismo resultado visible que hoy: la imagen reemplazada desaparece y la nueva aparece al estar `completed` (botón Refresh de la galería de sesión).
- [ ] Verificar: `grep -rn "setTimeout" components hooks` solo devuelve los timers de UI ("Copied", mensaje de settings), ninguno con `invalidate`/`refetch`. Commit `refactor(images): tRPC status polling; illustrate returns the new image id; no timer-based invalidation`.

---

### Task 4.5: Historial paginado sin huecos ni duplicados (roadmap 4.2) 🖐

**Problema:** el cursor se fija una sola vez con la primera página (`chat-container.tsx:55-62`); la página "latest" se refetchea después de cada turno y su ventana de 30 avanza, así que los mensajes entre el cursor viejo y la ventana nueva desaparecen. En el server, `createdAt < cursor` con orden solo por `createdAt` (`messages.ts:25,32`) **saltea** un mensaje que comparta el milisegundo del borde.

**Files:** Modify `server/routers/messages.ts`. Create `tests/server/routers/messages.test.ts`, `lib/messages.ts`, `tests/lib/messages.test.ts`, `hooks/use-session-messages.ts`. Modify `components/chat/chat-container.tsx`, `components/chat/message-list.tsx`.

- [ ] **Test de server primero:**
  ```ts
  import { describe, it, expect } from "vitest";
  import { db } from "@/server/db";
  import { messages } from "@/server/db/schema";
  import { messagesRouter } from "@/server/routers/messages";
  import { seedSession } from "../../helpers/testDb";

  describe("messages.listBySession keyset pagination", () => {
    it("walks every message exactly once when a page boundary falls inside one millisecond", async () => {
      const { session } = seedSession(db);
      const rows = [
        { id: "m1", createdAt: 1000 }, { id: "m2", createdAt: 2000 },
        { id: "m3a", createdAt: 3000 }, { id: "m3b", createdAt: 3000 }, { id: "m4", createdAt: 4000 },
      ];
      for (const r of rows) db.insert(messages).values({ ...r, sessionId: session.id, role: "user", content: r.id }).run();

      const caller = messagesRouter.createCaller({ db });
      const seen: string[] = [];
      let cursor: { createdAt: number; id: string } | undefined;
      do {
        const page = await caller.listBySession({ sessionId: session.id, limit: 2, cursor });
        seen.unshift(...page.messages.map((m) => m.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(["m1", "m2", "m3a", "m3b", "m4"]);
    });
  });
  ```
- [ ] **`messages.ts`** (sumar `or` al import de `drizzle-orm`):
  ```ts
  const cursorSchema = z.object({ createdAt: z.number(), id: z.string() });

  listBySession: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().min(1).max(100).default(30),
      cursor: cursorSchema.nullish(), // the oldest message already shown
    }))
    .query(async ({ ctx, input }) => {
      const { sessionId, limit, cursor } = input;
      const conditions = [eq(messages.sessionId, sessionId)];
      if (cursor) {
        // Keyset on (createdAt, id): a page boundary inside one millisecond neither skips nor repeats a row.
        conditions.push(or(
          lt(messages.createdAt, cursor.createdAt),
          and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
        )!);
      }
      const items = await ctx.db.select().from(messages).where(and(...conditions))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1);
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const oldest = page[page.length - 1];
      return {
        messages: page.reverse(), // chronological
        nextCursor: hasMore ? { createdAt: oldest.createdAt, id: oldest.id } : undefined,
      };
    }),
  ```
- [ ] **`lib/messages.ts`** (+ test node: dos páginas newest-first se aplanan en orden cronológico; un id repetido aparece una vez):
  ```ts
  import type { Message } from "@/types";

  /** Flattens infinite-query pages (newest page first, each page chronological) into one chronological list, deduped by id. */
  export function mergePages(pages: ReadonlyArray<{ messages: Message[] }> | undefined): Message[] {
    if (!pages) return [];
    const seen = new Set<string>();
    const out: Message[] = [];
    for (let i = pages.length - 1; i >= 0; i--) {
      for (const m of pages[i].messages) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }
  ```
- [ ] **`hooks/use-session-messages.ts`:**
  ```ts
  "use client";

  import { useMemo } from "react";
  import { trpc } from "@/lib/trpc";
  import { mergePages } from "@/lib/messages";

  export const MESSAGE_PAGE_SIZE = 30;

  /** A session's history. On invalidation every loaded page is refetched and re-chained from the newest one. */
  export function useSessionMessages(sessionId: string) {
    const query = trpc.messages.listBySession.useInfiniteQuery(
      { sessionId, limit: MESSAGE_PAGE_SIZE },
      { getNextPageParam: (last) => last.nextCursor }
    );
    const messages = useMemo(() => mergePages(query.data?.pages), [query.data]);
    return {
      messages,
      loaded: query.data !== undefined,
      hasOlder: query.hasNextPage,
      loadOlder: query.fetchNextPage,
      isLoadingOlder: query.isFetchingNextPage,
    };
  }

  export type SessionMessages = ReturnType<typeof useSessionMessages>;
  ```
  `utils.messages.listBySession.invalidate({ sessionId })` (use-chat, illustrate) matchea también la infinite query: tRPC arma la key de invalidación con tipo `any` (ver Riesgos).
- [ ] **`chat-container.tsx`:** borrar `olderMessages`, `nextCursor`, `hasMore`, `isLoadingMore`, `initializedRef`, el `useEffect` de `:55-62`, `handleLoadMore` y `baseMessages`. Usar `const history = useSessionMessages(sessionId);` (en 4.8 pasa a venir por props). El opener usa `history.loaded && history.messages.length === 0`. `MessageList` recibe `loadMore={history.loadOlder}`, `canLoadMore={history.hasOlder}`, `isLoadingMore={history.isLoadingOlder}`.
- [ ] **`message-list.tsx` — anclaje al cargar páginas viejas:** hoy el viewport salta al prepend. Guardar `scrollHeight` antes de pedir y compensar después:
  ```ts
  const prependRef = useRef<number | null>(null);
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prependRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependRef.current; // keep the viewport on what the player was reading
      prependRef.current = null;
    }
  }, [firstId]);
  const handleLoadMore = () => {
    prependRef.current = scrollRef.current?.scrollHeight ?? null;
    loadMore();
  };
  ```
- [ ] Commit `fix(chat): keyset message pagination and an infinite query; no lost or repeated messages`.

---

### Task 4.6: Streaming sin re-render global (roadmap 4.3) 🖐

**Problema:** cada token hace `setStreamingText` en `ChatContainer`, que re-renderiza la pantalla entera: rearma `allMessages` (`:149`), cada `MessageBubble` (sin memo, con `onRetry` inline en `message-list.tsx:141-145` y `characterLinks = []` por default nuevo en cada render), `CharacterSheet`, `ChatInput`, `QuickActions` y `DiceRoller`, más `scrollIntoView({ behavior: "smooth" })` por token (`message-list.tsx:60-65`). En `done`, `use-chat.ts:61` limpia el texto y recién en otro tick invalida: hay un frame sin el mensaje.

**Files:** Modify `server/pipeline/orchestrator.ts`, `app/api/chat/stream/route.ts`, `tests/server/chatRoute.test.ts`, `tests/pipeline/runPipeline.test.ts`, `hooks/use-chat.ts`, `tests/hooks/useChat.test.tsx`, `components/chat/message-list.tsx`, `message-bubble.tsx`, `chat-container.tsx`, `components/characters/character-sheet.tsx`, `chat/quick-actions.tsx`, `chat/dice-roller.tsx`, `chat/chat-input.tsx`. Create `tests/components/message-list.test.tsx`.

- [ ] **Server: `done` lleva el id del mensaje guardado.** `RunPipelineParams.onComplete: (finalText: string, messageId: string) => void` (`orchestrator.ts:42`); en el camino trivial (`:125`) capturar `const assistantMessageId = commitTurn(...)` y llamar `onComplete(cleanedContent, assistantMessageId)`; en el normal (`:206`) `onComplete(finalText, assistantMessageId)`. La ruta: `onComplete: (finalText, messageId) => { send({ type: "done", text: finalText, messageId }); close(); }`. Los callbacks existentes de un argumento (scripts e2e) siguen compilando. Tests: el mock de `chatRoute.test.ts` llama `p.onComplete("Hi there", "m1")` y un caso nuevo verifica que el stream contiene `"messageId":"m1"`; en `runPipeline.test.ts` capturar el segundo argumento y verificar que es el id de la fila `assistant` insertada.
- [ ] **Tests de `useChat` primero** (en `beforeEach`: `invalidate.mockResolvedValue(undefined)`, porque `afterEach` hace `mockReset`):
  ```ts
  const sse = (...events: object[]) =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });

  it("keeps the streamed text after done and reports the saved message id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse({ type: "token", text: "Hola" }, { type: "done", text: "Hola", messageId: "m9" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(result.current.streamingText).toBe("Hola");
    expect(result.current.committedMessageId).toBe("m9");
    expect(invalidate).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("coalesces a burst of tokens into one animation frame", async () => {
    const raf = vi.fn((_cb: FrameRequestCallback) => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(
      { type: "token", text: "a" }, { type: "token", text: "b" }, { type: "token", text: "c" },
      { type: "done", text: "abc", messageId: "m1" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(result.current.streamingText).toBe("abc"); // done flushes synchronously
  });

  ```
  Tercer caso, "a reset drops the text streamed so far": `token "abc"`, `reset`, `token "x"`, `done` → `streamingText === "x"`.
- [ ] **`use-chat.ts`:** tokens a un ref con flush por frame; `done` conserva el texto; un `runTurn` interno (4.7 le suma `sendOpener`). Cambios sobre el archivo actual:
  ```ts
  type StreamEvent = { type: string; text?: string; message?: string; restoreInput?: string; messageId?: string };

  const requestFrame = (cb: () => void): number =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : window.setTimeout(cb, 16);
  const cancelFrame = (id: number): void =>
    typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : window.clearTimeout(id);

  // inside useChat:
  const [committedMessageId, setCommittedMessageId] = useState<string | null>(null);
  const bufferRef = useRef("");
  const frameRef = useRef<number | null>(null);

  /** Replaces the streamed text now (drops a pending frame). */
  const setText = useCallback((text: string) => {
    bufferRef.current = text;
    if (frameRef.current !== null) {
      cancelFrame(frameRef.current);
      frameRef.current = null;
    }
    setStreamingText(text);
  }, []);

  /** Appends a token; React sees at most one update per animation frame. */
  const appendText = useCallback((delta: string) => {
    bufferRef.current += delta;
    if (frameRef.current === null) {
      frameRef.current = requestFrame(() => {
        frameRef.current = null;
        setStreamingText(bufferRef.current);
      });
    }
  }, []);

  // Leaving the page cancels the turn in flight and any pending frame.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (frameRef.current !== null) cancelFrame(frameRef.current);
  }, []);
  ```
  `sendMessage` pasa a ser `runTurn(sessionId, body, draft)` con `body = { sessionId, message: content, metadata }` y `draft = content` (el `restoreInput` de los caminos de abort / non-OK usa `draft`); `sendMessage = useCallback((sessionId, content, metadata?) => runTurn(sessionId, { sessionId, message: content, metadata }, content), [runTurn])`. Al empezar: `setText(""); setCommittedMessageId(null);`. En `handleEvent`:
  - `token` → `appendText(event.text ?? "")`; `reset` → `setText("")`.
  - `done` →
    ```ts
    finished = true;
    result = { ok: true };
    setText(bufferRef.current); // flush; the container hides it once the saved message is in the list
    setCommittedMessageId(event.messageId ?? null);
    const refreshed = utils.messages.listBySession.invalidate({ sessionId });
    if (campaignId) void utils.characters.listByCampaign.invalidate({ campaignId });
    if (!event.messageId) void refreshed.then(() => setText("")); // older server: fall back to clearing after the refetch
    ```
    (se borra el `setTimeout(..., 0)` de `:62-65`).
  - `error`, cierre sin `done` y `catch` usan `setText("")` en vez de `setStreamingText("")`.
  El hook devuelve también `committedMessageId`.
- [ ] **Test de `MessageList`** (`tests/components/message-list.test.tsx`, jsdom). `NarrativeRenderer` mockeado para contar renders (`vi.mock("@/components/chat/narrative-renderer", () => ({ NarrativeRenderer: ({ content }: { content: string }) => { renders(content); return <p>{content}</p>; } }))`) y `Element.prototype.scrollTo = vi.fn()` en `beforeAll` (jsdom no lo implementa). Render con dos mensajes `assistant` guardados (`content` "old one"/"old two") y `streamingText="a"`; `rerender` con `"ab"`: `renders` recibió "old one" y "old two" **una vez** cada uno, y "ab" una vez. Otro caso: un `user` que empieza con `"[SESSION START"` no se renderiza (4.7 suma el caso `metadata: { opener: true }`).
- [ ] **`message-list.tsx`:** props `messages` (solo guardados) + `streamingText?: string` (`""` = ninguno). La lista guardada en un hijo memoizado; el bubble de streaming aparte; scroll instantáneo y a lo sumo una vez por frame mientras streamea:
  ```tsx
  const NO_LINKS: CharacterLink[] = [];

  const PersistedMessages = memo(function PersistedMessages({ messages, onRetry, characterLinks }: {
    messages: Message[]; onRetry?: (m: Message) => void; characterLinks: CharacterLink[];
  }) {
    return (
      <div className="py-2 space-y-0.5">
        {messages.filter((m) => !isHiddenOpener(m)).map((m) => (
          <MessageBubble key={m.id} message={m} characterLinks={characterLinks}
            onRetry={m.metadata?.error ? onRetry : undefined} />
        ))}
      </div>
    );
  });

  // in MessageList (the streaming bubble is a useMemo'd `{ id: "streaming", role: "assistant", content: streamingText, isStreaming: true, … } as Message`, rendered after <PersistedMessages>):
  const stickRef = useRef(true);   // replaces userScrolledUpRef (inverted)
  const frameRef = useRef<number | null>(null);
  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);
  const lastId = messages[messages.length - 1]?.id;
  const didInitialScroll = useRef(false);
  useEffect(() => {          // a new saved message: one smooth scroll (instant on first paint)
    scrollToBottom(didInitialScroll.current);
    didInitialScroll.current = true;
  }, [lastId, scrollToBottom]);
  useEffect(() => {          // streaming: instant, at most once per frame
    if (!streamingText || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = null; scrollToBottom(false); });
  }, [streamingText, scrollToBottom]);
  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);
  ```
  `isHiddenOpener` va en `lib/messages.ts`; en esta tarea solo mira el prefijo (`m.role === "user" && m.content.startsWith("[SESSION START")`, lo mismo que hoy) y 4.7 le suma `metadata.opener`. El estado vacío pasa a `visible.length === 0 && !streamingText` (hoy usa el largo sin filtrar). `characterLinks = NO_LINKS` como default.
- [ ] **`message-bubble.tsx`:** `export const MessageBubble = memo(function MessageBubble(...))`; `onRetry?: (message: Message) => void` y `<RetryButton onRetry={() => onRetry(message)} />`.
- [ ] **`chat-container.tsx`:**
  - Borrar `allMessages`. Pasar `messages={history.messages}` y
    ```ts
    const committedShown = !!committedMessageId && history.messages.some((m) => m.id === committedMessageId);
    // ...
    <MessageList streamingText={committedShown ? "" : streamingText} … />
    ```
    Así el texto streameado se reemplaza por el mensaje guardado en el mismo render: ni flicker ni duplicado.
  - `handleRetry` estable: `const messagesRef = useRef(history.messages); useEffect(() => { messagesRef.current = history.messages; });` y el callback lee `messagesRef.current` (deps `[sendMessage, sessionId]`).
  - Props estables para los hijos memoizados: `characterOptions = useMemo(() => characters.map((c) => ({ id: c.id, name: c.name })), [characters])`, `handleIllustrate` y `toggleDice` con `useCallback`.
- [ ] `React.memo` en `CharacterSheet` (default export: `export default memo(CharacterSheet)`), `QuickActions`, `DiceRoller` y `ChatInput`.
- [ ] Commit `perf(chat): batch streamed tokens per frame; memoized message list; swap the streamed text for the saved message without a blank frame`.

---

### Task 4.7: Apertura de sesión del lado del server (roadmap 4.4) 🖐

**Problema:** el cliente arma el prompt de apertura (`chat-container.tsx:126-132`), lo manda como mensaje de usuario y después lo esconde comparando el prefijo `"[SESSION START"` (`message-list.tsx:133`). **No cambia el gameplay:** el texto que recibe el pipeline es idéntico (el clasificador depende de ese prefijo, `server/pipeline/classifier.ts:20`), solo cambia quién lo arma y cómo se marca.

**Files:** Create `server/pipeline/sessionOpener.ts`, `tests/server/sessionOpener.test.ts`, `hooks/use-session-opener.ts`. Modify `server/db/jsonTypes.ts`, `server/db/jsonSchemas.ts`, `app/api/chat/stream/route.ts`, `tests/server/chatRoute.test.ts`, `hooks/use-chat.ts`, `lib/messages.ts`, `components/chat/chat-container.tsx`.

- [ ] **Tests primero** (`tests/server/sessionOpener.test.ts`, DB en memoria con `seedSession`/`seedCharacter`):
  - `openerPrompt("Aria", null)` y `openerPrompt("Aria", "…journal…")` devuelven **exactamente** los strings de `chat-container.tsx:129` y `:131` (copiarlos al test tal cual antes de borrarlos del cliente; el journal de >300 caracteres se recorta con `slice(-300)`).
  - `prepareOpener`: sesión inexistente → `{ ok: false, status: 404 }`; `status: "completed"` → 409; con mensajes → 409; sin personajes → 409; caso feliz → `{ ok: true, message }` con el nombre del **primer** personaje.
  - En `chatRoute.test.ts`: `{ sessionId, opener: true }` con sesión+personaje sembrados llama `runPipeline` con `message` que empieza con `"[SESSION START"` y `metadata: { opener: true }`; con la sesión ya iniciada contesta 409 `{ error }` sin llamar `runPipeline`; un cliente que manda `metadata: { opener: true }` en un turno normal lo ve descartado (`clientMessageMetadataSchema`).
- [ ] **`sessionOpener.ts`:**
  ```ts
  import { count, eq } from "drizzle-orm";
  import type { DB } from "../db";
  import { campaigns, characters, messages, sessions } from "../db/schema";

  /** The hidden first player turn of a session. Text kept verbatim from the old client opener: the classifier keys on its prefix. */
  export function openerPrompt(charName: string, campaignJournal: string | null): string {
    if (campaignJournal) {
      return `[SESSION START — continue the story. The last thing that happened: "${campaignJournal.slice(-300)}". Set the scene for a new chapter that picks up the open threads. Describe where ${charName} is and what is happening. Write in English.]`;
    }
    return `[SESSION START — set the opening scene. Describe where ${charName} is and what is happening around them. Establish atmosphere, location, and an immediate hook. Write in English.]`;
  }

  export type OpenerResult = { ok: true; message: string } | { ok: false; status: 404 | 409; error: string };

  export function prepareOpener(db: DB, sessionId: string): OpenerResult {
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return { ok: false, status: 404, error: "Session not found" };
    if (session.status === "completed") return { ok: false, status: 409, error: "This session has ended." };
    const [{ n }] = db.select({ n: count() }).from(messages).where(eq(messages.sessionId, sessionId)).all();
    if (n > 0) return { ok: false, status: 409, error: "This session has already started." };
    const campaign = db.select().from(campaigns).where(eq(campaigns.id, session.campaignId)).get();
    // Same query and row order as characters.listByCampaign, whose first row the client used to name.
    const first = db.select().from(characters).where(eq(characters.campaignId, session.campaignId)).all()[0];
    if (!campaign || !first) return { ok: false, status: 409, error: "Create a character before starting the session." };
    return { ok: true, message: openerPrompt(first.name, campaign.campaignJournal) };
  }
  ```
- [ ] **Metadata:** `MessageMetadata` suma `/** Server-written: the hidden opener turn. */ opener?: boolean;` (`jsonTypes.ts:75`), `messageMetadataObject` suma `opener: z.boolean().optional()` y `clientMessageMetadataSchema` lo omite (como `imageId`). Es un campo JSON opcional: sin migración.
- [ ] **Ruta** (`route.ts:32-39`): si `raw` es objeto y `raw.opener === true`, validar `z.object({ sessionId: <mismo schema>, opener: z.literal(true) })`, llamar `prepareOpener(db, sessionId)` (`import { db } from "@/server/db"`), devolver `!ok` como JSON `{ error }` con su status, y si no `message = prepared.message; metadata = { opener: true }`. El resto (stream, abort) no cambia; los casos de validación existentes siguen dando los mismos errores.
- [ ] **Cliente:**
  - `use-chat.ts`: `const sendOpener = useCallback((sessionId: string) => runTurn(sessionId, { sessionId, opener: true }, ""), [runTurn]);` y devolverlo.
  - `lib/messages.ts` (y el caso `metadata: { opener: true }` en `tests/components/message-list.test.tsx`):
    ```ts
    /** The hidden opener turn. Rows saved before metadata.opener existed are recognized by their prefix (legacy). */
    export function isHiddenOpener(m: Pick<Message, "role" | "content" | "metadata">): boolean {
      return m.role === "user" && (m.metadata?.opener === true || m.content.startsWith("[SESSION START"));
    }
    ```
  - `hooks/use-session-opener.ts` (sale de `chat-container.tsx:113-142`, misma lógica de reintento ante abort no pedido por el usuario):
    ```ts
    "use client";

    import { useEffect, useRef, useState } from "react";
    import type { SendResult } from "./use-chat";

    /** Starts a brand-new session once: the server writes the opening scene. */
    export function useSessionOpener(opts: {
      sessionId: string;
      ready: boolean; // history loaded, empty, session active, at least one character, not sending
      sendOpener: (sessionId: string) => Promise<SendResult>;
    }) {
      const { sessionId, ready, sendOpener } = opts;
      const triggeredRef = useRef(false);
      const [retry, setRetry] = useState(0);
      useEffect(() => {
        if (!ready || triggeredRef.current) return;
        triggeredRef.current = true;
        void sendOpener(sessionId).then((res) => {
          // A dev StrictMode remount (or leaving the page) aborts before anything commits: re-arm.
          // Only a non-user abort retries, so Stop is respected and an error can't loop.
          if (res.aborted && !res.stoppedByUser) {
            triggeredRef.current = false;
            setRetry((n) => n + 1);
          }
        });
      }, [ready, sessionId, sendOpener, retry]);
    }
    ```
    En el container: `useSessionOpener({ sessionId, sendOpener, ready: history.loaded && history.messages.length === 0 && !isSending && !isCompleted && hasCharacters })`.
  - `handleRetry`: si el mensaje de usuario previo cumple `isHiddenOpener`, no reenviarlo (`return`): reenviar su texto como turno normal lo dejaría visible.
- [ ] Verificar: `grep -rn "SESSION START" components hooks app` solo encuentra `lib/messages.ts`. Commit `refactor(session): the server builds the opener turn (same text) and flags it in metadata`.

---

### Task 4.8: Requests en paralelo al abrir una sesión (roadmap 4.5) 🖐

**Problema:** `[campaignId]/layout.tsx:31-50` devuelve un skeleton **sin** `children` hasta tener la campaña; recién entonces la página pide `sessions.get` + `characters.listByCampaign` (`sessions/[sessionId]/page.tsx:16-18`), y recién al montar `ChatContainer` se piden los mensajes (y `sessions.get` otra vez, `chat-container.tsx:64`): tres rondas. Si la sesión no existe, la página queda en "Loading session..." para siempre.

**Files:** Modify `app/campaigns/[campaignId]/layout.tsx`, `app/campaigns/[campaignId]/sessions/[sessionId]/page.tsx`, `components/chat/chat-container.tsx`.

- [ ] **Layout:** renderizar `children` también mientras carga; solo el error reemplaza el contenido:
  ```tsx
  if (campaignError) return <CampaignNotFound />; // the current :52-67 block, extracted
  return (
    <div className={cn("flex flex-col min-h-screen", campaign && GENRE_CLASS[campaign.genre])}>
      <AppHeader />
      {campaign ? <CampaignNav campaignId={campaignId} campaignName={campaign.name} /> : <CampaignNavSkeleton />}
      <main className="flex-1">{children}</main>
    </div>
  );
  ```
  (`CampaignNavSkeleton` = el `div` de `:35-39`; `GENRE_CLASS` sale de `lib/constants.ts` en 4.9 — hasta entonces queda el mapa local.) Las queries del layout y de la página salen en el mismo tick y `httpBatchLink` las junta en un request.
- [ ] **Página de sesión:** pide todo en el primer render y pasa el historial:
  ```tsx
  const sessionQ = trpc.sessions.get.useQuery({ id: sessionId });
  const campaignQ = trpc.campaigns.get.useQuery({ id: campaignId });
  const charactersQ = trpc.characters.listByCampaign.useQuery({ campaignId });
  const history = useSessionMessages(sessionId); // starts the history fetch in the same batch

  if (sessionQ.error) return <SessionNotFound campaignId={campaignId} />; // "Session not found" + link to the campaign
  if (!sessionQ.data || !campaignQ.data || !charactersQ.data) return <LoadingSession />;
  return <ChatContainer session={sessionQ.data} campaign={campaignQ.data} characters={charactersQ.data} history={history} />;
  ```
- [ ] **`ChatContainer`:** recibe `history: SessionMessages` (tipo de 4.5) y deja de llamar `useSessionMessages` y `sessions.get`; `isCompleted`/`isProcessing` salen de `session` (prop), que se actualiza cuando `use-chat` invalida `sessions.get`.
- [ ] Commit `perf(ui): campaign layout no longer gates its pages; a session opens with one batched request`.

---

### Task 4.9: Partir componentes grandes y unificar duplicados (roadmap 4.7)

**Problema:** archivos >300 líneas: `campaign-form.tsx` 474, `[campaignId]/page.tsx` 439, `chat-container.tsx` 429 (menos después de 4.4–4.8), `character-form.tsx` 415, `npcs/page.tsx` 349, `scene-image.tsx` 337, `image-lightbox.tsx` 316. Duplicados: mapa de clases de género (`layout.tsx:13`, `dashboard/page.tsx:13`), `timeAgo` (`dashboard/page.tsx:21` vs `lib/utils.ts`), `TRIGGER_LABELS` (`image-card.tsx:7`, `image-lightbox.tsx:13`), editor de prompts (`scene-image.tsx:255-319` y `image-lightbox.tsx` modo edición), editor de listas (stats/hooks/inventario), clases de inputs (`campaign-form.tsx:145-156`, `character-form.tsx:127-133`).

**Reglas:** mover JSX sin cambiar markup ni clases (revisar con `git diff --color-moved`); props explícitas, nada de contextos nuevos. Los únicos cambios de comportamiento permitidos son los listados como "fix".

- [ ] **Compartidos nuevos:**
  - `components/ui/form-styles.ts`: `inputClass`, `labelClass`, `selectClass` (los de `campaign-form.tsx:145-156`).
  - `components/ui/string-list-editor.tsx` (+ test jsdom: Enter agrega; duplicado rechazado salvo `allowDuplicates`; remove llama `onChange` sin el ítem):
    ```tsx
    "use client";

    import { useState } from "react";
    import { cn } from "@/lib/utils";
    import { inputClass } from "./form-styles";

    interface StringListEditorProps {
      items: string[];
      onChange: (items: string[]) => void;
      placeholder: string;
      /** Inventory may hold two of the same item; stats and plot hooks may not. */
      allowDuplicates?: boolean;
    }

    export function StringListEditor({ items, onChange, placeholder, allowDuplicates = false }: StringListEditorProps) {
      const [draft, setDraft] = useState("");
      const add = () => {
        const value = draft.trim();
        if (!value || (!allowDuplicates && items.includes(value))) return;
        onChange([...items, value]);
        setDraft("");
      };
      return (
        <div>
          {items.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {items.map((item, i) => (
                <span key={`${item}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs">
                  {item}
                  <button type="button" aria-label={`Remove ${item}`}
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                    className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive">x</button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <input type="text" value={draft} placeholder={placeholder} className={cn(inputClass, "flex-1")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <button type="button" onClick={add} disabled={!draft.trim()}
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-30">
              Add
            </button>
          </div>
        </div>
      );
    }
    ```
  - `components/images/prompt-editor.tsx`: `{ positive, negative, onPositiveChange, onNegativeChange, onCancel, onSubmit, submitLabel, pending }` con el botón Copy; lo usan `scene-image` y `image-lightbox`. `hooks/use-copied-flag.ts`: `const [copied, copy] = useCopiedFlag(); copy(text)` (clipboard + flag que vuelve a `false` a los 1.5 s; es un timer de UI, no de datos).
  - `hooks/use-focus-trap.ts`: el efecto de `image-lightbox.tsx:74-96`.
  - `lib/constants.ts`: `GENRE_CLASS: Record<Genre, string>` con los cinco literales (`"genre-fantasy"`, …; literales y no `` `genre-${g}` `` para que Tailwind los vea al escanear `lib/`), `TRIGGER_LABELS` y `TRIGGER_SHORT_LABELS` (`Record<TriggerType, string>`, los dos sets actuales), `IMAGE_STYLE_LABELS` (desde `campaign-form.tsx:9-22`), `SESSION_STATUS_LABELS: Record<SessionStatus, string> = { active: "active", completed: "ended" }` y `optionLabel(options, value)` para reemplazar `genreLabel`/`toneLabel`/`difficultyLabel` (`[campaignId]/page.tsx:29-32`).
  - `dashboard/page.tsx` usa `timeAgo` de `lib/utils` (fecha vieja pasa a formato `en-US`, igual que el resto de la app).
- [ ] **Partición** (meta ≤ 250 líneas cada archivo resultante; ninguno > 300):

  | Archivo | Sale a |
  |---|---|
  | `campaign-form.tsx` | `StringListEditor` (stats, plot hooks), `components/campaigns/quick-actions-editor.tsx` (`{ actions, onChange }`), `components/campaigns/image-settings-fields.tsx` (`{ enabled, style, on…Change }`) |
  | `character-form.tsx` | `components/characters/appearance-fields.tsx` (`{ value: Appearance, onChange }`), `components/characters/stats-editor.tsx` (`{ stats, statDefinitions, onChange }`, con el clamp 1–30), inventario con `StringListEditor allowDuplicates` |
  | `[campaignId]/page.tsx` | `components/campaigns/detail/campaign-header.tsx`, `characters-section.tsx`, `sessions-section.tsx` (con el botón New y su error), `journal-section.tsx` |
  | `chat-container.tsx` | `components/chat/chat-toolbar.tsx` (header mobile, barra de galería y End Session desktop), `components/chat/chat-banners.tsx` (sesión terminada, error, aviso de ilustración, dado pendiente), `components/chat/character-panel.tsx` (sidebar, placeholder sin personaje y drawer) |
  | `npcs/page.tsx` | `components/npcs/npc-card.tsx` (+ secciones), `components/npcs/disposition-bar.tsx` |
  | `scene-image.tsx` | `components/chat/scene-image-progress.tsx` (`{ progress, phase }`), `PromptEditor`, `useCopiedFlag` |
  | `image-lightbox.tsx` | `components/gallery/lightbox-context.tsx` (panel del `contextSnapshot`), `PromptEditor`, `useFocusTrap`, `useCopiedFlag` |

- [ ] **Fixes que entran acá:**
  - `QuickActions` recibe `disabled={isDisabled}` (hoy `isSending`, `chat-container.tsx:366`): durante `isProcessing` un quick action choca con el lock.
  - `npcs/page.tsx`: borrar `NpcMemory`/`Relationship`/`MemoryLogEntry` (`:23-41`) y el cast de `:341`; `NpcCard` recibe `NPCMemoryDoc` de `@/types`. Si `typecheck` marca diferencias (nullables), corregir el render, no castear.
  - `statusLabel` (`[campaignId]/page.tsx:32`) → `SESSION_STATUS_LABELS`.
- [ ] Verificar: `find app components -name "*.tsx" | xargs wc -l | sort -n | tail -5` (nada > 300); `grep -rn "genre-fantasy" app components` vacío; `grep -rn "function timeAgo" app components` vacío. Commit `refactor(ui): split oversized components; shared list editor, prompt editor and label maps`.

---

### Task 4.10: `export const dynamic`, docs y cierre

**Problema:** 12 archivos `"use client"` exportan `dynamic = "force-dynamic"` (`grep -rn "export const dynamic" app`). Da igual si Next lo lee en un módulo cliente: `app/layout.tsx:7` (server component) ya lo exporta y un segmento dinámico hace dinámicas a todas las rutas debajo. CLAUDE.md:65 y ARCHITECTURE.md:188 lo documentan como convención.

**Decisión:** se deja **solo** en `app/layout.tsx` y se saca de los archivos `"use client"`. Convención nueva: "pages are `"use client"`; dynamic rendering is forced once in the root layout (server component); don't export route segment config from client files".

- [ ] Sacar la línea (y la línea en blanco sobrante) de los 12 archivos. `grep -rn "export const dynamic" app` → solo `app/layout.tsx`. `app/dashboard/layout.tsx` no usa estado ni hooks: sacarle `"use client"` (pasa a server component).
- [ ] **Docs** (el código manda):
  - `CLAUDE.md` `Conventions`: reemplazar la línea de *Client components* por la convención nueva. `Directory map`: sumar `lib/narrative.ts`, `lib/json-scan.ts`, `lib/messages.ts`, `lib/campaign-input.ts`, `lib/character-links.ts`, `hooks/use-session-messages.ts`, `hooks/use-session-opener.ts`, `components/ui/confirm-dialog.tsx`, `server/pipeline/sessionOpener.ts`. *Known gotchas*: "client code never imports `server/` at runtime (`tests/lib/clientBoundary.test.ts` enforces it)"; "the session opener is a hidden user turn built by the server (`metadata.opener`); legacy rows are matched by prefix in `isHiddenOpener`".
  - `ARCHITECTURE.md`: `:41` hooks; `:126` cursor `{ createdAt, id }` y orden `(createdAt desc, id desc)`; `:167` y `:219` el cliente consulta `trpc.images.status` cada 2 s mientras `generating`; `:188` convención de `dynamic`; `:204` sin `mechanic-placeholder`, con `confirm-dialog`; `:218` streaming (frame batching, `done.messageId`); body `{ opener: true }` en la sección de la ruta SSE; `images.illustrate` devuelve `{ status: "started", imageId } | "already_generating" | "no_content" | "unavailable"`.
  - `docs/IMAGE_GENERATION.md:99`: borrar la ruta REST; documentar `images.status`.
- [ ] `docs/superpowers/refactor-progress.md`: fila de la Fase 4 y entrada de log con commits y conteo de tests; anotar qué tareas esperan el chequeo manual del usuario.
- [ ] Commit `chore: route segment config only in the root layout; docs for phase 4`.

---

## Chequeo manual del usuario (browser)

Los implementadores no tienen browser. Con `npm run dev` reiniciado (la Fase 4 no agrega migraciones, pero el server sí cambia), sobre una DB de prueba si se prefiere (`DB_PATH=<copia>`; ver la memoria `sqlite-wal-backups`):

1. **4.2:** editar el nombre y volver → el dashboard y el header muestran el nombre nuevo al instante; crear/editar personaje → la lista de la campaña se actualiza sin recargar; guardar una API key → "key saved" aparece sin recargar; doble click en "New" → una sola sesión.
2. **4.3:** borrar personaje pide confirmación; Escape cierra; cambiar el género al editar pregunta antes de pisar stats.
3. **4.4:** Illustrate → la barra de progreso aparece enseguida; con ComfyUI apagado → aviso "unavailable" en vez de nada; Regenerate/Variation → la imagen nueva reemplaza a la vieja.
4. **4.5:** en una sesión con >60 mensajes, cargar viejos (el viewport no salta), jugar 3 turnos, volver a subir: sin huecos ni repetidos.
5. **4.6:** React DevTools Profiler mientras streamea: por token solo re-renderiza el bubble en streaming; al terminar no hay parpadeo ni mensaje duplicado.
6. **4.7:** sesión nueva → una sola apertura (dev con StrictMode incluido); el prompt `[SESSION START…]` no se ve; sesiones viejas siguen ocultándolo.
   - Reintento del opener: con StrictMode puede aparecer un instante el aviso "already processing" (o "already started"); el opener se reintenta **una sola vez** a los ~2 s y la apertura termina apareciendo. Si falla por otro motivo (p. ej. Ollama caído), no se reintenta en bucle. "Retry" sobre el mensaje de error de una apertura fallida reenvía el mismo texto y sigue oculto (por el prefijo).
7. **4.8:** Network al abrir una sesión: un solo request batcheado a `/api/trpc` con campaña, sesión, personajes y mensajes; URL de sesión inexistente → "Session not found" enseguida (sin esperar reintentos); campaña inexistente → "Campaign not found" enseguida.
8. **4.10 (opcional):** `DB_PATH=<copia> npm run build` lista todas las rutas como dinámicas (ƒ), igual que antes.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La infinite query re-encadena las páginas en cada refetch: tras N turnos, los N mensajes más viejos salen por arriba de la ventana. | Es esperado: "Load older" los trae (el `nextCursor` se recalcula). Si el jugador está scrolleado arriba al terminar un turno puede ver un salto; aceptable. Documentado en el hook. |
| `invalidate({ sessionId })` no matchea la infinite query en tRPC 11. | La key de invalidación usa tipo `any` (matchea ambas). Si el chequeo manual 4 muestra que no refresca, usar `utils.messages.listBySession.invalidate()` sin input. |
| `illustrate` tarda más en contestar (espera health check + `isComfyUIAvailable`). | Son segundos como mucho; el botón ya muestra `isPending`. A cambio, el cliente sabe si la imagen arrancó. |
| El opener server-side cambia el gameplay. | Mismo texto (test de strings exactos), mismo pipeline, mismo primer personaje (misma query sin `ORDER BY`). El clasificador sigue viendo el prefijo. |
| Filas viejas sin `metadata.opener`. | `isHiddenOpener` mantiene el prefijo como fallback legacy; sin migración de datos. |
| Borrar `MechanicPlaceholder` esconde algo útil. | En producción no se renderiza nunca (`streamBeforeMarker` + strip del container). Si un día se streamean markers, el strip suelto de `NarrativeRenderer` los oculta. |
| `requestAnimationFrame` no corre con la pestaña oculta. | El texto se acumula en el ref; `done`/`error` hacen flush sincrónico, así que el estado final es correcto. |
| Sacar `export const dynamic` cambia el prerender. | El root layout (server) lo mantiene y vuelve dinámico todo el árbol; chequeo opcional 8. |
| Partir componentes cambia markup sin querer. | Mover sin reescribir; `git diff --color-moved`; los tests de componentes existentes quedan en verde. |

---

## Apéndice — Correcciones de la revisión del plan (aplican sobre el texto de arriba)

1. **Task 4.6 (`tests/server/chatRoute.test.ts`):** la aserción existente `toContain('data: {"type":"done","text":"Hi there"}')` deja de valer si el mock pasa `messageId`. Actualizarla al nuevo formato (`..."text":"Hi there","messageId":"m1"}`) o dejar ese mock sin `messageId` y agregar un caso aparte.
2. **Task 4.6, Files:** agregar `lib/messages.ts` a Modify (se suma `isHiddenOpener` al archivo creado en 4.5).
3. **Task 4.3 (`ConfirmDialog` de terminar sesión):** no cerrar el diálogo en `handleEndSession` antes de mutar. Cerrarlo en `onSuccess`; ante un error, mostrar el banner y cerrar. Así `pending`/"Ending..." se ven.
4. **Task 4.8:** `sessions.get` (y el `campaigns.get` del layout) con `retry: false`, o en el provider `retry: (n, e) => e?.data?.code !== "NOT_FOUND" && n < 3`, para que "Session not found" aparezca enseguida y no después de unos 7 s de reintentos.
5. **Task 4.7 (opener):** si el opener vuelve con `ok:false` sin abort y el error es "already processing" o un 409 (por ejemplo, un remount de StrictMode mientras el primer request todavía tiene el lock), reintentar una sola vez después de unos 2 s. Agregarlo también a la checklist manual.
6. **Recomendaciones:**
   - `refetchOnWindowFocus: false` en `useSessionMessages`, para no refetchear todas las páginas.
   - En la checklist manual, aclarar que el indicador de streaming puede seguir visible un instante después de `done`, hasta que llega el refetch.
   - En el test de boundary, un comentario: el regex marcaría también `import { type X } from "@/server/…"`; hay que usar `import type`.
