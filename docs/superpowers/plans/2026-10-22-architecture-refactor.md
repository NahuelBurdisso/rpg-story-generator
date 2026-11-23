# Roadmap de refactor de arquitectura — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un turno de juego sea correcto bajo concurrencia, robusto ante fallas y cancelaciones, y que el código quede dividido en unidades testeables, sin cambiar el producto.

**Architecture:** Se mantiene el stack (Next 15 + tRPC + Drizzle/SQLite + SSE + Ollama/ComfyUI). Primero se arregla la correctitud de datos (lock atómico, cola de fondo por sesión, transacciones, migraciones reales). Después vienen la robustez (cancelación, retries idempotentes, recuperación de jobs) y la estructura (capas repo/service, `runPipeline` dividido en etapas, tipos derivados del schema). Frontend y tooling al final; esas fases se pueden correr en paralelo.

**Tech Stack:** TypeScript strict, Next.js 15, tRPC 11, Drizzle ORM 0.45 + better-sqlite3 12, Vitest 2, TanStack Query 5.

**Origen:** auditoría de arquitectura del 2026-10-22. Los hallazgos citados con `archivo:línea` se verificaron contra el código en esa fecha.

---

## Cómo leer este plan

- **Fase 1 (correctitud)** está detallada paso a paso, con TDD y código completo. Se ejecuta tal cual.
- **Fases 2–5** están a nivel tarea: archivos, enfoque y criterio de aceptación. Cuando arranque cada fase, se escribe su plan detallado en un archivo propio (`2026-xx-xx-refactor-phase-N.md`), porque el código ya va a haber cambiado.
- **Orden:** 1 → 2 → 3. Las fases 4 (frontend) y 5 (tooling) no tocan `server/pipeline` y pueden ir en paralelo con la 2 o la 3. Excepción: la tarea 5.1 (renombrar tests) conviene hacerla antes de la 3.
- **Una rama por fase:** `refactor/phase-N-<tema>`. Un commit por tarea. Merge a `master` al cerrar cada fase con tests, typecheck y lint en verde.

## Decisiones de diseño (aplican a todo el plan)

1. **Sin infraestructura nueva.** Nada de Redis, colas externas ni workers. Es una app local, single-user y de un solo proceso. Las colas y los locks en memoria del proceso alcanzan, junto con un lock en DB para requests concurrentes.
2. **Las transacciones son síncronas.** Con better-sqlite3, `db.transaction(cb)` exige un `cb` síncrono (si devuelve una promesa, tira error). Patrón obligatorio: primero todo lo async (LLM, lecturas), después **un** bloque síncrono que escribe todo con `.run()`, `.get()` o `.all()`.
3. **Los turnos se serializan por sesión.** El turno N+1 espera a que termine la extracción de fondo del turno N (step3) antes de leer `storyState`. Costo: si el jugador responde antes de que termine step3, el primer token tarda un poco más. Es aceptable: lo normal es que el jugador tarde 10–30 s en escribir.
4. **Las migraciones son la fuente de verdad del schema.** Se corren solas al abrir la DB. `drizzle-kit push` deja de usarse.
5. **Los tests nunca tocan `data/rpg.db`.** `DB_PATH=:memory:` se fuerza en vitest, salvo con `PLAY_LOOP=1`.

---

# FASE 1 — Correctitud de datos

**Rama:** `refactor/phase-1-correctness`

**Problemas que resuelve:**

| # | Problema | Dónde |
|---|---|---|
| A | El lock de turno escribe sin chequear. Dos POST corren dos turnos a la vez. | `server/pipeline/orchestrator.ts:78-81` |
| B | El lock se libera antes de que termine step3. El turno N+1 pisa `storyState` y `consequenceSeeds` del turno N. | `orchestrator.ts:657-660`, `:633-636` |
| C | No hay transacciones. Un turno son entre 15 y 30 writes sueltos. | todo `orchestrator.ts` |
| D | Las migraciones existen pero nunca se corren. Un clone limpio queda con la DB vacía. | `server/db/index.ts` |
| E | El índice de NPC no es `UNIQUE`, así que `onConflictDoNothing` no deduplica. | `server/db/schema.ts:143`, `orchestrator.ts:853` |
| F | `lastAssistantMessages` toma los 3 mensajes **más viejos**. | `orchestrator.ts:115-118` |
| G | El summary marca como resumidos mensajes que nunca resumió. | `orchestrator.ts:926`, `:953` |
| H | El pipeline ignora `maxContextMessages` (usa 14 fijo). | `orchestrator.ts:110` |
| I | Los unit tests abren la DB real. | `tests/convex/deduplicateContent.test.ts:2` |

## Estructura de archivos (Fase 1)

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `server/db/open.ts` | Crear | Abrir SQLite, pragmas, baseline de DB legacy y `migrate()`. Exporta los tipos `DB`, `Tx` y `DbOrTx`. |
| `server/db/index.ts` | Modificar | Singleton `db = openDatabase(DB_PATH)`. |
| `scripts/check-schema-drift.mjs` | Crear | Compara la DB viva contra una DB fresca construida desde `./drizzle`. |
| `server/pipeline/sessionLock.ts` | Crear | `tryAcquireSessionLock` / `releaseSessionLock` atómicos. |
| `server/pipeline/backgroundQueue.ts` | Crear | Colas de promesas por clave (serializan step3, summary y journal). |
| `server/pipeline/turnCommit.ts` | Crear | Escrituras del turno en transacción: `commitTurn`, `commitTurnState`, `applyStateUpdate`, `applyDiceDamage`, `applyNpcUpdates`, `assignThreadOwners`. |
| `server/pipeline/utils.ts` | Modificar | Se agregan `lastAssistantContents`, `nextSummaryWindow`, `historyLimit` y `deduplicateContent` (movida). |
| `server/pipeline/orchestrator.ts` | Modificar | Conecta todo lo anterior y borra los helpers que se movieron. |
| `server/routers/sessions.ts` | Modificar | `endSession` espera las colas antes de cerrar la sesión. |
| `tests/helpers/testDb.ts` | Crear | DB en memoria con migraciones, más seeds. |
| `tests/server/db/open.test.ts` | Crear | Tests de bootstrap y baseline. |
| `tests/pipeline/sessionLock.test.ts` | Crear | |
| `tests/pipeline/backgroundQueue.test.ts` | Crear | |
| `tests/pipeline/turnCommit.test.ts` | Crear | |
| `tests/pipeline/turnUtils.test.ts` | Crear | |
| `vitest.config.mts` | Modificar | `env.DB_PATH = ":memory:"`. |
| `package.json` | Modificar | Script `typecheck`. |
| `CLAUDE.md` | Modificar | Comandos de migraciones y gotchas actualizados. |

---

### Task 1.0: Preparación

**Files:** `package.json`

- [ ] **Paso 1: Resolver el WIP actual.** Hay unos 30 archivos modificados sin commitear en `master` (imagen, pipeline, tests). **El usuario decide** si se commitean, se stashean o van a otra rama. No se toca nada hasta que el working tree esté limpio:

```bash
git status --short
```
Esperado: salida vacía.

- [ ] **Paso 2: Crear la rama.**

```bash
git checkout -b refactor/phase-1-correctness
```

- [ ] **Paso 3: Agregar el script `typecheck`.** En `package.json`, dentro de `"scripts"`, después de `"test:watch"`:

```json
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
```

- [ ] **Paso 4: Tomar la línea de base.**

```bash
npm run typecheck && npm run lint && npm test
```
Esperado: 0 errores de tsc, lint limpio, 480 tests pasan y 4 se saltean (los scripts PLAY_LOOP).

- [ ] **Paso 5: Commit.**

```bash
git add package.json
git commit -m "chore: add typecheck script"
```

---

### Task 1.1: Bootstrap de DB con migraciones reales (problemas D e I)

**Files:**
- Create: `server/db/open.ts`
- Modify: `server/db/index.ts` (archivo completo)
- Create: `scripts/check-schema-drift.mjs`
- Create: `tests/helpers/testDb.ts`
- Create: `tests/server/db/open.test.ts`
- Modify: `vitest.config.mts`

**Contexto:** la DB viva (`data/rpg.db`) se creó con `drizzle-kit push`. Tiene todas las tablas pero no tiene `__drizzle_migrations`. Si se le corre `migrate()` tal cual, intenta `CREATE TABLE` sobre tablas existentes y falla. Solución: un *baseline*. Si la DB tiene tablas pero no tiene journal, se registran como aplicadas las migraciones hasta `0003_aromatic_the_initiative`, que es la última que refleja `push`. **No** se registran migraciones posteriores: esas sí se tienen que correr. El drizzle migrator de SQLite aplica toda migración cuyo `folderMillis` sea mayor que el `created_at` más reciente del journal.

- [ ] **Paso 1: Verificar que la DB viva y las migraciones son equivalentes.** Crear `scripts/check-schema-drift.mjs`:

```js
// Compares the live DB schema against a fresh DB built from ./drizzle migrations.
// Usage: node scripts/check-schema-drift.mjs [path/to/db]
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const livePath = process.argv[2] ?? "data/rpg.db";
const fresh = new Database(":memory:");
migrate(drizzle(fresh), { migrationsFolder: "drizzle" });
const live = new Database(livePath, { readonly: true });

function describeSchema(db) {
  const out = {};
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
    .all();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all()
      .map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`).sort();
    const idx = db.prepare(`PRAGMA index_list("${name}")`).all()
      .filter((i) => i.origin === "c")
      .map((i) => `${i.name}:${i.unique}:` + db.prepare(`PRAGMA index_info("${i.name}")`).all().map((c) => c.name).join(","))
      .sort();
    const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all()
      .map((f) => `${f.from}->${f.table}.${f.to}:${f.on_delete}`).sort();
    out[name] = { cols, idx, fks };
  }
  return out;
}

