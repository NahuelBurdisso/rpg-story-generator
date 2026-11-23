import { and, eq, lt, or } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { sceneImages } from "../db/schema";

/** Longer than prompt writing (up to 300s GPU wait per attempt, plus retry) + VRAM wait + a 120s ComfyUI render. */
export const IMAGE_JOB_STALE_MS = 20 * 60_000;

const g = globalThis as typeof globalThis & { __rpgProcessStartedAt?: number };
/**
 * When this server process started (survives Next dev HMR). Derived from uptime,
 * not module evaluation: Next loads routes lazily, so a live job could predate
 * the first import of this module.
 */
export const PROCESS_STARTED_AT = (g.__rpgProcessStartedAt ??= Date.now() - process.uptime() * 1000);

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
