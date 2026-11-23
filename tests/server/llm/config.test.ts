import { describe, it, expect } from "vitest";
import { buildProviderConfig, buildFallbackConfig, buildLocalConfig, defaultOllamaUrl, FALLBACK_OLLAMA_MODEL } from "@/server/llm/config";
import { DEFAULT_OLLAMA_MODEL } from "@/server/llm/providers";
import type { UserSettingsRow } from "@/server/db/schema";

const settings = (over: Partial<UserSettingsRow>) => over as UserSettingsRow;

describe("buildProviderConfig", () => {
  it("defaults to local Ollama with the default model", () => {
    expect(buildProviderConfig(undefined)).toEqual({
      provider: "ollama", model: DEFAULT_OLLAMA_MODEL, ollamaBaseUrl: defaultOllamaUrl(), apiKey: undefined,
    });
  });
  it("passes the matching API key for cloud providers only", () => {
    const s = settings({ provider: "openai", selectedModel: "gpt-4o", openaiApiKey: "sk-o", anthropicApiKey: "sk-a" });
    expect(buildProviderConfig(s).apiKey).toBe("sk-o");
    expect(buildProviderConfig({ ...s, provider: "anthropic" }).apiKey).toBe("sk-a");
    expect(buildProviderConfig({ ...s, provider: "ollama" }).apiKey).toBeUndefined();
  });
});

describe("buildFallbackConfig", () => {
  it("uses the small local model for Ollama users", () => {
    expect(buildFallbackConfig(settings({ provider: "ollama", ollamaBaseUrl: "http://gpu:11434" }))).toEqual({
      provider: "ollama", model: FALLBACK_OLLAMA_MODEL, ollamaBaseUrl: "http://gpu:11434",
    });
  });
  it("never switches a cloud user to a local model", () => {
    expect(buildFallbackConfig(settings({ provider: "openai" }))).toBeNull();
    expect(buildFallbackConfig(settings({ provider: "anthropic" }))).toBeNull();
  });
});

describe("buildLocalConfig", () => {
  it("keeps the user's model when they use Ollama", () => {
    expect(buildLocalConfig(settings({ provider: "ollama", selectedModel: "gemma4:e4b" })).model).toBe("gemma4:e4b");
  });
  it("falls back to the default local model for cloud users", () => {
    const c = buildLocalConfig(settings({ provider: "openai", selectedModel: "gpt-4o" }));
    expect(c).toMatchObject({ provider: "ollama", model: DEFAULT_OLLAMA_MODEL });
  });
});