const a = describeSchema(fresh);
const b = describeSchema(live);
let drift = 0;
for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
  for (const k of ["cols", "idx", "fks"]) {
    const x = JSON.stringify(a[t]?.[k]);
    const y = JSON.stringify(b[t]?.[k]);
    if (x !== y) {
      drift++;
      console.log(`DRIFT ${t}.${k}\n  migrations: ${x}\n  live:       ${y}`);
    }
  }
}
console.log(drift ? `${drift} difference(s)` : "No drift");
process.exit(drift ? 1 : 0);
```

Correr:

```bash
node scripts/check-schema-drift.mjs
```
Esperado: `No drift`. **Si hay drift, PARAR** y mostrarle el output al usuario. El baseline asume que la DB viva coincide con 0003; si no coincide, primero hay que generar una migración que cubra la diferencia.

- [ ] **Paso 2: Escribir los tests que fallan.** Crear `tests/server/db/open.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase, baselineLegacyDatabase, LEGACY_BASELINE_MILLIS } from "@/server/db/open";
import { sessions } from "@/server/db/schema";

/** A file DB shaped like one made by `drizzle-kit push`: all tables up to 0003, no journal. */
function legacyDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "rpg-legacy-"));
  const migDir = join(dir, "drizzle");
  cpSync("drizzle", migDir, { recursive: true });
  const journalPath = join(migDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { when: number }) => e.when <= LEGACY_BASELINE_MILLIS);
  writeFileSync(journalPath, JSON.stringify(journal));
  const file = join(dir, "legacy.db");
  const sqlite = new Database(file);
  migrate(drizzle(sqlite), { migrationsFolder: migDir });
  sqlite.exec(`DROP TABLE "__drizzle_migrations"`);
  sqlite.close();
  return file;
}

describe("openDatabase", () => {
  it("creates every table on an empty database", () => {
    const db = openDatabase(":memory:");
    expect(db.select().from(sessions).all()).toEqual([]);
  });

  it("opens a push-created database without re-creating its tables", () => {
    const file = legacyDbFile();
    expect(() => openDatabase(file)).not.toThrow();
    const check = new Database(file, { readonly: true });
    const rows = check.prepare(`SELECT created_at FROM "__drizzle_migrations"`).all() as { created_at: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    check.close();
  });
});

describe("baselineLegacyDatabase", () => {
  it("does nothing on an empty database", () => {
    expect(baselineLegacyDatabase(new Database(":memory:"))).toBe(false);
  });

  it("records only the pre-cutoff migrations on a push-created database", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE sessions (id text primary key)`);
    expect(baselineLegacyDatabase(sqlite)).toBe(true);
    const rows = sqlite.prepare(`SELECT created_at FROM "__drizzle_migrations"`).all() as { created_at: number }[];
    expect(rows.length).toBe(4);
    expect(Math.max(...rows.map((r) => Number(r.created_at)))).toBe(LEGACY_BASELINE_MILLIS);
  });

  it("is a no-op once the journal exists", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE sessions (id text primary key)`);
    baselineLegacyDatabase(sqlite);
    expect(baselineLegacyDatabase(sqlite)).toBe(false);
  });
});
```

- [ ] **Paso 3: Correr los tests y confirmar que fallan.**

```bash
npx vitest run tests/server/db/open.test.ts
```
Esperado: FAIL, con `Failed to resolve import "@/server/db/open"`.

- [ ] **Paso 4: Implementar `server/db/open.ts`.**

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { join } from "path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

/** `when` of 0003_aromatic_the_initiative — the last migration the push-era DB already reflects. */
export const LEGACY_BASELINE_MILLIS = 1780498372476;

/**
 * Databases created with `drizzle-kit push` have every table but no migrations
 * journal, so `migrate()` would try to re-create them. Record the push-era
 * migrations as applied; anything newer still runs.
 */
export function baselineLegacyDatabase(sqlite: Database.Database, migrationsFolder = MIGRATIONS_FOLDER): boolean {
  const hasTable = (name: string) =>
    !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (hasTable("__drizzle_migrations") || !hasTable("sessions")) return false;

  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const insert = sqlite.prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`);
  for (const m of readMigrationFiles({ migrationsFolder })) {
    if (m.folderMillis <= LEGACY_BASELINE_MILLIS) insert.run(m.hash, m.folderMillis);
  }
  return true;
}

export function openDatabase(path: string, migrationsFolder = MIGRATIONS_FOLDER): DB {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  baselineLegacyDatabase(sqlite, migrationsFolder);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
```

- [ ] **Paso 5: Reemplazar `server/db/index.ts` completo.**

```ts
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { openDatabase } from "./open";

export type { DB, Tx, DbOrTx } from "./open";

const dbPath = process.env.DB_PATH ?? join(process.cwd(), "data", "rpg.db");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

export const db = openDatabase(dbPath);
```

- [ ] **Paso 6: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/server/db/open.test.ts
```
Esperado: PASS (5 tests).

- [ ] **Paso 7: Proteger la DB real en vitest.** En `vitest.config.mts`, dentro de `test: { ... }`, agregar debajo de `globals: true,`:

```ts
    // Unit tests must never open data/rpg.db. PLAY_LOOP e2e scripts opt out.
    env: process.env.PLAY_LOOP ? {} : { DB_PATH: ":memory:" },
```

- [ ] **Paso 8: Crear el helper `tests/helpers/testDb.ts`.**

```ts
import { openDatabase, type DB } from "@/server/db/open";
import { campaigns, characters, sessions } from "@/server/db/schema";

export function createTestDb(): DB {
  return openDatabase(":memory:");
}

export function seedSession(db: DB) {
  const campaign = db.insert(campaigns)
    .values({ name: "Test", genre: "fantasy", tone: "serious", difficulty: "normal" })
    .returning().get();
  const session = db.insert(sessions).values({ campaignId: campaign.id, title: "S1" }).returning().get();
  return { campaign, session };
}

export function seedCharacter(db: DB, campaignId: string, over: Partial<typeof characters.$inferInsert> = {}) {
  return db.insert(characters)
    .values({ campaignId, name: "Aria", role: "rogue", backstory: "", stats: { HP: 10, MaxHP: 10 }, inventory: [], ...over })
    .returning().get();
}
```

- [ ] **Paso 9: Verificar contra una copia de la DB real** (nunca contra la original). Se abre la copia explícitamente con `openDatabase`, que baselinea y migra, y después se chequea el drift. Ojo: vitest fuerza `DB_PATH=:memory:`, así que la copia no se puede verificar desde vitest.

```bash
COPY="$(mktemp -d)/rpg-copy.db" && cp data/rpg.db "$COPY" && npx tsx -e "import('./server/db/open').then((m) => m.openDatabase(process.argv[1]))" "$COPY" && node scripts/check-schema-drift.mjs "$COPY"
```
Esperado: sin errores y `No drift`.

- [ ] **Paso 9b: Backup antes del primer arranque real.** El primer `npm run dev` baselinea `data/rpg.db` (la original):

```bash
cp data/rpg.db data/rpg.backup-pre-migrations.db
```
Después levantar `npm run dev`, abrir una campaña existente y confirmar que carga.

- [ ] **Paso 10: Suite completa y commit.**

```bash
npm test && npm run typecheck
git add server/db/open.ts server/db/index.ts scripts/check-schema-drift.mjs tests/helpers/testDb.ts tests/server/db/open.test.ts vitest.config.mts
git commit -m "feat(db): run migrations at boot, baseline push-era databases"
```

---

### Task 1.2: Nombre de NPC único por campaña (problema E)

**Files:**
- Modify: `server/db/schema.ts:1` (import) y `:141-144` (índices de `npcMemory`)
- Create: `drizzle/0004_*.sql` (generado)
- Test: `tests/server/db/open.test.ts` (se agrega un caso)

- [ ] **Paso 1: Confirmar que no hay duplicados** (la creación del índice fallaría si los hay):

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/rpg.db',{readonly:true});console.log(db.prepare('select campaign_id, lower(trim(name)) n, count(*) c from npc_memory group by 1,2 having c>1').all())"
```
Esperado: `[]` (al 2026-10-22 da `[]`). Si aparecen duplicados, PARAR y preguntarle al usuario cuál conservar.

- [ ] **Paso 2: Escribir el test que falla.** Agregar a `tests/server/db/open.test.ts`:

(Fusionar `npcMemory` y `campaigns` en el import existente de `@/server/db/schema`, arriba del archivo: `import { sessions, npcMemory, campaigns } from "@/server/db/schema";`.)

```ts
describe("npc_memory uniqueness", () => {
  it("ignores a second NPC whose name differs only by case or whitespace", () => {
    const db = openDatabase(":memory:");
    const c = db.insert(campaigns).values({ name: "T", genre: "fantasy", tone: "serious", difficulty: "normal" }).returning().get();
    const base = { campaignId: c.id, personality: "", location: "", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "" };
    db.insert(npcMemory).values({ ...base, name: "Mara" }).onConflictDoNothing().run();
    db.insert(npcMemory).values({ ...base, name: " mara " }).onConflictDoNothing().run();
    expect(db.select().from(npcMemory).all()).toHaveLength(1);
  });
});
```

```bash
npx vitest run tests/server/db/open.test.ts -t "uniqueness"
```
Esperado: FAIL, con `expected [ …2 items… ] to have a length of 1`.

- [ ] **Paso 3: Declarar el índice en el schema.** En `server/db/schema.ts:1`:

```ts
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql, type InferSelectModel } from "drizzle-orm";
```
(se reemplaza la línea `import type { InferSelectModel } from "drizzle-orm";`). En los índices de `npcMemory`:

```ts
}, (table) => [
  index("idx_npc_memory_campaign").on(table.campaignId),
  index("idx_npc_memory_campaign_name").on(table.campaignId, table.name),
  uniqueIndex("uq_npc_memory_campaign_lname").on(table.campaignId, sql`lower(trim(name))`),
]);
```

- [ ] **Paso 4: Generar la migración.**

```bash
npx drizzle-kit generate --name npc_unique_name
```
Revisar el `.sql` generado. Tiene que contener exactamente:
```sql
CREATE UNIQUE INDEX `uq_npc_memory_campaign_lname` ON `npc_memory` (`campaign_id`,lower(trim(name)));
```
Si drizzle-kit emite la expresión mal (por ejemplo con el nombre de columna calificado), borrar ese archivo, correr `npx drizzle-kit generate --custom --name npc_unique_name` y pegar la línea de arriba a mano.

- [ ] **Paso 5: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/server/db/open.test.ts
```
Esperado: PASS. El test "push-created database" ahora también aplica 0004 encima del baseline.

