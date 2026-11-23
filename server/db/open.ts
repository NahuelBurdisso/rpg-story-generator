import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { join } from "path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

/** `when` of 0003_aromatic_the_initiative — the last migration the push-era DB already reflects. */
export const LEGACY_BASELINE_MILLIS = 1780498372476;

const JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`;

/**
 * Databases created with `drizzle-kit push` have every table but no migrations
 * journal, so running the migrations would try to re-create them. Record the
 * push-era migrations as applied; anything newer still runs.
 *
 * Refuses (throws) when the database doesn't look like a push-era one, rather
 * than recording migrations that were never applied.
 */
export function baselineLegacyDatabase(sqlite: Database.Database, migrationsFolder = MIGRATIONS_FOLDER): boolean {
  const hasTable = (name: string) =>
    !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (hasTable("__drizzle_migrations")) return false;
  const userTables = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  if (userTables.length === 0) return false;

  if (!hasTable("sessions")) {
    throw new Error(
      "Database has tables but no migrations journal and no 'sessions' table: unknown schema, refusing to migrate it. " +
        "Move the file aside to start fresh.",
    );
  }
  if (!hasTable("memories")) {
    throw new Error(
      "Push-era database predates migration 0003 (no 'memories' table), so it can't be baselined safely. " +
        "Run `npm run db:drift -- <db>` to see what differs, then bring it up to date with `npx drizzle-kit push` " +
        "(note: push targets the database in drizzle.config.ts, i.e. data/rpg.db, not DB_PATH).",
    );
  }

  const baseline = readMigrationFiles({ migrationsFolder }).filter((m) => m.folderMillis <= LEGACY_BASELINE_MILLIS);
  if (!baseline.some((m) => m.folderMillis === LEGACY_BASELINE_MILLIS)) {
    throw new Error(
      `Migrations journal no longer contains the push-era baseline migration (when=${LEGACY_BASELINE_MILLIS}); cannot baseline this database.`,
    );
  }

  sqlite.transaction(() => {
    sqlite.exec(JOURNAL_DDL);
    const insert = sqlite.prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`);
    for (const m of baseline) insert.run(m.hash, m.folderMillis);
  })();
  return true;
}

/**
 * Applies pending migrations (same journal format and "newer than the latest
 * created_at" rule as drizzle's migrator). Everything, including the legacy
 * baseline, runs in one IMMEDIATE transaction: the write lock is taken up
 * front, so a concurrent opener (e.g. `next build` workers) waits on the busy
 * timeout and then finds nothing left to do.
 *
 * `foreign_keys` is switched OFF around the transaction (the pragma is a no-op
 * inside one) and restored to its previous value afterwards: drizzle-kit
 * rebuilds tables with DROP TABLE + RENAME, which would otherwise cascade-delete
 * child rows. When this call applied migrations, `PRAGMA foreign_key_check`
 * verifies integrity before commit and rolls everything back on violations.
 * It is skipped when nothing was applied, so orphan rows left by push-era
 * writes don't block startup.
 */
export function runMigrations(sqlite: Database.Database, migrationsFolder = MIGRATIONS_FOLDER): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  const fkWasOn = sqlite.pragma("foreign_keys", { simple: true }) === 1;
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite
      .transaction(() => {
        baselineLegacyDatabase(sqlite, migrationsFolder);
        sqlite.exec(JOURNAL_DDL);
        const last = sqlite.prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`).get() as
          | { created_at: number | string }
          | undefined;
        const insert = sqlite.prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`);
        let applied = 0;
        for (const m of migrations) {
          if (last && Number(last.created_at) >= m.folderMillis) continue;
          // prepare().run() (like drizzle) rejects a chunk holding several statements.
          for (const stmt of m.sql) sqlite.prepare(stmt).run();
          insert.run(m.hash, m.folderMillis);
          applied++;
        }
        if (applied === 0) return;
        const violations = sqlite.pragma("foreign_key_check") as { table: string; rowid: number; parent: string }[];
        if (violations.length > 0) {
          const sample = violations
            .slice(0, 5)
            .map((v) => `${v.table}(rowid ${v.rowid}) -> ${v.parent}`)
            .join(", ");
          throw new Error(`Migrations left ${violations.length} foreign key violation(s): ${sample}. Rolled back.`);
        }
      })
      .immediate();
  } finally {
    if (fkWasOn) sqlite.pragma("foreign_keys = ON");
  }
}

export function openDatabase(path: string, migrationsFolder = MIGRATIONS_FOLDER): DB {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  try {
    runMigrations(sqlite, migrationsFolder);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return drizzle(sqlite, { schema });
}
