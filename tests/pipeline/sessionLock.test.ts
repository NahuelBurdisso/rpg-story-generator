import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@/server/db/schema";
import { createTestDb, seedSession } from "../helpers/testDb";
import {
  tryAcquireSessionLock,
  releaseSessionLock,
  refreshSessionLock,
  startLockKeepAlive,
  SESSION_LOCK_STALE_MS,
  SESSION_LOCK_KEEPALIVE_MS,
} from "@/server/pipeline/sessionLock";

describe("session lock", () => {
  it("lets exactly one caller in until released", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    expect(tryAcquireSessionLock(db, session.id, 1_000)).toBe(true);
    expect(tryAcquireSessionLock(db, session.id, 1_001)).toBe(false);
    releaseSessionLock(db, session.id);
    expect(tryAcquireSessionLock(db, session.id, 1_002)).toBe(true);
    db.$client.close();
  });

  it("takes over a stale lock left by a crashed turn", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    tryAcquireSessionLock(db, session.id, 1_000);
    expect(tryAcquireSessionLock(db, session.id, 1_000 + SESSION_LOCK_STALE_MS + 1)).toBe(true);
    db.$client.close();
  });

  it("refuses an unknown session", () => {
    const db = createTestDb();
    expect(tryAcquireSessionLock(db, "nope")).toBe(false);
    db.$client.close();
  });

  it("refresh resets the stale clock of a held lock", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    expect(tryAcquireSessionLock(db, session.id, 1_000)).toBe(true);
    refreshSessionLock(db, session.id, 1_000 + SESSION_LOCK_STALE_MS);
    expect(tryAcquireSessionLock(db, session.id, 1_000 + SESSION_LOCK_STALE_MS + 1)).toBe(false);
    db.$client.close();
  });

  it("keep-alive re-stamps a held lock until stopped", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const db = createTestDb();
    const { session } = seedSession(db);
    const stamp = () => db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.processingStartedAt;
    try {
      expect(tryAcquireSessionLock(db, session.id)).toBe(true);
      const stop = startLockKeepAlive(db, session.id);
      vi.advanceTimersByTime(SESSION_LOCK_KEEPALIVE_MS);
      expect(stamp()).toBe(1_000_000 + SESSION_LOCK_KEEPALIVE_MS);
      // A turn that runs past the stale window is still not stealable.
      vi.advanceTimersByTime(SESSION_LOCK_STALE_MS);
      expect(tryAcquireSessionLock(db, session.id)).toBe(false);
      stop();
      const last = stamp();
      vi.advanceTimersByTime(SESSION_LOCK_KEEPALIVE_MS * 3);
      expect(stamp()).toBe(last);
    } finally {
      vi.useRealTimers();
      db.$client.close();
    }
  });

  it("keep-alive logs a failed refresh instead of throwing", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createTestDb();
    const { session } = seedSession(db);
    const stop = startLockKeepAlive(db, session.id);
    db.$client.close();
    try {
      expect(() => vi.advanceTimersByTime(SESSION_LOCK_KEEPALIVE_MS)).not.toThrow();
      expect(err).toHaveBeenCalled();
    } finally {
      stop();
      err.mockRestore();
      vi.useRealTimers();
    }
  });
});
