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

/** Well under SESSION_LOCK_STALE_MS, so a live turn's stamp never looks stale. */
export const SESSION_LOCK_KEEPALIVE_MS = 60_000;

/**
 * Keep a held lock fresh for as long as the turn runs. A healthy turn can
 * outlast the stale window (waiting on the previous step 3, LLM retries and
 * fallbacks queued behind background calls); without this a third request
 * would take the lock as stale and two turns would race. Returns `stop`.
 */
export function startLockKeepAlive(db: DbOrTx, sessionId: string): () => void {
  const timer = setInterval(() => {
    try {
      refreshSessionLock(db, sessionId);
    } catch (err) {
      console.error("[session-lock] keep-alive refresh failed", err);
    }
  }, SESSION_LOCK_KEEPALIVE_MS);
  return () => clearInterval(timer);
}