- [ ] **Paso 6: Verificar la migración sobre una copia de la DB real.**

```bash
COPY="$(mktemp -d)/rpg-copy.db" && cp data/rpg.db "$COPY" && npx tsx -e "import('./server/db/open').then((m) => m.openDatabase(process.argv[1]))" "$COPY" && node scripts/check-schema-drift.mjs "$COPY"
```
Esperado: `No drift`. La copia queda con el índice nuevo aplicado encima del baseline.

- [ ] **Paso 7: Commit.**

```bash
git add server/db/schema.ts drizzle/ tests/server/db/open.test.ts
git commit -m "fix(db): unique NPC name per campaign (case/space-insensitive)"
```

---

### Task 1.3: Lock de sesión atómico (problema A)

**Files:**
- Create: `server/pipeline/sessionLock.ts`
- Test: `tests/pipeline/sessionLock.test.ts`
- Modify: `server/pipeline/orchestrator.ts:76-81` y `:656-661`

- [ ] **Paso 1: Escribir el test que falla.** Crear `tests/pipeline/sessionLock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedSession } from "../helpers/testDb";
import { tryAcquireSessionLock, releaseSessionLock, SESSION_LOCK_STALE_MS } from "@/server/pipeline/sessionLock";

describe("session lock", () => {
  it("lets exactly one caller in until released", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    expect(tryAcquireSessionLock(db, session.id, 1_000)).toBe(true);
    expect(tryAcquireSessionLock(db, session.id, 1_001)).toBe(false);
    releaseSessionLock(db, session.id);
    expect(tryAcquireSessionLock(db, session.id, 1_002)).toBe(true);
  });

  it("takes over a stale lock left by a crashed turn", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    tryAcquireSessionLock(db, session.id, 1_000);
    expect(tryAcquireSessionLock(db, session.id, 1_000 + SESSION_LOCK_STALE_MS + 1)).toBe(true);
  });

  it("refuses an unknown session", () => {
    const db = createTestDb();
    expect(tryAcquireSessionLock(db, "nope")).toBe(false);
  });
});
```

```bash
npx vitest run tests/pipeline/sessionLock.test.ts
```
Esperado: FAIL, con `Failed to resolve import "@/server/pipeline/sessionLock"`.

- [ ] **Paso 2: Implementar `server/pipeline/sessionLock.ts`.**

```ts
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { sessions } from "../db/schema";

/** A turn holding the lock longer than this is presumed crashed. */
export const SESSION_LOCK_STALE_MS = 180_000;

/**
 * Claim the session for one turn. A single conditional UPDATE, so two
 * concurrent requests can never both win.
 */
export function tryAcquireSessionLock(db: DbOrTx, sessionId: string, now = Date.now()): boolean {
  const claimed = db
    .update(sessions)
    .set({ processingStartedAt: now })
    .where(and(
      eq(sessions.id, sessionId),
      or(isNull(sessions.processingStartedAt), lt(sessions.processingStartedAt, now - SESSION_LOCK_STALE_MS)),
    ))
    .returning({ id: sessions.id })
    .all();
  return claimed.length > 0;
}

export function releaseSessionLock(db: DbOrTx, sessionId: string): void {
  db.update(sessions).set({ processingStartedAt: null }).where(eq(sessions.id, sessionId)).run();
}

/** Re-stamp a lock we hold, e.g. after a long wait, so it isn't taken as stale. */
export function refreshSessionLock(db: DbOrTx, sessionId: string, now = Date.now()): void {
  db.update(sessions).set({ processingStartedAt: now }).where(eq(sessions.id, sessionId)).run();
}
```

- [ ] **Paso 3: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/pipeline/sessionLock.test.ts
```
Esperado: PASS (3 tests).

- [ ] **Paso 4: Conectarlo en `runPipeline`.** El lock se toma **antes** del `try`, para que el `finally` no libere un lock ajeno. Reemplazar `orchestrator.ts:76-81`:

```ts
  try {
    // Set processing guard
    await db
      .update(sessions)
      .set({ processingStartedAt: Date.now() })
      .where(eq(sessions.id, sessionId));
```
por:

```ts
  if (!tryAcquireSessionLock(db, sessionId)) {
    onError("This session is already processing a turn — wait for it to finish.");
    return;
  }

  try {
```
Y reemplazar el `finally` (`:656-661`):

```ts
  } finally {
    await db
      .update(sessions)
      .set({ processingStartedAt: null })
      .where(eq(sessions.id, sessionId));
  }
```
por:

```ts
  } finally {
    releaseSessionLock(db, sessionId);
  }
