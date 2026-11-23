// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const invalidate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      messages: { listBySession: { invalidate } },
      characters: { listByCampaign: { invalidate } },
      sessions: { get: { invalidate } },
    }),
  },
}));

import { useChat } from "@/hooks/use-chat";

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}

`).join(""), { status: 200 });

beforeEach(() => {
  invalidate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidate.mockReset();
});

describe("useChat", () => {
  it("hands the draft back when the server rejects the request (non-OK response)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "message is too long (max 8000 characters)" }), { status: 400 })
    ));
    const { result } = renderHook(() => useChat("c1"));

    let sent: Awaited<ReturnType<typeof result.current.sendMessage>> | undefined;
    await act(async () => {
      sent = await result.current.sendMessage("s1", "my long draft");
    });

    expect(sent).toEqual({
      ok: false,
      restoreInput: "my long draft",
      status: 400,
      error: "message is too long (max 8000 characters)",
    });
    expect(result.current.error).toBe("message is too long (max 8000 characters)");
  });

  it("keeps the streamed text after done and reports the saved message id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse({ type: "token", text: "Hola" }, { type: "done", text: "Hola", messageId: "m9" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(result.current.streamingText).toBe("Hola");
    expect(result.current.committedMessageId).toBe("m9");
    expect(invalidate).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("clears the streamed text after the refetch when done carries no message id (older server)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse({ type: "token", text: "Hola" }, { type: "done", text: "Hola" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(result.current.committedMessageId).toBeNull();
    expect(result.current.streamingText).toBe("");
  });

  it("coalesces a burst of tokens into one animation frame", async () => {
    const raf = vi.fn((_cb: FrameRequestCallback) => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(
      { type: "token", text: "a" }, { type: "token", text: "b" }, { type: "token", text: "c" },
      { type: "done", text: "abc", messageId: "m1" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(result.current.streamingText).toBe("abc"); // done flushes synchronously
  });

  it("flushes pending tokens on the next animation frame", async () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => { frame = cb; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let push!: (chunk: string) => void;
    let fail!: (e: unknown) => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (chunk) => c.enqueue(new TextEncoder().encode(chunk));
        fail = (e) => c.error(e);
      },
    });
    // Like a real fetch, aborting the signal errors the body stream.
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
      return new Response(body, { status: 200 });
    }));
    const { result } = renderHook(() => useChat("c1"));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.sendMessage("s1", "hi"); });
    await act(async () => { push(`data: ${JSON.stringify({ type: "token", text: "ab" })}

`); await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.streamingText).toBe(""); // still buffered
    act(() => frame?.(0));
    expect(result.current.streamingText).toBe("ab");
    await act(async () => { push(`data: ${JSON.stringify({ type: "done", text: "ab", messageId: "m1" })}

`); await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.committedMessageId).toBe("m1");
    result.current.stop(); // the stream never closes on its own here
    await act(async () => { await pending; });
    expect(result.current.streamingText).toBe("ab"); // a late abort after done keeps the text
  });

  it("stands in with the server's cleaned final text, not the raw tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(
      { type: "token", text: "Hola [GM: echo]" }, { type: "done", text: "Hola", messageId: "m3" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(result.current.streamingText).toBe("Hola");
  });

  it("the no-id fallback does not wipe a newer turn's text", async () => {
    let releaseRefetch!: () => void;
    invalidate.mockReturnValueOnce(new Promise<void>((r) => { releaseRefetch = r; })); // turn 1's messages refetch
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(sse({ type: "token", text: "first" }, { type: "done", text: "first" }))
      .mockResolvedValueOnce(sse({ type: "token", text: "second" }, { type: "done", text: "second", messageId: "m2" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "one"); });
    await act(async () => { await result.current.sendMessage("s1", "two"); });
    expect(result.current.streamingText).toBe("second");
    await act(async () => { releaseRefetch(); await Promise.resolve(); });
    expect(result.current.streamingText).toBe("second"); // turn 1's late refetch is ignored
  });

  it("a reset drops the text streamed so far", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(
      { type: "token", text: "abc" }, { type: "reset" }, { type: "token", text: "x" },
      { type: "done", text: "x", messageId: "m2" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(result.current.streamingText).toBe("x");
  });

  it("sendOpener posts { sessionId, opener: true } and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse({ type: "token", text: "Hola" }, { type: "done", text: "Hola", messageId: "m1" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat("c1"));
    let sent: Awaited<ReturnType<typeof result.current.sendOpener>> | undefined;
    await act(async () => { sent = await result.current.sendOpener("s1"); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionId: "s1", opener: true });
    expect(sent).toEqual({ ok: true });
  });

  it("reports a 409 from the stream route in the result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "This session has already started." }), { status: 409 })));
    const { result } = renderHook(() => useChat("c1"));
    let sent: Awaited<ReturnType<typeof result.current.sendOpener>> | undefined;
    await act(async () => { sent = await result.current.sendOpener("s1"); });
    expect(sent).toMatchObject({ ok: false, status: 409, error: "This session has already started." });
  });

  it("refreshes the session row when a turn finishes, so isProcessing cannot stay stale", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse({ type: "token", text: "Hola" }, { type: "done", text: "Hola", messageId: "m1" })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendMessage("s1", "hi"); });
    expect(invalidate).toHaveBeenCalledWith({ id: "s1" });
  });

  it("refreshes history and the session row when the server rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "This session has already started." }), { status: 409 })));
    const { result } = renderHook(() => useChat("c1"));
    await act(async () => { await result.current.sendOpener("s1"); });
    expect(invalidate).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(invalidate).toHaveBeenCalledWith({ id: "s1" });
  });
});
