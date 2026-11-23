// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode } from "react";
import { useSessionOpener } from "@/hooks/use-session-opener";
import type { SendResult } from "@/hooks/use-chat";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("useSessionOpener", () => {
  it("does nothing until ready, then opens exactly once", async () => {
    const sendOpener = vi.fn().mockResolvedValue({ ok: true } satisfies SendResult);
    const { rerender } = renderHook(({ ready }) => useSessionOpener({ sessionId: "s1", ready, sendOpener }), {
      initialProps: { ready: false },
    });
    expect(sendOpener).not.toHaveBeenCalled();
    rerender({ ready: true });
    await flush();
    rerender({ ready: true });
    expect(sendOpener).toHaveBeenCalledTimes(1);
    expect(sendOpener).toHaveBeenCalledWith("s1");
  });

  it("re-arms after an abort that was not the player's Stop", async () => {
    const sendOpener = vi
      .fn<(id: string) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, aborted: true, stoppedByUser: false })
      .mockResolvedValue({ ok: true });
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
    await flush();
    await flush();
    expect(sendOpener).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the player pressed Stop", async () => {
    const sendOpener = vi.fn().mockResolvedValue({ ok: false, aborted: true, stoppedByUser: true } satisfies SendResult);
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
    await flush();
    await advance(5000);
    expect(sendOpener).toHaveBeenCalledTimes(1);
  });

  it("retries once after ~2s when the session is still processing, and never a second time", async () => {
    const sendOpener = vi
      .fn<(id: string) => Promise<SendResult>>()
      .mockResolvedValue({ ok: false, error: "This session is already processing a turn — wait for it to finish." });
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
    await flush();
    expect(sendOpener).toHaveBeenCalledTimes(1);
    await advance(1900);
    expect(sendOpener).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(sendOpener).toHaveBeenCalledTimes(2);
    await advance(10000);
    expect(sendOpener).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 409 \"already started\" too", async () => {
    const sendOpener = vi
      .fn<(id: string) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, status: 409, error: "This session has already started." })
      .mockResolvedValue({ ok: true });
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
    await flush();
    await advance(2100);
    expect(sendOpener).toHaveBeenCalledTimes(2);
  });

  it.each(["This session has ended.", "Create a character before starting the session."])(
    "does not retry a 409 that cannot clear up (%s)",
    async (error) => {
      const sendOpener = vi.fn().mockResolvedValue({ ok: false, status: 409, error } satisfies SendResult);
      renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
      await flush();
      await advance(10000);
      expect(sendOpener).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry other failures (no loop on a real error)", async () => {
    const sendOpener = vi.fn().mockResolvedValue({ ok: false, error: "The narrator timed out" } satisfies SendResult);
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }));
    await flush();
    await advance(10000);
    expect(sendOpener).toHaveBeenCalledTimes(1);
  });

  it("skips the delayed retry if the session is no longer ready (history arrived)", async () => {
    const sendOpener = vi.fn().mockResolvedValue({ ok: false, status: 409, error: "This session has already started." } satisfies SendResult);
    const { rerender } = renderHook(({ ready }) => useSessionOpener({ sessionId: "s1", ready, sendOpener }), {
      initialProps: { ready: true },
    });
    await flush();
    rerender({ ready: false });
    await advance(3000);
    expect(sendOpener).toHaveBeenCalledTimes(1);
  });

  it("opens only once under StrictMode when the first send resolves ok", async () => {
    const sendOpener = vi.fn().mockResolvedValue({ ok: true } satisfies SendResult);
    renderHook(() => useSessionOpener({ sessionId: "s1", ready: true, sendOpener }), { wrapper: StrictMode });
    await flush();
    expect(sendOpener).toHaveBeenCalledTimes(1);
  });
});