```
Agregar el import: `import { tryAcquireSessionLock, releaseSessionLock } from "./sessionLock";`

- [ ] **Paso 5: Suite completa y commit.**

```bash
npm test && npm run typecheck
git add server/pipeline/sessionLock.ts tests/pipeline/sessionLock.test.ts server/pipeline/orchestrator.ts
git commit -m "fix(pipeline): atomic per-session turn lock"
```

---

### Task 1.4: Cola de fondo por sesión (problema B)

**Files:**
- Create: `server/pipeline/backgroundQueue.ts`
- Test: `tests/pipeline/backgroundQueue.test.ts`
- Modify: `server/pipeline/orchestrator.ts` (inicio del `try`, step3 `:515-644`, summary/journal `:646-650`)
- Modify: `server/routers/sessions.ts` (`endSession`)

- [ ] **Paso 1: Escribir el test que falla.** Crear `tests/pipeline/backgroundQueue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { enqueueBackground, waitForBackground } from "@/server/pipeline/backgroundQueue";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("backgroundQueue", () => {
  it("runs jobs on one key in submission order, one at a time", async () => {
    const log: string[] = [];
    enqueueBackground("k1", async () => { log.push("a:start"); await tick(); log.push("a:end"); });
    enqueueBackground("k1", async () => { log.push("b:start"); log.push("b:end"); });
    await waitForBackground("k1");
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("keeps going after a failing job and logs it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: string[] = [];
    enqueueBackground("k2", async () => { throw new Error("boom"); });
    enqueueBackground("k2", async () => { ran.push("next"); });
    await waitForBackground("k2");
    expect(ran).toEqual(["next"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("resolves immediately for an idle key", async () => {
    await expect(waitForBackground("idle")).resolves.toBeUndefined();
  });

  it("does not make one key wait for another", async () => {
    let release!: () => void;
    enqueueBackground("slow", () => new Promise<void>((r) => { release = r; }));
    let fastDone = false;
    enqueueBackground("fast", async () => { fastDone = true; });
    await waitForBackground("fast");
    expect(fastDone).toBe(true);
    release();
    await waitForBackground("slow");
  });
});
```

```bash
npx vitest run tests/pipeline/backgroundQueue.test.ts
```
Esperado: FAIL, con `Failed to resolve import`.

- [ ] **Paso 2: Implementar `server/pipeline/backgroundQueue.ts`.**

```ts
/**
 * Per-key promise chains for post-turn work. Jobs on one key run one at a
 * time in submission order; a failing job is logged and never blocks the
 * next. In-process only — fine for this single-process, single-user server.
 * Kept on globalThis so Next dev HMR doesn't drop in-flight chains.
 */
const g = globalThis as typeof globalThis & { __rpgBackgroundTails?: Map<string, Promise<void>> };
const tails = (g.__rpgBackgroundTails ??= new Map<string, Promise<void>>());

export function enqueueBackground(key: string, job: () => Promise<void>): Promise<void> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(job).catch((err: unknown) => {
    console.error(`[background:${key}]`, err);
  });
  tails.set(key, next);
  void next.then(() => {
    if (tails.get(key) === next) tails.delete(key);
  });
  return next;
}

/** Resolves once every job queued on `key` so far has settled. */
export function waitForBackground(key: string): Promise<void> {
  return tails.get(key) ?? Promise.resolve();
}

/** Step 3 (extraction → storyState/seeds/NPCs). The next turn waits on this. */
export const turnStateKey = (sessionId: string) => `${sessionId}:state`;
/** Rolling summary + campaign journal. Serialized, but turns don't wait on it. */
export const sessionAuxKey = (sessionId: string) => `${sessionId}:aux`;
```

- [ ] **Paso 3: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/pipeline/backgroundQueue.test.ts
```
Esperado: PASS (4 tests).

- [ ] **Paso 4: El turno espera el step3 del turno anterior.** En `orchestrator.ts`, primera línea dentro del `try` (antes de `// Store user message`):

```ts
    // The previous turn's extraction must land before we read storyState/seeds.
    await waitForBackground(turnStateKey(sessionId));
    // That wait can be long; re-stamp so a third request can't take the lock as stale.
    refreshSessionLock(db, sessionId);
```
Agregar `refreshSessionLock` al import de `./sessionLock`.

> Orden deliberado: primero el lock y después la espera. Si se esperara antes del lock, otro request podría completar un turno entero (y encolar su step3) entre la espera y el lock, y este turno leería estado viejo.

- [ ] **Paso 5: Encolar step3, el summary y el journal.** Se hace junto con la Task 1.5, paso 7, que reescribe ese bloque completo. Este paso solo agrega el import:

```ts
import { enqueueBackground, waitForBackground, turnStateKey, sessionAuxKey } from "./backgroundQueue";
```

- [ ] **Paso 6: `endSession` espera las colas.** En `server/routers/sessions.ts`, dentro de `endSession`, como primera línea del handler, antes de leer la sesión:

```ts
      // Let the last turn's extraction and summary land before closing the session.
      await waitForBackground(turnStateKey(input.sessionId));
      await waitForBackground(sessionAuxKey(input.sessionId));
```
Reemplazar también la llamada final:

```ts
      updateCampaignJournal(session.campaignId, session.id, llmConfig, events).catch(() => {});
```
por:

```ts
      enqueueBackground(sessionAuxKey(session.id), () =>
        updateCampaignJournal(session.campaignId, session.id, llmConfig, events));
```
Import: `import { enqueueBackground, waitForBackground, turnStateKey, sessionAuxKey } from "../pipeline/backgroundQueue";`

- [ ] **Paso 7: Commit** (después de la Task 1.5, paso 7, para que el orchestrator compile entero). Ver Task 1.5, paso 9.

---

### Task 1.5: Escrituras del turno en transacción (problema C)

**Files:**
- Create: `server/pipeline/turnCommit.ts`
- Test: `tests/pipeline/turnCommit.test.ts`
- Modify: `server/pipeline/orchestrator.ts`: trivial path `:178-198`, main commit `:463-488`, step3 `:503-650`. Se borran `applyStateUpdate` (`:668-712`), `applyDiceDamage` (`:714-771`) y `applyNpcUpdatesFromExtraction` (`:777-856`).

**Invariante HP (CLAUDE.md):** STATE_UPDATE `statChanges` se aplica primero; después el daño de dados **relee** el personaje y descuenta sobre el valor fresco. Dentro de la transacción, la relectura ve el write anterior. Se preserva. (Nota: CLAUDE.md menciona `hasDamageForThisChar`, que ya no existe en el código; se corrige en la Task 1.8.)

- [ ] **Paso 1: Escribir los tests que fallan.** Crear `tests/pipeline/turnCommit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedSession, seedCharacter } from "../helpers/testDb";
import { characters, messages, sessions, npcMemory } from "@/server/db/schema";
import { commitTurn, commitTurnState, assignThreadOwners } from "@/server/pipeline/turnCommit";
import { coldStartState } from "@/server/pipeline/director";
import type { MechanicMarker, Resolution } from "@/types";

const damageMarker = (narratorDraft: string): MechanicMarker => ({
  index: 0, startIndex: narratorDraft.indexOf("[MECH"), endIndex: narratorDraft.length,
  fullMatch: "[MECHANIC:damage:1d6]", type: "damage", params: { dice: "1d6" },
});
const roll = (total: number): Resolution => ({ index: 0, roll: [total], modifier: 0, total, description: "" });

describe("commitTurn", () => {
  it("stores the assistant message and clamps HP from STATE_UPDATE", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    const id = commitTurn(db, {
      sessionId: session.id, campaignId: campaign.id, content: "Hecho.", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -15 } } } }, damage: null,
    });
    expect(db.select().from(messages).where(eq(messages.id, id)).get()?.content).toBe("Hecho.");
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(0);
  });

  it("applies dice damage on top of the STATE_UPDATE change (fresh re-read)", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    const draft = "The blade cuts into your arm [MECHANIC:damage:1d6]";
    commitTurn(db, {
      sessionId: session.id, campaignId: campaign.id, content: "x", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -3 } } } },
      damage: { resolutions: [roll(4)], markers: [damageMarker(draft)], narratorDraft: draft },
    });
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(3);
  });

  it("rolls back character changes when the message insert fails", () => {
    const db = createTestDb();
    const { campaign } = seedSession(db);
    const aria = seedCharacter(db, campaign.id);
    expect(() => commitTurn(db, {
      sessionId: "missing-session", campaignId: campaign.id, content: "x", mechanics: [], chars: [aria],
      stateUpdate: { characters: { Aria: { statChanges: { HP: -5 } } } }, damage: null,
    })).toThrow();
    expect(db.select().from(characters).where(eq(characters.id, aria.id)).get()?.stats.HP).toBe(10);
  });

  it("writes the next story state in the same transaction when given", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const next = { ...coldStartState(), turn: 7 };
    commitTurn(db, { sessionId: session.id, campaignId: campaign.id, content: "x", mechanics: [], chars: [],
      stateUpdate: null, damage: null, storyState: next });
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.storyState?.turn).toBe(7);
  });
});

describe("commitTurnState", () => {
  it("writes scene, NPC updates, story state and seeds together", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const story = { ...coldStartState(), turn: 2 };
    commitTurnState(db, {
      sessionId: session.id, campaignId: campaign.id,
      scene: { location: "Muelle", activeNPCs: [], situation: "", pendingThreats: [], timeOfDay: "night" },
      npcUpdates: [{ name: "Mara", newState: "wary", goal: "escape" }],
      allNPCs: [],
      storyState: story,
      consequenceSeeds: [{ trigger: "t", echo: "e", messagesUntilEcho: 3 }],
      campaignStoryState: null,
    });
    const s = db.select().from(sessions).where(eq(sessions.id, session.id)).get()!;
    expect(s.sceneState?.location).toBe("Muelle");
    expect(s.storyState?.turn).toBe(2);
    expect(s.consequenceSeeds).toHaveLength(1);
    expect(db.select().from(npcMemory).all().map((n) => n.name)).toEqual(["Mara"]);
  });

  it("inserts a newly discovered NPC once even if extracted twice", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    commitTurnState(db, {
      sessionId: session.id, campaignId: campaign.id, scene: null,
      npcUpdates: [{ name: "Mara" }, { name: "mara" }], allNPCs: [],
      storyState: coldStartState(), consequenceSeeds: [], campaignStoryState: null,
    });
    expect(db.select().from(npcMemory).all()).toHaveLength(1);
  });
});

describe("assignThreadOwners", () => {
  it("points a thread at the NPC whose agenda pushes on it", () => {
    const threads = [{ id: "t1" }, { id: "t2" }] as never[];
    const out = assignThreadOwners(threads, [{ name: "Mara", agendaThreadId: "t2" }],
      [{ id: "npc-1", name: "mara" }] as never[]);
    expect((out[1] as { ownerNpcId?: string }).ownerNpcId).toBe("npc-1");
    expect((out[0] as { ownerNpcId?: string }).ownerNpcId).toBeUndefined();
  });
});
```

```bash
npx vitest run tests/pipeline/turnCommit.test.ts
```
Esperado: FAIL, con `Failed to resolve import "@/server/pipeline/turnCommit"`.

- [ ] **Paso 2: Crear `server/pipeline/turnCommit.ts`.** Encabezado y tipos:

```ts
import { eq } from "drizzle-orm";
import type { DB, DbOrTx } from "../db";
import { campaigns, characters, messages, npcMemory, sessions } from "../db/schema";
import type { CharacterRow, MessageRow, NpcMemoryRow, SessionRow } from "../db/schema";
import type { CampaignStoryState, MechanicMarker, Resolution, SessionStoryState, StateUpdate, StoryThread } from "@/types";
import type { NpcUpdate } from "./narrativeExtractor";
import { isHeld, claimsHealthyWhileHurt } from "./stateParser";
import { findAffectedCharacter } from "./utils";

type Mechanics = NonNullable<NonNullable<MessageRow["metadata"]>["mechanics"]>;
type SceneState = NonNullable<SessionRow["sceneState"]>;
type ConsequenceSeed = SessionRow["consequenceSeeds"][number];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
```

- [ ] **Paso 3: Mover `applyStateUpdate` (`orchestrator.ts:668-712`) a `turnCommit.ts`.** Copiar el cuerpo tal cual, con estos cambios exactos:
  - Firma nueva: `export function applyStateUpdate(tx: DbOrTx, stateUpdate: StateUpdate, chars: CharacterRow[]): void`. Se borra el parámetro `_markers`, que no se usaba.
  - Justo después de `if (!char) continue;`, releer el personaje para no partir de un snapshot viejo:
    ```ts
    const fresh = tx.select().from(characters).where(eq(characters.id, char.id)).get() ?? char;
    ```
    y usar `fresh.stats`, `fresh.inventory` y `fresh.statusNotes` en lugar de los de `char`.
  - El write final pasa a `tx.update(characters).set(updates).where(eq(characters.id, char.id)).run();` (sin `await`).

- [ ] **Paso 4: Mover `applyDiceDamage` (`orchestrator.ts:714-771`) a `turnCommit.ts`.** Copiar el cuerpo tal cual, con estos cambios:
  - Firma: `export function applyDiceDamage(tx: DbOrTx, damageResolutions: Resolution[], markers: MechanicMarker[], narratorDraft: string, chars: CharacterRow[]): void`.
  - `const [freshChar] = await db.select()...` pasa a `const freshChar = tx.select().from(characters).where(eq(characters.id, charId)).get();`
  - El write final pasa a `tx.update(characters).set(updates).where(eq(characters.id, charId)).run();`

- [ ] **Paso 5: Mover y unificar las actualizaciones de NPC.** Mover `applyNpcUpdatesFromExtraction` (`orchestrator.ts:777-856`) a `turnCommit.ts` como `applyNpcUpdates`, con estos cambios:
  - Firma: `export function applyNpcUpdates(tx: DbOrTx, campaignId: string, updates: NpcUpdate[], allNPCs: NpcMemoryRow[]): void`.
  - El lookup usa `sameName(n.name, upd.name)`.
  - Clonar las relaciones para no mutar el snapshot: `const rels = (existing.relationships ?? []).map((r) => ({ ...r }));`
  - El tipo de `dbUpdates` pasa a `Partial<NpcMemoryRow>`. Después de `if (upd.vocabulary) ...` se agregan los campos de agenda, que antes vivían en un segundo loop (`orchestrator.ts:536-556`):
    ```ts
    if (typeof upd.goal === "string") dbUpdates.goal = upd.goal;
    if (typeof upd.agenda === "string") dbUpdates.agenda = upd.agenda;
    if (typeof upd.agendaThreadId === "string") dbUpdates.agendaThreadId = upd.agendaThreadId;
    ```
  - Los writes pasan a `tx.update(npcMemory)...run()` y `tx.insert(npcMemory).values({...}).onConflictDoNothing().run()`.

  Agregar al mismo archivo:

```ts
/** Point each thread an NPC's agenda now pushes on at that NPC. Last update wins. */
export function assignThreadOwners(threads: StoryThread[], updates: NpcUpdate[], allNPCs: NpcMemoryRow[]): StoryThread[] {
  const next = [...threads];
  for (const upd of updates) {
    if (!upd.name || typeof upd.agendaThreadId !== "string" || !upd.agendaThreadId) continue;
    const row = allNPCs.find((n) => sameName(n.name, upd.name));
    const idx = next.findIndex((t) => t.id === upd.agendaThreadId);
    if (row && idx !== -1) next[idx] = { ...next[idx], ownerNpcId: row.id };
  }
  return next;
}

export interface TurnCommit {
  sessionId: string;
  campaignId: string;
  content: string;
  mechanics: Mechanics;
  chars: CharacterRow[];
  stateUpdate: StateUpdate | null;
  damage: { resolutions: Resolution[]; markers: MechanicMarker[]; narratorDraft: string } | null;
  /** Trivial path only: it has no step 3, so it advances storyState here. */
  storyState?: SessionStoryState;
}

/**
 * Persist a narrated turn — character changes, assistant message, campaign
 * timestamp — atomically. STATE_UPDATE runs before dice damage, and dice
 * damage re-reads HP, so both paths stack instead of overwriting each other.
 * Returns the assistant message id.
 */
export function commitTurn(db: DB, t: TurnCommit): string {
  return db.transaction((tx) => {
    if (t.stateUpdate && t.chars.length > 0) applyStateUpdate(tx, t.stateUpdate, t.chars);
    if (t.damage && t.damage.resolutions.length > 0 && t.chars.length > 0) {
      applyDiceDamage(tx, t.damage.resolutions, t.damage.markers, t.damage.narratorDraft, t.chars);
    }
    const msg = tx.insert(messages).values({
      sessionId: t.sessionId,
      role: "assistant",
      content: t.content,
      metadata: t.mechanics.length > 0 ? { mechanics: t.mechanics } : undefined,
    }).returning({ id: messages.id }).get();
    tx.update(campaigns).set({ lastPlayedAt: Date.now() }).where(eq(campaigns.id, t.campaignId)).run();
    if (t.storyState) {
      tx.update(sessions).set({ storyState: t.storyState }).where(eq(sessions.id, t.sessionId)).run();
    }
    return msg.id;
  });
}

export interface TurnStateCommit {
  sessionId: string;
  campaignId: string;
  scene: SceneState | null;
  npcUpdates: NpcUpdate[];
  allNPCs: NpcMemoryRow[];
  storyState: SessionStoryState;
  consequenceSeeds: ConsequenceSeed[];
  /** Set only on the reconcile cadence. */
  campaignStoryState: CampaignStoryState | null;
}

/** Persist everything step 3 derived from the extractor, in one transaction. */
export function commitTurnState(db: DB, c: TurnStateCommit): void {
  db.transaction((tx) => {
    if (c.scene) tx.update(sessions).set({ sceneState: c.scene }).where(eq(sessions.id, c.sessionId)).run();
    applyNpcUpdates(tx, c.campaignId, c.npcUpdates, c.allNPCs);
    if (c.campaignStoryState) {
      tx.update(campaigns).set({ storyState: c.campaignStoryState }).where(eq(campaigns.id, c.campaignId)).run();
    }
    tx.update(sessions)
      .set({ storyState: c.storyState, consequenceSeeds: c.consequenceSeeds })
      .where(eq(sessions.id, c.sessionId))
      .run();
  });
}
```

- [ ] **Paso 6: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/pipeline/turnCommit.test.ts
```
Esperado: PASS (7 tests). Si falla el test de daño de dados, revisar que `findAffectedCharacter` con un solo personaje devuelva ese personaje y que el regex `playerVictimRe` matchee "into your arm".

- [ ] **Paso 7: Conectarlo en el orchestrator.**

  **Trivial path:** reemplazar `orchestrator.ts:182-198` (desde `// Apply state mutations even on trivial path` hasta el `await db.update(sessions).set({ storyState: trivialNextState })...` incluido) por:

```ts
      const trivialNextState: typeof trivialStoryState = {
        ...trivialStoryState,
        turn: trivialStoryState.turn + 1,
        lastIntent: trivialDecision.intent,
        lastSpotlightId: trivialDecision.spotlight?.id,
        ...(trivialDecision.gmInitiative !== ""
          ? { lastGmInitiativeTurn: trivialStoryState.turn }
          : {}),
      };
      commitTurn(db, {
        sessionId, campaignId: session.campaignId, content: cleanedContent, mechanics: [], chars,
        stateUpdate: stateUpdate ?? null, damage: null, storyState: trivialNextState,
      });
```

  **Main commit:** reemplazar `orchestrator.ts:466-488` (desde `// Apply character mutations` hasta el `await db.update(campaigns).set({ lastPlayedAt ... })` incluido) por:

```ts
    const damageResolutions = resolutions.filter((r) => markers[r.index]?.type === "damage");
    const assistantMessageId = commitTurn(db, {
      sessionId,
      campaignId: session.campaignId,
      content: finalText,
      mechanics,
      chars,
      stateUpdate: stateUpdate ?? null,
      damage: damageResolutions.length > 0 ? { resolutions: damageResolutions, markers, narratorDraft } : null,
    });
```

  **Step 3:** reemplazar desde `// Acting-NPC bookkeeping` (`:503`) hasta `updateCampaignJournal(...).catch(() => {});` (`:650`) por:

```ts
    // Acting-NPC bookkeeping
    if (decision.actingNpc) {
      const actingName = decision.actingNpc.name;
      const actingRow = allNPCs.find((n) => n.name.trim().toLowerCase() === actingName.trim().toLowerCase());
      if (actingRow) {
        try {
          db.update(npcMemory).set({ lastActedTurn: storyState.turn }).where(eq(npcMemory.id, actingRow.id)).run();
        } catch (err) {
          console.error("[acting-npc]", err); // after onComplete: the stream is closed, so log instead of onError
        }
      }
    }

    // Step 3: extraction → one state commit. Queued per session: the next
    // turn waits for it instead of racing it on storyState/seeds.
    const currentThreads = storyState.threads.map((t) => ({ id: t.id, label: t.label, status: t.status }));
    const sceneNpcRefs = relevantNPCs.map((n) => ({ id: n.id, name: n.name }));
    enqueueBackground(turnStateKey(sessionId), async () => {
      const ex = await extractNarrativeState({
        llmConfig,
        currentThreads,
        npcs: sceneNpcRefs,
        knownNpcNames: allNPCs.map((n) => n.name),
        playerAction: message,
        narration: finalText,
      });

      const merged = mergeStoryState({ ...storyState, turn: nextTurn }, ex.story, nextTurn);
      merged.threads = assignThreadOwners(merged.threads, ex.npc.updates, allNPCs);

      // Memories first: this turn's new memories may seed a consequence below.
      await formMemories(ex.memories, sceneNpcRefs,
        { campaignId: session.campaignId, sessionId, messageId: assistantMessageId, turn: nextTurn });

      // ── Consequence-seed update ──────────────────────────────────────────
      let newSeeds = (session.consequenceSeeds ?? []).map((s) => ({
        ...s,
        messagesUntilEcho: Math.max(0, s.messagesUntilEcho - 1),
      }));
      if (decision.consequenceEcho !== undefined) {
        const removeIdx = newSeeds.findIndex((s) => s.echo === decision.consequenceEcho);
        if (removeIdx !== -1) newSeeds.splice(removeIdx, 1);
      }
      const hotMemories = (await Promise.all(sceneNpcRefs.map((n) => loadActiveMemories(n.id)))).flat();
      const memSeed = memoriesToSeed(hotMemories, nextTurn);
      if (memSeed) {
        newSeeds.push({ trigger: memSeed.trigger, echo: memSeed.echo, threadId: memSeed.threadId,
          messagesUntilEcho: Math.floor(Math.random() * 6) + 5 });
      }
      for (const seed of ex.world.newSeeds) {
        newSeeds.push({ trigger: seed.trigger, echo: seed.echo, threadId: seed.threadId,
          messagesUntilEcho: Math.floor(Math.random() * 6) + 5 });
      }
      newSeeds = newSeeds.slice(-8);

      // ── Campaign reconcile (%15 cadence, best-effort) ────────────────────
      let campaignStoryState: CampaignStoryState | null = null;
      try {
        const [{ count: msgCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.sessionId, sessionId));
        if (msgCount % 15 === 0) {
          const result = reconcileCampaignThreads(campaign.storyState ?? null, merged, campaign.plotHooks ?? [], sessionId);
          campaignStoryState = result.campaign;
          for (const promo of result.promotions) {
            const idx = merged.threads.findIndex((t) => t.id === promo.sessionThreadId);
            if (idx !== -1) {
              merged.threads[idx] = { ...merged.threads[idx], scope: "campaign", campaignThreadId: promo.campaignThreadId };
            }
          }
        }
      } catch (err) {
        console.error("[reconcile]", err);
      }

      commitTurnState(db, {
        sessionId,
        campaignId: session.campaignId,
        scene: ex.scene.location ? ex.scene : null,
        npcUpdates: ex.npc.updates,
        allNPCs,
        storyState: merged,
        consequenceSeeds: newSeeds,
        campaignStoryState,
      });

      // Memory sleep + gossip (own writes; made transactional in Phase 3)
      for (const n of sceneNpcRefs) await runConsolidation(n.id, session.campaignId, nextTurn);
      await runGossip(sceneNpcRefs.map((n) => n.id), nextTurn);
    });

    enqueueBackground(sessionAuxKey(sessionId), () => updateContextSummary(sessionId, llmConfig));
    enqueueBackground(sessionAuxKey(sessionId), () => updateCampaignJournal(session.campaignId, sessionId, llmConfig));
```

  > Si `tsc` marca que `ex.scene` no es asignable a `SceneState` (por ejemplo por `mood`), usar `scene: ex.scene.location ? { ...ex.scene } as SceneState : null` y anotar la diferencia de tipos para la Task 3.1.

  **Limpieza en el orchestrator:**
  - Borrar las funciones `applyStateUpdate`, `applyDiceDamage` y `applyNpcUpdatesFromExtraction`.
  - Imports:
    - Agregar `import { commitTurn, commitTurnState, assignThreadOwners } from "./turnCommit";` y `CampaignStoryState` al import de `@/types`.
    - Quitar los imports que quedan sin uso: `isHeld`, `claimsHealthyWhileHurt`, `findAffectedCharacter`, `NpcUpdate`, `CharacterRow`, `NpcMemoryRow`, `Resolution`, `MechanicMarker`, `StateUpdate` (confirmarlos con `npm run lint`).

- [ ] **Paso 8: Verificar.**

```bash
npm test && npm run typecheck && npm run lint
```
Esperado: todo en verde.

- [ ] **Paso 9: Commit (incluye la Task 1.4).**

```bash
git add server/pipeline/backgroundQueue.ts server/pipeline/turnCommit.ts server/pipeline/orchestrator.ts server/routers/sessions.ts tests/pipeline/backgroundQueue.test.ts tests/pipeline/turnCommit.test.ts
git commit -m "fix(pipeline): serialize step 3 per session, commit turn writes atomically"
```

---

### Task 1.6: Bugs de ventana de contexto (problemas F, G, H e I)

**Files:**
- Modify: `server/pipeline/utils.ts` (se agregan funciones)
- Modify: `server/pipeline/orchestrator.ts:105-118`, `:903-955`; se mueve `deduplicateContent` (`:991-…`)
- Modify: `tests/convex/deduplicateContent.test.ts:2`
- Test: `tests/pipeline/turnUtils.test.ts`

- [ ] **Paso 1: Escribir el test que falla.** Crear `tests/pipeline/turnUtils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lastAssistantContents, nextSummaryWindow, historyLimit } from "@/server/pipeline/utils";

const m = (role: string, content: string) => ({ role, content });

describe("lastAssistantContents", () => {
  it("returns the newest n assistant messages, oldest first", () => {
    const msgs = [m("assistant", "a1"), m("user", "u1"), m("assistant", "a2"), m("assistant", "a3"), m("user", "u2"), m("assistant", "a4")];
    expect(lastAssistantContents(msgs, 3)).toEqual(["a2", "a3", "a4"]);
  });
});

describe("nextSummaryWindow", () => {
  it("waits until enough new messages pile up", () => {
    expect(nextSummaryWindow(9, 0)).toBeNull();
  });
  it("never skips messages when the backlog exceeds one batch", () => {
    expect(nextSummaryWindow(45, 0)).toEqual({ start: 0, end: 20 });
    expect(nextSummaryWindow(45, 20)).toEqual({ start: 20, end: 40 });
    expect(nextSummaryWindow(45, 40)).toBeNull();
  });
});

describe("historyLimit", () => {
  it("uses the setting, clamped to a sane range", () => {
    expect(historyLimit(undefined)).toBe(14);
    expect(historyLimit(20)).toBe(20);
    expect(historyLimit(1)).toBe(4);
    expect(historyLimit(200)).toBe(40);
  });
});
```

```bash
npx vitest run tests/pipeline/turnUtils.test.ts
```
Esperado: FAIL, con `lastAssistantContents is not a function` (o similar).

- [ ] **Paso 2: Implementar en `server/pipeline/utils.ts`** (agregar al final):

```ts
/** Content of the newest `n` assistant messages, oldest first. Input must be chronological. */
export function lastAssistantContents(chronological: { role: string; content: string }[], n = 3): string[] {
  return chronological.filter((m) => m.role === "assistant").slice(-n).map((m) => m.content);
}

/**
 * Messages [start, end) the next rolling summary should cover, or null while
 * fewer than `minNew` are pending. The cursor only advances past what was
 * actually summarized, so a large backlog drains over several calls.
 */
export function nextSummaryWindow(
  total: number, lastSummaryAt: number, minNew = 10, maxBatch = 20,
): { start: number; end: number } | null {
  if (total - lastSummaryAt < minNew) return null;
  return { start: lastSummaryAt, end: Math.min(total, lastSummaryAt + maxBatch) };
}

/** How many recent messages feed the narrator, from the user's setting. */
export function historyLimit(setting: number | null | undefined): number {
  return Math.min(Math.max(setting ?? 14, 4), 40);
}
```

Mover también `deduplicateContent` tal cual desde `orchestrator.ts` (la función entera, con su JSDoc) al final de `utils.ts`. En el orchestrator, importarla: `import { findAffectedCharacter, streamBeforeMarker, deduplicateContent, lastAssistantContents, nextSummaryWindow, historyLimit } from "./utils";` (`findAffectedCharacter` se saca si quedó sin uso después de la Task 1.5).

- [ ] **Paso 3: Correr los tests y confirmar que pasan.**

```bash
npx vitest run tests/pipeline/turnUtils.test.ts
```
Esperado: PASS (4 tests).

- [ ] **Paso 4: Conectarlo en el orchestrator.** En `:105-118`:
  - `.limit(14);` pasa a `.limit(historyLimit(settings?.maxContextMessages));`
  - El bloque `const lastAssistantMessages = recentMessages.filter(...).slice(0, 3).map(...)` pasa a `const lastAssistantMessages = lastAssistantContents(recentMessages, 3);`

  En `updateContextSummary`:
  - Reemplazar `const lastSummaryAt = session.lastSummaryAt ?? 0;` y `if (totalCount - lastSummaryAt < 10) return;` por:
    ```ts
    const summaryWindow = nextSummaryWindow(totalCount, session.lastSummaryAt ?? 0);
    if (!summaryWindow) return;
    ```
  - `allMsgs.slice(lastSummaryAt).slice(0, 20)` pasa a `allMsgs.slice(summaryWindow.start, summaryWindow.end)`.
  - `lastSummaryAt: allMsgs.length` pasa a `lastSummaryAt: summaryWindow.end`.

  > **Cambio de comportamiento a avisar:** `maxContextMessages` vale 20 por default en DB (`schema.ts:118`), así que el narrador pasa de 14 a 20 mensajes de historial. `sceneSummary` ya está presupuestado por tokens (`promptBuilder.ts:380-403`), así que el prompt no se pasa de `num_ctx`. Pero sí cambia el contexto. Verificar en el smoke test (Task 1.7).

- [ ] **Paso 5: El test de dedupe deja de abrir la DB.** En `tests/convex/deduplicateContent.test.ts:2`:

```ts
import { deduplicateContent } from "../../server/pipeline/utils";
```

- [ ] **Paso 6: Verificar y commitear.**

```bash
npm test && npm run typecheck && npm run lint
git add server/pipeline/utils.ts server/pipeline/orchestrator.ts tests/pipeline/turnUtils.test.ts tests/convex/deduplicateContent.test.ts
git commit -m "fix(pipeline): newest assistant msgs for NPC selection, gapless summaries, honor maxContextMessages"
```

---

### Task 1.7: Smoke test con modelo real

No es TDD: es la verificación de punta a punta de la fase. Requiere Ollama corriendo (`bash scripts/start-services.sh`).

- [ ] **Paso 1:** correr `npm run dev`, abrir una sesión existente y jugar 3 turnos. Esperado: la narración funciona igual que antes.
- [ ] **Paso 2: doble envío.** Mandar un mensaje y, mientras streamea, mandar otro desde una segunda pestaña. Esperado: la segunda pestaña recibe el error "already processing a turn", y en la DB hay **un solo** par user/assistant nuevo.
- [ ] **Paso 3: turno encadenado.** Mandar un turno e, inmediatamente después del `done`, mandar otro. Esperado: el segundo arranca un poco más tarde, porque espera al step3, y `storyState.turn` sube exactamente 1 por turno:

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/rpg.db',{readonly:true});console.log(db.prepare('select id, json_extract(story_state, \"$.turn\") turn from sessions order by started_at desc limit 1').get())"
```
- [ ] **Paso 4: play-loop E2E** (según la memoria del proyecto, siempre con `--no-file-parallelism`):

```bash
PLAY_LOOP=1 npx vitest run scripts/agency.test.mts --no-file-parallelism
```
Esperado: PASS.

---

### Task 1.8: Documentación y cierre de fase

**Files:** `CLAUDE.md`

- [ ] **Paso 1:** en `CLAUDE.md`, sección Commands, reemplazar las dos líneas de drizzle por:

```bash
npx drizzle-kit generate   # create a migration after schema changes (applied automatically at boot)
node scripts/check-schema-drift.mjs   # verify data/rpg.db matches ./drizzle
npm run typecheck          # tsc --noEmit
```
Agregar debajo: "No usar `drizzle-kit push`: las migraciones son la fuente de verdad y `server/db/open.ts` las aplica al abrir la DB. `DB_PATH` cambia el archivo; los tests usan `:memory:`."

- [ ] **Paso 2:** en "Known gotchas", reemplazar el bullet de HP por:

> **HP has two mutation paths** (STATE_UPDATE `statChanges` and dice `damage` markers). Both go through `commitTurn` in `server/pipeline/turnCommit.ts`, inside one transaction: STATE_UPDATE first, then dice damage re-reads the character and subtracts from the fresh HP. Keep that order.

Agregar:

> **Turns are serialized per session.** `sessionLock.ts` rejects a concurrent turn; `backgroundQueue.ts` makes each turn wait for the previous turn's step 3. Background jobs go through `enqueueBackground`, never bare fire-and-forget, so they are serialized and their errors logged.

- [ ] **Paso 3: Commit y cierre.**

```bash
npm test && npm run typecheck && npm run lint
git add CLAUDE.md
git commit -m "docs: migrations at boot, turn serialization, HP commit path"
```
Merge a `master` **solo con la confirmación del usuario**.

---

# FASE 2 — Robustez

**Rama:** `refactor/phase-2-robustness`. Requiere la Fase 1. Antes de arrancar se escribe su plan detallado.

### Task 2.1: Cancelación de punta a punta
- **Files:**
  - `hooks/use-chat.ts`: `AbortController`, `stop()` expuesto y abort en el unmount.
  - `app/api/chat/stream/route.ts`: pasa `req.signal`; `cancel()` del `ReadableStream`.
  - `server/pipeline/orchestrator.ts`: `params.signal`.
  - `server/llm/providers.ts`: `callLLM(..., { signal })` combinado con el timeout vía `AbortSignal.any`.
- **Enfoque:** si se aborta antes del commit, no se escribe el mensaje del asistente y se borra el mensaje de usuario huérfano (ver 2.3). Si se aborta después del commit, no se hace nada.
- **Aceptación:** test de `callLLM` con un fetch mockeado que respeta el signal. En el manual, cerrar la pestaña a mitad de stream corta la generación en Ollama (`ollama ps` deja de mostrar actividad).

### Task 2.2: Retries que no duplican texto
- **Files:** `orchestrator.ts` (un único helper `narrateWithFallback` reemplaza los 3 bloques copiados: `:160`, `:273`, `:409`), `use-chat.ts`.
- **Enfoque:** antes de cada reintento, el server emite el evento SSE `{"type":"reset"}` y el cliente limpia `streamingText`. `streamBeforeMarker` se instancia de nuevo por intento.
- **Aceptación:** test unitario del helper con un LLM fake que falla a mitad de stream. Los tokens que ve el consumidor son reset más el segundo intento completo, sin duplicados.

### Task 2.3: Mensaje de usuario huérfano
- **Files:** `orchestrator.ts`, `components/chat/chat-container.tsx`, `chat-input.tsx`.
- **Enfoque:** si el turno falla o se aborta antes del commit, se borra el mensaje de usuario insertado. El evento de error incluye `restoreInput: message`, y el cliente lo devuelve al input.
- **Aceptación:** si se mata Ollama a mitad de turno, la DB no queda con un mensaje de usuario sin respuesta y el texto vuelve al input.

### Task 2.4: Cadencias por turno, no por cantidad de mensajes
- **Files:** `orchestrator.ts` (reconcile `% 15`, journal `% 16`, summary).
- **Enfoque:** las cadencias usan `storyState.turn`, más campos `lastJournalTurn` y `lastReconcileTurn` en `storyState`. Con eso la paridad de mensajes deja de importar.
- **Aceptación:** tests puros de `isDue(turn, lastTurn, every)`.

### Task 2.5: Fallback y modelo de imagen por proveedor
- **Files:** `orchestrator.ts:40-64`, `server/image/buildImageContext.ts`, `imageOrchestrator.ts:107-110`, `routers/images.ts:289`, `routers/sessions.ts:169`.
- **Enfoque:** `buildFallbackConfig` solo usa `mistral:7b-instruct` si el proveedor es Ollama; para cloud, el fallback es el mismo proveedor con un retry. El prompt de imagen usa `buildProviderConfig(settings)`, no Ollama hardcodeado. Un solo `buildProviderConfig` exportado (hoy está duplicado en `sessions.ts:166-176`).
- **Aceptación:** tests de `buildProviderConfig` y `buildFallbackConfig` para los 3 proveedores.

### Task 2.6: Recuperar jobs de imagen
- **Files:** `server/db/open.ts` o un `server/image/recovery.ts` llamado al bootear; `portraitGenerator.ts:24`; `hooks/use-image-status.ts:15-18`.
- **Enfoque:**
  - Al arrancar: `UPDATE scene_images SET status='failed' WHERE status='generating'`.
  - El estado del retrato se persiste en `characters`.
  - El polling del cliente corta ante `failed` o `null`, con backoff.
- **Aceptación:** test con DB en memoria de la función de recovery. En el manual, matar el server durante una generación y reiniciarlo: la sesión puede volver a ilustrar.

### Task 2.7: Mutex de VRAM real
- **Files:** `server/image/vramManager.ts`, `server/llm/providers.ts:37-60`.
- **Enfoque:**
  - Mutex por promesa con token de dueño. `release(token)` solo libera si el token coincide.
  - El vencimiento del lock pasa a ser ≥ timeout de ComfyUI más polling (unos 180 s).
  - El streaming de chat espera si hay una generación de imagen en curso.
  - El modelo que se descarga es el realmente cargado (`GET /api/ps` de Ollama), no `settings.selectedModel`.
- **Aceptación:** tests con fake timers de que dos acquire se serializan y un release ajeno no tiene efecto.

### Task 2.8: Cliente ComfyUI
- **Files:** `server/image/comfyuiClient.ts:413-556`.
- **Enfoque:** abrir el WebSocket **antes** del submit, con `clientId`; completar por `prompt_id`, no por `queue_remaining === 0`; unificar el retry con el camino principal; no reescribir el archivo que ComfyUI ya guardó en el volumen montado.
- **Aceptación:** los tests existentes de `comfyuiClient` se adaptan y pasan; se agrega un test de "otro prompt en cola no bloquea la completitud".

### Task 2.9: Seguridad de uploads
- **Files:** `server/image/referenceManager.ts:7-11`, `routers/images.ts:231-241`.
- **Enfoque:** validar que `campaignId` exista en la DB (zod `uuid` más lookup); `sanitizeName` único en `server/image/paths.ts`; límite de tamaño del base64 (por ejemplo 10 MB) y whitelist de MIME.
- **Aceptación:** test de que un `campaignId` `../../x` se rechaza.

### Task 2.10: Errores visibles
- **Files:**
  - `server/lib/log.ts` (nuevo, `logError(tag, err)`).
  - Los `.catch(() => {})` restantes: título, `routers/*`, image.
  - `hooks/use-chat.ts`: un stream que cierra sin `done` muestra error; el error invalida `messages`; se lee el body de errores no-OK.
- **Aceptación:** `grep -rn "catch(() => {})" server` devuelve 0 resultados, o solo casos justificados con comentario.

---

# FASE 3 — Estructura del backend

**Rama:** `refactor/phase-3-structure`. Requiere la Fase 2 y, idealmente, la Task 5.1. Antes de arrancar se escribe su plan detallado.

### Task 3.1: Tipos derivados del schema
- **Files:** `types/index.ts`, `server/db/schema.ts:3`, `server/image/types.ts`, `types/gallery.ts`.
- **Enfoque:**
  - Las formas JSON (`SessionStoryState`, `SceneState`, `ConsequenceSeed`, `MessageMetadata`, `CustomImageConfig`, `Appearance`) se mueven a `server/db/jsonTypes.ts`. Eso rompe el import circular schema↔types.
  - `types/index.ts` re-exporta `Campaign = CampaignRow`, etc., desde `$inferSelect`.
  - Los enums (`ImageStyle`, `Genre`…) se definen una vez como `const` arrays y se reusan en schema, zod y UI. Hoy `ImageStyle` está copiado 5 veces.
- **Aceptación:** `tsc` en verde y ninguna interfaz duplicada de una fila. Los campos que faltaban (`Session.storyState`, `SceneImage.contextSnapshot`, `ImageStatus "replaced"`) aparecen solos.

### Task 3.2: Validar las columnas JSON al leer
- **Files:** `server/db/jsonSchemas.ts` (zod) y los repos de la 3.4.
- **Enfoque:** `storyState`, `consequenceSeeds`, `sceneState` y `relationships` se parsean con zod al salir de la DB, con fallback a `coldStartState()` o `[]` y un log si el blob está corrupto.
- **Aceptación:** test de que un `storyState` corrupto no tira el turno.

### Task 3.3: Config central
- **Files:** `server/config.ts` (nuevo); reemplaza las 9 URLs de Ollama, los 6 `OUTPUT_BASE`, las 8 rutas `D:/…`, el literal `"default"` de settings (4 lugares), `OLLAMA_NUM_CTX`, `DB_PATH`, etc.
- **Enfoque:** todo sale de `process.env` con defaults actuales, validado con zod al importar. La ruta de servir imágenes (`app/api/images/rpg/[...path]/route.ts:4`) usa la misma constante que el escritor. `docker-compose.yml` se parametriza con `.env`.
- **Aceptación:** `grep -rn "D:/" server app` devuelve 0 resultados; `grep -rn "localhost:11434" server` devuelve 1 (en config).

### Task 3.4: Capa de repositorios
- **Files:** `server/repos/{sessions,messages,characters,npcs,campaigns,settings,memories}.ts`.
- **Enfoque:** funciones que reciben `DbOrTx`, como los helpers de `turnCommit` de la Fase 1. El orchestrator, los routers y `memory/*` dejan de hacer queries crudas. Se migran `memory/store.ts`, `consolidate.ts` y `gossip.ts` a `DbOrTx`, para que consolidación y gossip entren en `commitTurnState`.
- **Aceptación:** `grep -n "from \"../db\"" server/pipeline/orchestrator.ts` devuelve solo tipos; tests de repos con DB en memoria.

### Task 3.5: Dividir `runPipeline` en etapas
- **Files:** `server/pipeline/turn/{loadContext,narrate,resolveMechanics,finalize,background}.ts`; `orchestrator.ts` queda en unas 150 líneas.
- **Enfoque:**
  - Interfaz `PipelineDeps { db, llm: LLMClient, now, random }` inyectable.
  - Se unifica el armado del contexto del prompt, hoy duplicado entre los paths trivial y standard (`:130-156` vs `:240-267`).
  - El path trivial pasa a ser un flag en las etapas, no un pipeline aparte.
- **Aceptación:** **primer test de `runPipeline`** con LLM fake y DB en memoria, que cubre el path trivial, el standard con dado de daño y el fallo del narrador.

### Task 3.6: Deduplicar helpers
- **Files:** `server/pipeline/text.ts` (regex MECHANIC única), `stats.ts` (`hpKey`/`maxHpKey`, hoy repetidos 8 veces), `npcNames.ts` (`sameName`), un solo scanner de llaves JSON (`stateParser.ts:19-32` y `narrativeExtractor.ts:131-152`), un `countMessages` en el repo.
- **Aceptación:** los tests existentes pasan sin cambios de comportamiento.

### Task 3.7: Abstracción de proveedores LLM
- **Files:** `server/llm/{index,ollama,openai,anthropic,streamLoop}.ts` (parte `providers.ts`, de 811 líneas).
- **Enfoque:**
  - Interfaz `LLMClient { stream(messages, opts, signal), complete(...) }`.
  - Un loop de stream y repetition-check compartido, hoy copiado 3 veces (`:244-297`, `:382-423`, `:513-558`).
  - Semáforo y `<think>`-strip uniformes.
  - Decidir si se usan los SDK `openai` y `@anthropic-ai/sdk` o se sacan de `package.json`, porque hoy no se importan.
- **Aceptación:** tests del loop compartido; cada provider queda en unas 100 líneas.

### Task 3.8: Lógica de negocio fuera de los routers
- **Files:** `server/services/sessionService.ts` (`endSession`: recap y journal), `routers/sessions.ts:155-211`, `routers/images.ts` y `memories.ts` (usar `ctx.db`), `app/api/chat/stream/route.ts` (input con zod; no se persiste `metadata` arbitraria del cliente).
- **Aceptación:** los routers solo validan y delegan.

### Task 3.9: Borrar código muerto
- **Procedures sin uso:**
  - `sessions`: `update`, `setProcessing`, `clearProcessing`.
  - `messages`: `listRecent`, `countBySession`, `send`, `storeAssistant`.
  - `npcMemory.upsert`; `images.status` (duplica la ruta REST) e `images.listBySession`.
  - Todo `memoriesRouter`, si se confirma sin uso.
- **Columnas:** `messages.streamingText` e `isStreaming` (con migración).
- **Plumbing de imágenes muerto:** `step3Promises`, `resolutions`, `markers`, `readyEchoes`, `gmInitiative` en `ImagePipelineContext`; `preloadWorkflow`.
- **Funciones:** `truncateToFit`, más la rama `leadingBlank ? "" : ""` (`director.ts:395`).
- **Docs:** se corrigen las referencias obsoletas a pacing/narrativeArc en `ARCHITECTURE.md:17,76,124,250`.
- **Aceptación:** `tsc`, lint y tests en verde; conteo de líneas borradas en el PR.

### Task 3.10: Dividir el subsistema de imágenes
- **Files:** `server/image/promptWriter.ts` (1011 líneas), `imageOrchestrator.ts` (564; unificar regenerate con el camino principal, `:123-263` vs `:265-499`), `comfyuiClient.ts` (673).
- **Aceptación:** ningún archivo de `server/image` pasa de 400 líneas; los tests existentes pasan.

### Task 3.11: Presupuesto de prompt
- **Files:** `server/pipeline/promptBuilder.ts`, `orchestrator.ts:240-276`.
- **Enfoque:**
  - Presupuesto por secciones: world, contextSummary, Known NPCs, scene y history, con un estimador que no subestime el español (hoy usa chars/4).
  - El historial va como turnos de chat reales, no aplanado en el system prompt.
  - El mensaje del jugador aparece una sola vez (hoy aparece 3 veces).
  - El orchestrator pasa `maxCtx`.
- **Aceptación:** test de que con world, NPCs e historial gigantes, el prompt estimado es ≤ `num_ctx` menos la reserva de salida. El play-loop E2E pasa.

---

# FASE 4 — Frontend

**Rama:** `refactor/phase-4-frontend`. Independiente de las fases 2 y 3; puede ir en paralelo. Antes de arrancar se escribe su plan detallado.

### Task 4.1: Invalidación de cache en mutaciones
- **Files:**
  - `app/campaigns/new/page.tsx:31-46`, `[campaignId]/edit/page.tsx:51-68`, `[campaignId]/page.tsx:64-79`.
  - `characters/new`, `characters/[characterId]/page.tsx:37-54`, `app/settings/page.tsx`.
- **Enfoque:** `onSuccess` invalida `campaigns.list/get`, `characters.listByCampaign`, etc. Agregar try/catch a `handleNewSession`.
- **Aceptación:** editar y volver atrás muestra el dato nuevo al instante.

### Task 4.2: Paginación del chat con `useInfiniteQuery`
- **Files:** `components/chat/chat-container.tsx:50-140`, `server/routers/messages.ts:33-36`.
- **Enfoque:** cursor por `createdAt` e id, páginas hacia atrás y dedupe por id.
- **Aceptación:** en una sesión de más de 60 mensajes, no se pierden ni se duplican mensajes al jugar y al scrollear.

### Task 4.3: Rendimiento del streaming
- **Files:** `chat-container.tsx:140`, `message-bubble.tsx:46`, `message-list.tsx:60-65`, `hooks/use-chat.ts`.
- **Enfoque:**
  - Los tokens se acumulan en un ref y el flush va por `requestAnimationFrame`.
  - `React.memo` en `MessageBubble` y `useMemo` en `allMessages`.
  - Scroll instantáneo y throttled mientras streamea.
  - En `done`, `streamingText` no se limpia hasta que llegue el refetch (sin flicker).
- **Aceptación:** con React Profiler, solo el bubble de streaming re-renderiza por token.

### Task 4.4: Apertura de sesión del lado del server
- **Files:** `chat-container.tsx:124-131`, `message-list.tsx:133`, `routers/sessions.ts` (nuevo `sessions.start`).
- **Enfoque:** el server genera la apertura como mensaje `system` u oculto con flag en `metadata`, sin matchear prefijos de texto.
- **Aceptación:** abrir una sesión nueva dispara una sola apertura aunque se monte dos veces (StrictMode).

### Task 4.5: Waterfall de requests
- **Files:** `app/campaigns/[campaignId]/layout.tsx:29-50`, `sessions/[sessionId]/page.tsx:16-20`, `chat-container.tsx:50,64`.
- **Enfoque:** las queries de la página van en paralelo (sin gating en el layout) y `sessions.get` se pide una sola vez y se pasa por props. Opcional: layout server-component con prefetch (`createCaller` + `HydrationBoundary`).
- **Aceptación:** 1 ronda de requests en paralelo al abrir una sesión (verificar en Network).

### Task 4.6: Estado de imágenes sin timers
- **Files:** `chat-container.tsx:73-74`, `scene-image.tsx:30-31`, `hooks/use-image-status.ts`.
- **Enfoque:** `trpc.images.status` con `refetchInterval` condicional (`generating` vale 2 s; si no, `false`), en lugar de `setTimeout` e invalidaciones manuales y de la ruta REST.
- **Aceptación:** 0 `setTimeout` de invalidación en `components/`.

### Task 4.7: Componentes
- **Files:** `campaign-form.tsx` (467 líneas), `[campaignId]/page.tsx` (439), `character-form.tsx` (426), `chat-container.tsx` (412), `npcs/page.tsx` (349), `scene-image.tsx` (337), `image-lightbox.tsx` (316).
- **Enfoque:**
  - Partir en subcomponentes y sacar un `ConfirmDialog` compartido.
  - Borrar los componentes muertos (`campaign-list`, `campaign-card`, `campaign-settings`, `delete-campaign-dialog`, `character-list`, `character-card`, `session-list`, `session-card`, `new-session-button`, `session-summary`, `state-update-notification`, `ui/badge`, `ui/sheet`, `ui/textarea`, `hooks/use-dice-roller.ts`).
  - Unificar `timeAgo` y el mapa de clases de género.
  - Sacar `export const dynamic` de los archivos `"use client"`, donde no tiene efecto.
- **Aceptación:** ningún componente de app pasa de 300 líneas; `knip` o grep confirma 0 exports muertos.

### Task 4.8: El parser del pipeline fuera del bundle del cliente
- **Files:** `components/chat/narrative-renderer.tsx`, `server/pipeline/stateParser.ts`.
- **Enfoque:** las funciones puras que usa el render se mueven a `lib/narrative.ts`, compartido. El cliente no importa nada de `server/`.
- **Aceptación:** `grep -rn "@/server" components app hooks` solo devuelve imports de tipos.

---

# FASE 5 — Tests y tooling

**Rama:** `refactor/phase-5-tooling`. La Task 5.1 conviene hacerla antes de la Fase 3; el resto puede ir en cualquier momento.

### Task 5.1: Organización de tests
- **Enfoque:**
  - `git mv tests/convex/* tests/pipeline/` y se corrigen los imports relativos.
  - En `vitest.config.mts`, `environmentMatchGlobs` (deprecado) se reemplaza por `projects`/`workspace`:
    - `unit`: `tests/**`, node.
    - `components`: `tests/components/**`, jsdom.
    - `e2e`: `scripts/*.test.mts`, solo con `PLAY_LOOP=1`.
  - Los e2e usan un `DB_PATH` temporal, no la DB real (ver la memoria del proyecto: *play-loop harness*).
  - Se borra `scripts/launch.log` del repo y se agrega a `.gitignore`.
- **Aceptación:** `npm test` no recolecta los e2e; `npm run test:e2e` los corre.

### Task 5.2: CI
- **Files:** `.github/workflows/ci.yml`.
- **Enfoque:** en Windows y Ubuntu (por las rutas), con Node LTS: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` y `node scripts/check-schema-drift.mjs` contra una DB construida por migraciones.
- **Aceptación:** el workflow pasa en el PR. Para hacer push hace falta la confirmación del usuario.

### Task 5.3: Lint
- **Files:** `eslint.config.mjs`.
- **Enfoque:** agregar `@next/eslint-plugin-next`, activar `@typescript-eslint/no-floating-promises` (`:47`; con la Fase 2 ya no debería haber floating promises) y conectar `eslint-plugin-react-refresh` o sacarlo.
- **Aceptación:** `npm run lint` limpio con las reglas nuevas.

### Task 5.4: Dependencias
- **Enfoque:** sacar `@testing-library/user-event` (sin uso) y `@types/eslint__js` (redundante); alinear `vitest` 2 con `@vitejs/plugin-react` y evaluar Vitest 3, que obliga a 5.1; `eslint` 10 con `@eslint/js`.
- **Aceptación:** `npm ls` sin warnings de peer deps; tests en verde.

### Task 5.5: Cobertura mínima de las áreas sin tests
- **Enfoque:**
  - Tests de routers vía `createCaller` con DB en memoria (campaigns, sessions, messages, userSettings: que nunca devuelva API keys).
  - Test de la ruta SSE con un `runPipeline` mockeado.
  - Test de `use-chat` con un `fetch` mockeado (parsing parcial, `reset`, `error`, abort).
- **Aceptación:** cada router tiene al menos un test de happy path y uno de error.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El baseline marca como aplicada una migración que la DB viva no tiene. | Se corre `check-schema-drift.mjs` antes del baseline (Task 1.1, paso 1) y se para si hay drift. Se prueba siempre sobre una copia de `data/rpg.db`. |
| La serialización suma latencia al primer token si el jugador responde muy rápido. | Solo espera a step3, no a summary/journal. Si molesta, se puede medir con un log de `waitForBackground` y bajar el trabajo de step3 (consolidación/gossip) a la cola aux. |
| Las transacciones síncronas bloquean el event loop. | Solo envuelven writes, que en SQLite local tardan milisegundos; LLM y lecturas pesadas quedan afuera. |
| El cambio de 14 a 20 mensajes de historial cambia la narración. | Se verifica en el smoke test (1.7). Si empeora, el usuario baja `maxContextMessages` en Settings. |
| El refactor de la Fase 3 rompe comportamiento sutil del pipeline. | La 3.5 arranca con el test de `runPipeline` sobre el código **actual** (test de caracterización) antes de mover nada. |

## Fuera de alcance

- Auth y multiusuario.
- Cambiar de modelo por defecto o tocar el bloque `[LANGUAGE]` del prompt (se evaluó aparte).
- Migrar a server components de forma masiva (solo el prefetch puntual de la 4.5).
