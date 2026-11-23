import { mkdirSync } from "fs";
import { dirname } from "path";
import { openDatabase, type DB } from "./open";
import { config } from "../config";

export type { DB, Tx, DbOrTx } from "./open";

const dbPath = config.dbPath;
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

// Next dev re-evaluates modules on HMR; keep a single connection across reloads.
const g = globalThis as typeof globalThis & { __rpgDb?: DB };
export const db = (g.__rpgDb ??= openDatabase(dbPath));
