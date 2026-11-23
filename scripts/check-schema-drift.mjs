/* global process, console */
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
