import { afterEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase, baselineLegacyDatabase, runMigrations, LEGACY_BASELINE_MILLIS } from "@/server/db/open";
import { campaigns, npcMemory, sessions } from "@/server/db/schema";
import { npcMemoryRouter } from "@/server/routers/npcMemory";

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };

function readJournal(folder: string) {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] };
}

/**
 * Two copies of ./drizzle: `legacyDir` stops at the push-era baseline (what
 * `drizzle-kit push` had applied), `fullDir` also has a synthetic newer migration.
 */
function migrationFolders() {
  const root = mkdtempSync(join(tmpdir(), "rpg-legacy-"));
  const legacyDir = join(root, "legacy");
  const fullDir = join(root, "full");
  cpSync("drizzle", legacyDir, { recursive: true });
  cpSync("drizzle", fullDir, { recursive: true });

  const legacyJournalPath = join(legacyDir, "meta", "_journal.json");
  const legacyJournal = readJournal(legacyDir);
  legacyJournal.entries = legacyJournal.entries.filter((e) => e.when <= LEGACY_BASELINE_MILLIS);
  writeFileSync(legacyJournalPath, JSON.stringify(legacyJournal));

  const fullJournalPath = join(fullDir, "meta", "_journal.json");
  const fullJournal = readJournal(fullDir);
  fullJournal.entries.push({
    idx: fullJournal.entries.length,
    version: "6",
    when: Math.max(...fullJournal.entries.map((e) => e.when)) + 1000,
    tag: "9999_test_extra",
    breakpoints: true,
  });
  writeFileSync(fullJournalPath, JSON.stringify(fullJournal));
  writeFileSync(join(fullDir, "9999_test_extra.sql"), `CREATE TABLE "zz_probe" ("id" text PRIMARY KEY);`);
  return { root, legacyDir, fullDir };
}

/** A file DB shaped like one made by `drizzle-kit push`: all tables up to 0003, no journal, one campaign. */
function legacyDbFile(legacyDir: string, root: string): string {
  const file = join(root, "legacy.db");
  const sqlite = new Database(file);
  migrate(drizzle(sqlite), { migrationsFolder: legacyDir });
  sqlite.exec(`DROP TABLE "__drizzle_migrations"`);
  sqlite
    .prepare(`INSERT INTO campaigns (id, name, genre, tone, difficulty, created_at) VALUES ('c1', 'Survivor', 'fantasy', 'serious', 'normal', 1)`)
    .run();
  sqlite.close();
  return file;
}

/** Appends a migration to a copied ./drizzle folder, with a `when` after every existing entry. */
function addMigration(dir: string, tag: string, sql: string) {
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = readJournal(dir);
  const when = Math.max(...journal.entries.map((e) => e.when)) + 1000;
  journal.entries.push({ idx: journal.entries.length, version: "6", when, tag, breakpoints: true });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, `${tag}.sql`), sql);
}

const open: Database.Database[] = [];
function memDb() {
  const sqlite = new Database(":memory:");
  open.push(sqlite);
  return sqlite;
}
afterEach(() => {
  while (open.length) open.pop()!.close();
});

