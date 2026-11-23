import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "@/server/db";
import type * as Images from "@/server/routers/images";
import { enqueueBackground, turnStateKey } from "@/server/pipeline/backgroundQueue";
import { seedSession } from "../../helpers/testDb";

// server/config resolves these when read: keep any write inside temp dirs.
vi.stubEnv("RPG_OUTPUT_DIR", mkdtempSync(join(tmpdir(), "rpg-refs-")));
vi.stubEnv("COMFYUI_INPUT_DIR", mkdtempSync(join(tmpdir(), "rpg-input-")));

const buildImageContext = vi.fn();
const generateSceneImage = vi.fn();
vi.mock("@/server/image/buildImageContext", () => ({ buildImageContext: (...a: unknown[]) => buildImageContext(...a) }));
vi.mock("@/server/image/imageOrchestrator", () => ({ generateSceneImage: (...a: unknown[]) => generateSceneImage(...a) }));

let imagesRouter: typeof Images.imagesRouter;
beforeAll(async () => {
  ({ imagesRouter } = await import("@/server/routers/images"));
});

const fakeContext = () => ({
  messageId: "m1",
  campaign: { id: "c1" },
  chars: [],
  session: {},
  finalText: "text",
  relevantNPCs: [],
  llmConfig: {},
  baseUrl: "http://localhost:11434",
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  buildImageContext.mockReset();
  generateSceneImage.mockReset();
  buildImageContext.mockResolvedValue(fakeContext());
  // The real job reports the new "generating" row through onRecordCreated before it renders.
  generateSceneImage.mockImplementation(async (ctx: { onRecordCreated?: (id: string) => void }) => {
    ctx.onRecordCreated?.("img-1");
  });
});

describe("images.illustrate vs. step 3", () => {
  const caller = () => imagesRouter.createCaller({ db });

  it("waits for the session's pending step-3 job before building the image context", async () => {
    const { session } = seedSession(db);
    const gate = deferred();
    void enqueueBackground(turnStateKey(session.id), () => gate.promise);

    let done = false;
    const p = caller().illustrate({ sessionId: session.id }).then((r) => { done = true; return r; });
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    expect(buildImageContext).not.toHaveBeenCalled();

    gate.resolve();
    await expect(p).resolves.toMatchObject({ status: "started" });
    expect(buildImageContext).toHaveBeenCalledWith(session.id);
    expect(generateSceneImage).toHaveBeenCalledTimes(1);
  });

  it("returns already_generating for a second concurrent illustrate on the same session", async () => {
    const { session } = seedSession(db);
    const gate = deferred();
    void enqueueBackground(turnStateKey(session.id), () => gate.promise);

    const first = caller().illustrate({ sessionId: session.id });
    await new Promise((r) => setTimeout(r, 10));
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toEqual({ status: "already_generating" });

    gate.resolve();
    await expect(first).resolves.toMatchObject({ status: "started" });
    expect(generateSceneImage).toHaveBeenCalledTimes(1);
  });

  it("releases the starting guard when the job settles, even on no_content", async () => {
    const { session } = seedSession(db);
    buildImageContext.mockResolvedValueOnce(null);
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toEqual({ status: "no_content" });
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toMatchObject({ status: "started" });
  });

  it("returns the new image id once the generating row exists", async () => {
    const { session } = seedSession(db);
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toEqual({ status: "started", imageId: "img-1" });
  });

  it("returns unavailable when the job ends without creating a row", async () => {
    const { session } = seedSession(db);
    generateSceneImage.mockResolvedValueOnce(undefined);
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toEqual({ status: "unavailable" });
  });

  it("returns unavailable when the job throws before creating a row", async () => {
    const { session } = seedSession(db);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    generateSceneImage.mockRejectedValueOnce(new Error("boom"));
    await expect(caller().illustrate({ sessionId: session.id })).resolves.toEqual({ status: "unavailable" });
    spy.mockRestore();
  });
});
