import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "path";
import { readConfig, config, SETTINGS_ID } from "@/server/config";

describe("readConfig", () => {
  it("returns the current defaults for an empty env", () => {
    expect(readConfig({})).toEqual({
      ollamaUrl: "http://localhost:11434",
      comfyuiUrl: "http://localhost:8188",
      comfyuiWsUrl: "ws://localhost:8188/ws",
      outputDir: "D:/ai-output/rpg",
      comfyuiInputDir: "D:/ai-input",
      dbPath: join(process.cwd(), "data", "rpg.db"),
      ollamaNumCtx: 12288,
    });
  });

  it("honors every override", () => {
    expect(
      readConfig({
        OLLAMA_URL: "http://gpu:11434",
        COMFYUI_URL: "http://gpu:8188",
        COMFYUI_WS_URL: "ws://gpu:8188/ws",
        RPG_OUTPUT_DIR: "/tmp/out",
        COMFYUI_INPUT_DIR: "/tmp/in",
        DB_PATH: ":memory:",
        OLLAMA_NUM_CTX: "8192",
      }),
    ).toEqual({
      ollamaUrl: "http://gpu:11434",
      comfyuiUrl: "http://gpu:8188",
      comfyuiWsUrl: "ws://gpu:8188/ws",
      outputDir: "/tmp/out",
      comfyuiInputDir: "/tmp/in",
      dbPath: ":memory:",
      ollamaNumCtx: 8192,
    });
  });

  it("rejects a non-numeric OLLAMA_NUM_CTX", () => {
    expect(() => readConfig({ OLLAMA_NUM_CTX: "lots" })).toThrow(/OLLAMA_NUM_CTX/);
  });
});

describe("empty and invalid env vars", () => {
  it("treats empty strings as unset", () => {
    expect(readConfig({ OLLAMA_URL: "", COMFYUI_URL: "", RPG_OUTPUT_DIR: "", DB_PATH: "", OLLAMA_NUM_CTX: "" })).toEqual(readConfig({}));
  });
});

describe("config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves from process.env when read, so stubbed env vars take effect", () => {
    vi.stubEnv("RPG_OUTPUT_DIR", "/tmp/stubbed");
    expect(config.outputDir).toBe("/tmp/stubbed");
  });

  it("keeps DB_PATH=:memory: under vitest", () => {
    expect(config.dbPath).toBe(":memory:");
  });

  it("exposes the single settings row id", () => {
    expect(SETTINGS_ID).toBe("default");
  });

  it("empty strings fall back to defaults through config too", () => {
    vi.stubEnv("COMFYUI_URL", "");
    vi.stubEnv("OLLAMA_NUM_CTX", "");
    expect(config.comfyuiUrl).toBe("http://localhost:8188");
    expect(config.ollamaNumCtx).toBe(12288);
  });

  it("a bad COMFYUI_URL only breaks the field that reads it", () => {
    vi.stubEnv("COMFYUI_URL", "not a url");
    expect(config.dbPath).toBe(":memory:");
    expect(config.ollamaUrl).toBe("http://localhost:11434");
    expect(() => config.comfyuiUrl).toThrow(/COMFYUI_URL/);
  });
});