describe("openDatabase", () => {
  it("creates every table on an empty database", () => {
    const db = openDatabase(":memory:");
    expect(db.select().from(sessions).all()).toEqual([]);
    db.$client.close();
  });

  it("baselines a push-era file, keeps its rows, runs newer migrations, and is idempotent", () => {
    const { root, legacyDir, fullDir } = migrationFolders();
    const file = legacyDbFile(legacyDir, root);

    openDatabase(file, fullDir).$client.close();
    openDatabase(file, fullDir).$client.close();

    const check = new Database(file, { readonly: true });
    try {
      const journal = check.prepare(`SELECT created_at FROM "__drizzle_migrations"`).all();
      expect(journal.length).toBe(readJournal(fullDir).entries.length);
      expect(check.prepare(`SELECT name FROM sqlite_master WHERE name='zz_probe'`).get()).toBeTruthy();
      expect(check.prepare(`SELECT name FROM campaigns WHERE id='c1'`).get()).toEqual({ name: "Survivor" });
    } finally {
      check.close();
    }
  });

  it("opens a push-era file with the stock migrations", () => {
    const { root, legacyDir } = migrationFolders();
    const file = legacyDbFile(legacyDir, root);
    const db = openDatabase(file);
    try {
      expect(db.$client.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_npc_memory_campaign_lname'`).get()).toBeTruthy();
    } finally {
      db.$client.close();
    }
  });
});

describe("foreign keys", () => {
  it("leaves foreign_keys ON after opening", () => {
    const db = openDatabase(":memory:");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    db.$client.close();
  });

  it("does not cascade-delete child rows when a migration recreates the parent table", () => {
    const { root, fullDir } = migrationFolders();
    addMigration(
      fullDir,
      "9998_parent_child",
      `CREATE TABLE "zz_parent" ("id" text PRIMARY KEY NOT NULL, "name" text);--> statement-breakpoint
` +
        `CREATE TABLE "zz_child" ("id" text PRIMARY KEY NOT NULL, "parent_id" text NOT NULL REFERENCES "zz_parent"("id") ON DELETE cascade);`,
    );
    const file = join(root, "fk.db");
    const first = openDatabase(file, fullDir);
    first.$client.exec(`INSERT INTO zz_parent VALUES ('p1', 'a'); INSERT INTO zz_child VALUES ('k1', 'p1'), ('k2', 'p1')`);
    first.$client.close();

    // What drizzle-kit emits when it has to rebuild a table.
    addMigration(
      fullDir,
      "9999_recreate_parent",
      `CREATE TABLE "__new_zz_parent" ("id" text PRIMARY KEY NOT NULL, "name" text, "extra" text);--> statement-breakpoint
` +
        `INSERT INTO "__new_zz_parent"("id", "name") SELECT "id", "name" FROM "zz_parent";--> statement-breakpoint
` +
        `DROP TABLE "zz_parent";--> statement-breakpoint
` +
        `ALTER TABLE "__new_zz_parent" RENAME TO "zz_parent";`,
    );
    const second = openDatabase(file, fullDir);
    try {
      expect(second.$client.prepare(`SELECT id FROM zz_child ORDER BY id`).all()).toEqual([{ id: "k1" }, { id: "k2" }]);
      expect(second.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      second.$client.close();
    }
  });

  it("rolls back when a migration leaves dangling references", () => {
    const { root, fullDir } = migrationFolders();
    addMigration(
      fullDir,
      "9998_parent_child",
      `CREATE TABLE "zz_parent" ("id" text PRIMARY KEY NOT NULL);--> statement-breakpoint
` +
        `CREATE TABLE "zz_child" ("id" text PRIMARY KEY NOT NULL, "parent_id" text NOT NULL REFERENCES "zz_parent"("id") ON DELETE cascade);--> statement-breakpoint
` +
        `INSERT INTO "zz_child" VALUES ('k1', 'missing');`,
    );
    const file = join(root, "fk-bad.db");
    expect(() => openDatabase(file, fullDir)).toThrow(/foreign key/i);
    const check = new Database(file, { readonly: true });
    try {
      expect(check.prepare(`SELECT name FROM sqlite_master WHERE name='zz_child'`).get()).toBeUndefined();
    } finally {
      check.close();
    }
  });
});

describe("runMigrations foreign key handling", () => {
  it("restores foreign_keys ON after migrating, also when a migration fails", () => {
    const { fullDir } = migrationFolders();
    const sqlite = memDb();
    sqlite.pragma("foreign_keys = ON");
    runMigrations(sqlite, fullDir);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

    writeFileSync(join(fullDir, "9999_test_extra.sql"), `THIS IS NOT SQL;`);
    const failing = memDb();
    failing.pragma("foreign_keys = ON");
    expect(() => runMigrations(failing, fullDir)).toThrow();
    expect(failing.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("does not check pre-existing orphan rows when there is nothing to migrate", () => {
    const { root } = migrationFolders();
    const file = join(root, "orphan.db");
    const first = openDatabase(file);
    first.$client.pragma("foreign_keys = OFF");
    first.$client
      .prepare(`INSERT INTO sessions (id, campaign_id, title, started_at) VALUES ('s1', 'no-such-campaign', 'x', 1)`)
      .run();
    expect(first.$client.pragma("foreign_key_check")).not.toEqual([]);
    first.$client.close();

    const second = openDatabase(file);
    second.$client.close();
  });
});

describe("baselineLegacyDatabase", () => {
  it("does nothing on an empty database", () => {
    expect(baselineLegacyDatabase(memDb())).toBe(false);
  });

  it("records only the pre-cutoff migrations on a push-created database", () => {
    const sqlite = memDb();
    sqlite.exec(`CREATE TABLE sessions (id text primary key); CREATE TABLE memories (id text primary key)`);
    expect(baselineLegacyDatabase(sqlite)).toBe(true);
    const rows = sqlite.prepare(`SELECT created_at FROM "__drizzle_migrations"`).all() as { created_at: number }[];
    expect(rows.length).toBe(4);
    expect(Math.max(...rows.map((r) => Number(r.created_at)))).toBe(LEGACY_BASELINE_MILLIS);
  });

  it("is a no-op once the journal exists", () => {
    const sqlite = memDb();
    sqlite.exec(`CREATE TABLE sessions (id text primary key); CREATE TABLE memories (id text primary key)`);
    baselineLegacyDatabase(sqlite);
    expect(baselineLegacyDatabase(sqlite)).toBe(false);
  });

  it("refuses a database that has sessions but not memories", () => {
    const sqlite = memDb();
    sqlite.exec(`CREATE TABLE sessions (id text primary key)`);
    expect(() => baselineLegacyDatabase(sqlite)).toThrow(/npm run db:drift/);
    expect(sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE name='__drizzle_migrations'`).get()).toBeUndefined();
  });

  it("refuses unknown tables with no sessions and no journal", () => {
    const sqlite = memDb();
    sqlite.exec(`CREATE TABLE something_else (id text primary key)`);
    expect(() => baselineLegacyDatabase(sqlite)).toThrow(/unknown schema/);
  });

  it("refuses when the journal lost the baseline migration", () => {
    const { legacyDir } = migrationFolders();
    const journal = readJournal(legacyDir);
    journal.entries = journal.entries.filter((e) => e.when < LEGACY_BASELINE_MILLIS);
    writeFileSync(join(legacyDir, "meta", "_journal.json"), JSON.stringify(journal));
    const sqlite = memDb();
    sqlite.exec(`CREATE TABLE sessions (id text primary key); CREATE TABLE memories (id text primary key)`);
    expect(() => baselineLegacyDatabase(sqlite, legacyDir)).toThrow(/baseline migration/);
  });
});

describe("runMigrations", () => {
  it("rolls back everything when a migration fails", () => {
    const { fullDir } = migrationFolders();
    writeFileSync(join(fullDir, "9999_test_extra.sql"), `CREATE TABLE "zz_probe" ("id" text PRIMARY KEY);--> statement-breakpoint\nTHIS IS NOT SQL;`);
    const sqlite = memDb();
    expect(() => runMigrations(sqlite, fullDir)).toThrow();
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()).toEqual([]);
  });
});

describe("npc_memory uniqueness", () => {
  it("ignores a second NPC whose name differs only by case or whitespace", () => {
    const db = openDatabase(":memory:");
    const c = db.insert(campaigns).values({ name: "T", genre: "fantasy", tone: "serious", difficulty: "normal" }).returning().get();
    const base = { campaignId: c.id, personality: "", location: "", relationships: [], secrets: [], revealedInfo: [], memoryLog: [], currentState: "" };
    db.insert(npcMemory).values({ ...base, name: "Mara" }).onConflictDoNothing().run();
    db.insert(npcMemory).values({ ...base, name: " mara " }).onConflictDoNothing().run();
    expect(db.select().from(npcMemory).all()).toHaveLength(1);
    db.$client.close();
  });
});

describe("npcMemory.upsert", () => {
  it("updates the existing NPC when the name differs only by case or whitespace", async () => {
    const db = openDatabase(":memory:");
    const c = db.insert(campaigns).values({ name: "T", genre: "fantasy", tone: "serious", difficulty: "normal" }).returning().get();
    const caller = npcMemoryRouter.createCaller({ db });
    const input = { campaignId: c.id, personality: "p", location: "l", currentState: "s" };
    await caller.upsert({ ...input, name: "Mara" });
    const updated = await caller.upsert({ ...input, name: " mara ", currentState: "changed" });
    const rows = db.select().from(npcMemory).all();
    expect(rows).toHaveLength(1);
    expect(updated.id).toBe(rows[0].id);
    expect(rows[0].currentState).toBe("changed");
    db.$client.close();
  });
});

describe("npcMemory.upsert race", () => {
  it("resolves a concurrent first-insert collision as an update instead of a raw constraint error", async () => {
    const db = openDatabase(":memory:");
    const c = db.insert(campaigns).values({ name: "T", genre: "fantasy", tone: "serious", difficulty: "normal" }).returning().get();
    const caller = npcMemoryRouter.createCaller({ db });
    const input = { campaignId: c.id, personality: "p", location: "l", currentState: "s" };
    // Both calls read "no row" before either inserts; the second insert hits uq_npc_memory_campaign_lname.
    const [a, b] = await Promise.all([
      caller.upsert({ ...input, name: "Mara", currentState: "first" }),
      caller.upsert({ ...input, name: " MARA ", currentState: "second" }),
    ]);
    const rows = db.select().from(npcMemory).all();
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(rows[0].currentState).toBe("second");
    db.$client.close();
  });
});
