import { describe, it, expect, vi } from "vitest";
import { narrate } from "@/server/pipeline/narrate";
import { LLMAbortedError, type ProviderConfig, type callLLM } from "@/server/llm/providers";

const primary: ProviderConfig = { provider: "ollama", model: "big" };
const fallback: ProviderConfig = { provider: "ollama", model: "small" };

/** Scripted fake callLLM: each entry streams its chunks, then returns or throws. */
function script(steps: { chunks: string[]; fail?: Error }[]) {
  const configs: string[] = [];
  const call = vi.fn<typeof callLLM>(async (config, _messages, onChunk) => {
    configs.push(config.model);
    const step = steps.shift()!;
    for (const c of step.chunks) await onChunk(c);
    if (step.fail) throw step.fail;
    return step.chunks.join("");
  });
  return { call, configs };
}

const base = { messages: [{ role: "user" as const, content: "x" }], options: {}, retryDelayMs: 0 };

describe("narrate", () => {
  it("resets the client before re-streaming after a partial attempt", async () => {
    const { call } = script([{ chunks: ["Hel"], fail: new Error("socket hang up") }, { chunks: ["Hello there."] }]);
    const events: string[] = [];
    const text = await narrate({ ...base, primary, fallback, onToken: (t) => events.push(t), onReset: () => events.push("<reset>") }, call);
    expect(text).toBe("Hello there.");
    expect(events).toEqual(["Hel", "<reset>", "Hello there."]);
  });

  it("does not reset when the failed attempt sent nothing", async () => {
    const { call } = script([{ chunks: [], fail: new Error("ECONNREFUSED") }, { chunks: ["Hi."] }]);
    const onReset = vi.fn();
    await narrate({ ...base, primary, fallback, onToken: () => {}, onReset }, call);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("skips the primary's retries on a non-transient error and goes to the fallback", async () => {
    const authErr = Object.assign(new Error("bad key"), { errorType: "auth_failed" });
    const { call, configs } = script([{ chunks: [], fail: authErr }, { chunks: ["ok"] }]);
    await narrate({ ...base, primary, fallback, retries: 2 }, call);
    expect(configs).toEqual(["big", "small"]);
  });

  it("rethrows an abort without trying the fallback", async () => {
    const { call, configs } = script([{ chunks: ["a"], fail: new LLMAbortedError() }, { chunks: ["never"] }]);
    await expect(narrate({ ...base, primary, fallback }, call)).rejects.toBeInstanceOf(LLMAbortedError);
    expect(configs).toEqual(["big"]);
  });

  it("aborting during the retry delay rejects promptly, and the client was reset before the wait", async () => {
    const { call, configs } = script([{ chunks: ["Hel"], fail: new Error("socket hang up") }, { chunks: ["never"] }]);
    const ctrl = new AbortController();
    const events: string[] = [];
    const started = Date.now();
    const p = narrate(
      { ...base, retryDelayMs: 10_000, primary, fallback, signal: ctrl.signal,
        onToken: (t) => events.push(t), onReset: () => { events.push("<reset>"); ctrl.abort(); } },
      call,
    );
    await expect(p).rejects.toBeInstanceOf(LLMAbortedError);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(events).toEqual(["Hel", "<reset>"]);
    expect(configs).toEqual(["big"]);
  });

  it("throws the last error when there is no fallback and retries run out", async () => {
    const { call, configs } = script([{ chunks: [], fail: new Error("e1") }, { chunks: [], fail: new Error("e2") }]);
    await expect(narrate({ ...base, primary, fallback: null, retries: 1 }, call)).rejects.toThrow("e2");
    expect(configs).toEqual(["big", "big"]);
  });

  it("stops forwarding at a mechanic marker (streamBeforeMarker per attempt)", async () => {
    const { call } = script([{ chunks: ["You swing. ", "[MECHANIC:damage:1d6] more"] }]);
    const seen: string[] = [];
    await narrate({ ...base, primary, fallback: null, onToken: (t) => seen.push(t) }, call);
    expect(seen.join("")).toBe("You swing. ");
  });
});
