import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { acquireForImageGen, isImageGenActive } from "@/server/image/vramManager";
import { _resetGpuGateForTests, GPU_HOLD_STALE_MS } from "@/server/llm/gpuGate";

const BASE = "http://localhost:11434";

function stubFetch(psModels: { name: string }[] | "fail" = []) {
  const fn = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/ps")) {
      if (psModels === "fail") return Promise.reject(new Error("ollama down"));
      return Promise.resolve(new Response(JSON.stringify({ models: psModels })));
    }
    return Promise.resolve(new Response("{}"));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("vramManager", () => {
  beforeEach(() => {
    _resetGpuGateForTests();
    stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("isImageGenActive returns false when nothing holds the GPU", () => {
    expect(isImageGenActive()).toBe(false);
  });

  it("acquire returns a lease and marks image gen active", async () => {
    const lease = await acquireForImageGen(BASE, { skipVramCheck: true });
    expect(lease).not.toBeNull();
    expect(isImageGenActive()).toBe(true);
  });

  it("a second acquire returns null while the lease is held", async () => {
    await acquireForImageGen(BASE, { skipVramCheck: true });
    expect(await acquireForImageGen(BASE, { skipVramCheck: true })).toBeNull();
  });

  it("lease.release frees the GPU", async () => {
    const lease = await acquireForImageGen(BASE, { skipVramCheck: true });
    await lease!.release();
    expect(isImageGenActive()).toBe(false);
  });

  it("unloads every model Ollama reports as loaded", async () => {
    const fetchMock = stubFetch([{ name: "a" }, { name: "b" }]);
    await acquireForImageGen(BASE, { skipVramCheck: true });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/ps`, expect.anything());
    const posts = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/generate"));
    expect(posts).toHaveLength(2);
    const bodies = posts.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual(expect.arrayContaining([
      { model: "a", keep_alive: 0 },
      { model: "b", keep_alive: 0 },
    ]));
  });

  it("still returns a lease when /api/ps fails", async () => {
    stubFetch("fail");
    const lease = await acquireForImageGen(BASE, { skipVramCheck: true });
    expect(lease).not.toBeNull();
  });

  it("releasing a stale lease does not free a newer holder", async () => {
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow);
    const first = await acquireForImageGen(BASE, { skipVramCheck: true });
    spy.mockReturnValue(realNow + GPU_HOLD_STALE_MS + 1);
    const second = await acquireForImageGen(BASE, { skipVramCheck: true });
    expect(second).not.toBeNull();
    await first!.release();
    expect(isImageGenActive()).toBe(true);
    await second!.release();
    expect(isImageGenActive()).toBe(false);
  });
});
