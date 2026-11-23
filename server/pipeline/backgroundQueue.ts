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
