import { describe, it, expect, vi, afterEach } from "vitest";
import { callLLM } from "@/server/llm/providers";

afterEach(() => vi.unstubAllGlobals());

function stubStream(text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(text, { status: 200 })));
}

describe("provider stream parsing", () => {
  it("ollama: NDJSON message.content, including a final line without newline", async () => {
    stubStream('{"message":{"content":"Hel"}}\n{"message":{"content":"lo"}}\n{"done":true}\n{"message":{"content":"!"}}');
    const seen: string[] = [];
    const out = await callLLM(
      { provider: "ollama", model: "m", ollamaBaseUrl: "http://x" },
      [{ role: "user", content: "hi" }],
      async (c) => void seen.push(c),
      {},
      { priority: "streaming", retries: 0 }
    );
    expect(out).toBe("Hello!");
    expect(seen).toEqual(["Hel", "lo", "!"]);
  });

  it("openai: SSE deltas, skips [DONE] and processes the trailing line", async () => {
    stubStream(
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":" there"}}]}'
    );
    const out = await callLLM({ provider: "openai", model: "m", apiKey: "k" }, [{ role: "user", content: "hi" }], async () => {}, {}, { retries: 0 });
    expect(out).toBe("Hi there");
  });

  it("anthropic: content_block_delta text_delta only, plus trailing line", async () => {
    stubStream(
      'event: message_start\ndata: {"type":"message_start"}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"x"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}'
    );
    const out = await callLLM(
      { provider: "anthropic", model: "m", apiKey: "k" },
      [{ role: "system", content: "s" }, { role: "user", content: "hi" }],
      async () => {},
      {},
      { retries: 0 }
    );
    expect(out).toBe("Hey!");
  });
});
