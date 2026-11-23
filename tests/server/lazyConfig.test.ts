import { describe, it, expect, vi, afterEach } from "vitest";

describe("lazy config reads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("importing llm/config and userSettings router does not throw on a bad OLLAMA_URL", async () => {
    vi.stubEnv("OLLAMA_URL", "not a url");
    vi.resetModules();
    const llm = await import("@/server/llm/config");
    await import("@/server/routers/userSettings");
    // The error only surfaces when the value is actually read.
    expect(() => llm.defaultOllamaUrl()).toThrow(/OLLAMA_URL/);
  });
});
