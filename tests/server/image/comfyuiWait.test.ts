import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "events";
import { waitForCompletion, getOutputFilename } from "@/server/image/comfyuiClient";

class FakeWs extends EventEmitter {
  close = vi.fn();
  msg(obj: unknown) { this.emit("message", Buffer.from(JSON.stringify(obj))); }
}
const noHistory = async () => false;

describe("waitForCompletion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /interrupt to ComfyUI when the generation times out (so it stops rendering)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 30, pollMs: 10, isDone: noHistory });
    await expect(p).rejects.toThrow(/timed out/);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/interrupt"));
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ method: "POST" });
  });

  it("still rejects with the timeout error when the interrupt request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 30, pollMs: 10, isDone: noHistory });
    await expect(p).rejects.toThrow(/timed out/);
  });

  it("resolves when ComfyUI reports our prompt finished executing (node null)", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "p1" } });
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on execution_success for our prompt", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "execution_success", data: { prompt_id: "p1" } });
    await expect(p).resolves.toBeUndefined();
  });

  it("ignores other prompts' events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 60, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "other" } });
    await expect(p).rejects.toThrow(/timed out/);
  });

  it("rejects on our execution_error", async () => {
    const ws = new FakeWs();
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "execution_error", data: { prompt_id: "p1", exception_message: "OOM" } });
    await expect(p).rejects.toThrow(/OOM/);
  });

  it("falls back to polling history when the socket drops", async () => {
    const ws = new FakeWs();
    let polls = 0;
    const isDone = async () => ++polls >= 2;
    const p = waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 5, isDone });
    ws.emit("close");
    await expect(p).resolves.toBeUndefined();
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("polls immediately when the socket was already closed before we started waiting", async () => {
    const ws = Object.assign(new FakeWs(), { readyState: 3 });
    let polls = 0;
    const isDone = async () => ++polls >= 1;
    await expect(
      waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 5, slowPollMs: 100_000, isDone }),
    ).resolves.toBeUndefined();
    expect(polls).toBe(1);
  });

  it("resolves via the slow poll when the socket stays open but silent", async () => {
    const ws = Object.assign(new FakeWs(), { readyState: 1 });
    let polls = 0;
    const isDone = async () => ++polls >= 2;
    await expect(
      waitForCompletion(ws, "p1", undefined, { timeoutMs: 1000, pollMs: 100_000, slowPollMs: 10, isDone }),
    ).resolves.toBeUndefined();
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("reports sampling progress for our prompt", async () => {
    const ws = new FakeWs();
    const onProgress = vi.fn();
    const p = waitForCompletion(ws, "p1", onProgress, { timeoutMs: 1000, pollMs: 10, isDone: noHistory });
    ws.msg({ type: "progress", data: { prompt_id: "p1", value: 5, max: 10 } });
    ws.msg({ type: "executing", data: { node: null, prompt_id: "p1" } });
    await p;
    expect(onProgress).toHaveBeenCalledWith({ percent: 50, phase: "sampling" });
  });
});

describe("getOutputFilename", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries while /history has not been written yet (completion event races the history entry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ p1: { outputs: { "7": { images: [{ filename: "out_00001_.png" }] } } } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getOutputFilename("p1")).resolves.toBe("out_00001_.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
