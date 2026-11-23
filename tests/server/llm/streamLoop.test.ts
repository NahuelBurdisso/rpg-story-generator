import { describe, it, expect } from "vitest";
import { readStream } from "@/server/llm/streamLoop";

function streamOf(chunks: string[]): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  const enc = new TextEncoder();
  let i = 0;
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
    cancel() {
      wasCancelled = true;
    },
  });
  return { body, cancelled: () => wasCancelled };
}

/** Parses lines like `t:<text>`; anything else is ignored; `bad` throws. */
const parseLine = (line: string): string | null => {
  const l = line.trim();
  if (l === "bad") throw new Error("malformed");
  return l.startsWith("t:") ? l.slice(2) : null;
};

describe("readStream", () => {
  it("accumulates deltas and calls onChunk for each", async () => {
    const { body } = streamOf(["t:Hello\nt: wor", "ld\n"]);
    const seen: string[] = [];
    const out = await readStream(body, parseLine, async (c) => void seen.push(c));
    expect(out).toBe("Hello world");
    expect(seen).toEqual(["Hello", " world"]);
  });

  it("reassembles a line split across chunks", async () => {
    const { body } = streamOf(["t:ab", "cd", "ef\nt:gh\n"]);
    const seen: string[] = [];
    const out = await readStream(body, parseLine, async (c) => void seen.push(c));
    expect(seen).toEqual(["abcdef", "gh"]);
    expect(out).toBe("abcdefgh");
  });

  it("processes the trailing buffer when the stream does not end with a newline", async () => {
    const { body } = streamOf(["t:one\nt:two"]);
    const out = await readStream(body, parseLine, async () => {});
    expect(out).toBe("onetwo");
  });

  it("ignores malformed and non-delta lines", async () => {
    const { body } = streamOf(["bad\n\n:comment\nt:ok\nbad\n"]);
    const out = await readStream(body, parseLine, async () => {});
    expect(out).toBe("ok");
  });

  it("cuts the stream on repetition, cancels the reader and returns the trimmed text", async () => {
    const lines = ["t:The knight rode north through the cold forest at dawn. \n"];
    for (let i = 0; i < 30; i++) lines.push("t: and then and then\n");
    lines.push("t:SHOULD NOT APPEAR\n");
    const { body, cancelled } = streamOf(lines);
    const out = await readStream(body, parseLine, async () => {});
    expect(cancelled()).toBe(true);
    expect(out).not.toContain("SHOULD NOT APPEAR");
    expect(out.startsWith("The knight rode north")).toBe(true);
    expect(out.length).toBeLessThan(lines.join("").length);
  });

  it("propagates a reader error", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("boom"));
      },
    });
    await expect(readStream(body, parseLine, async () => {})).rejects.toThrow("boom");
  });
});
