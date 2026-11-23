/**
 * Exclusive GPU hold for image generation. Ollama calls wait while it is held,
 * so a chat turn can't reload the model onto the GPU mid-render. The holder
 * gets a token; only that token releases it. A hold older than
 * GPU_HOLD_STALE_MS is presumed abandoned (crashed job). Kept on globalThis so
 * Next dev HMR doesn't fork the state.
 */
export const GPU_HOLD_STALE_MS = 300_000;

interface GateState {
  holder: { token: string; since: number } | null;
  waiters: Set<() => void>;
}
const g = globalThis as typeof globalThis & { __rpgGpuGate?: GateState };
const state = (g.__rpgGpuGate ??= { holder: null, waiters: new Set() });

function expireStale(now: number): void {
  if (state.holder && now - state.holder.since > GPU_HOLD_STALE_MS) {
    console.warn("[gpu] stale hold expired");
    state.holder = null;
    wake();
  }
}

function wake(): void {
  for (const w of [...state.waiters]) w();
  state.waiters.clear();
}

export function tryHoldGpu(now = Date.now()): string | null {
  expireStale(now);
  if (state.holder) return null;
  const token = crypto.randomUUID();
  state.holder = { token, since: now };
  return token;
}

export function releaseGpu(token: string): boolean {
  if (state.holder?.token !== token) return false;
  state.holder = null;
  wake();
  return true;
}

export function isGpuHeld(now = Date.now()): boolean {
  expireStale(now);
  return state.holder !== null;
}

/** Resolves when the GPU is free, after `timeoutMs`, or when `signal` aborts — whichever comes first. */
export function waitForGpu(timeoutMs = GPU_HOLD_STALE_MS, signal?: AbortSignal): Promise<void> {
  if (!isGpuHeld() || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      state.waiters.delete(done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    state.waiters.add(done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function _resetGpuGateForTests(): void {
  state.holder = null;
  wake();
}
