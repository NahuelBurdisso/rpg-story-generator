import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { tryHoldGpu, releaseGpu, isGpuHeld, waitForGpu, GPU_HOLD_STALE_MS, _resetGpuGateForTests } from "@/server/llm/gpuGate";

beforeEach(() => _resetGpuGateForTests());
afterEach(() => vi.useRealTimers());

describe("gpuGate", () => {
  it("is exclusive until the holder releases", () => {
    const t = tryHoldGpu(1_000)!;
    expect(t).toBeTruthy();
    expect(tryHoldGpu(1_001)).toBeNull();
    expect(releaseGpu(t)).toBe(true);
    expect(tryHoldGpu(1_002)).toBeTruthy();
  });

  it("ignores a release by a token that doesn't hold it", () => {
    const t = tryHoldGpu(1_000)!;
    expect(releaseGpu("someone-else")).toBe(false);
    expect(isGpuHeld(1_001)).toBe(true);
    releaseGpu(t);
  });

  it("expires a stale hold", () => {
    tryHoldGpu(1_000);
    expect(isGpuHeld(1_000 + GPU_HOLD_STALE_MS + 1)).toBe(false);
    expect(tryHoldGpu(1_000 + GPU_HOLD_STALE_MS + 1)).toBeTruthy();
  });

  it("wakes waiters on release", async () => {
    const t = tryHoldGpu()!;
    let woke = false;
    const w = waitForGpu(10_000).then(() => { woke = true; });
    await Promise.resolve();
    expect(woke).toBe(false);
    releaseGpu(t);
    await w;
    expect(woke).toBe(true);
  });

  it("gives up waiting after the timeout", async () => {
    vi.useFakeTimers();
    tryHoldGpu();
    const w = waitForGpu(5_000);
    vi.advanceTimersByTime(5_001);
    await expect(w).resolves.toBeUndefined();
  });

  it("waitForGpu resolves immediately when the signal aborts", async () => {
    tryHoldGpu();
    const ac = new AbortController();
    let woke = false;
    const w = waitForGpu(60_000, ac.signal).then(() => { woke = true; });
    await Promise.resolve();
    expect(woke).toBe(false);
    ac.abort();
    await w;
    expect(woke).toBe(true);
  });

  it("waitForGpu resolves immediately when the signal is already aborted", async () => {
    tryHoldGpu();
    const ac = new AbortController();
    ac.abort();
    await expect(waitForGpu(60_000, ac.signal)).resolves.toBeUndefined();
  });
});
