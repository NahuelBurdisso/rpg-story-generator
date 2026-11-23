import { describe, it, expect, vi, afterEach } from "vitest";
import { callLLM, LLMAbortedError, classifyError } from "@/server/llm/providers";

const ollama = { provider: "ollama" as const, model: "m", ollamaBaseUrl: "http://x" };

/** fetch that never answers until its signal aborts (rejects at once if already aborted, like real fetch). */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("callLLM cancellation", () => {
  it("rejects with LLMAbortedError and does not retry when the caller aborts", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    const p = callLLM(ollama, [{ role: "user", content: "hi" }], async () => {}, {}, { priority: "streaming", retries: 2, retryDelayMs: 0, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(LLMAbortedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast when the signal is already aborted", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    ac.abort();
    await expect(callLLM(ollama, [], async () => {}, {}, { signal: ac.signal })).rejects.toBeInstanceOf(LLMAbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still retries ordinary failures", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callLLM(ollama, [], async () => {}, {}, { priority: "background", retries: 1, retryDelayMs: 0 })).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("classifyError", () => {
  it("treats undici's \"fetch failed\" as a connection failure", () => {
    expect(classifyError(new TypeError("fetch failed"), "ollama").errorType).toBe("connection_failed");
  });
});
