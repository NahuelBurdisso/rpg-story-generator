import { describe, it, expect, vi, beforeEach } from "vitest";

const runPipeline = vi.fn();
vi.mock("@/server/pipeline/orchestrator", () => ({ runPipeline: (p: unknown) => runPipeline(p) }));

import { POST } from "@/app/api/chat/stream/route";
import { db } from "@/server/db";
import { messages } from "@/server/db/schema";
import { openerPrompt } from "@/server/pipeline/sessionOpener";
import { seedSession, seedCharacter } from "../helpers/testDb";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  runPipeline.mockReset();
  runPipeline.mockImplementation(async (p: { onToken: (t: string) => void; onComplete: (t: string, id: string) => void }) => {
    p.onToken("Hi");
    p.onComplete("Hi there", "m1");
  });
});

describe("POST /api/chat/stream — body validation", () => {
  it.each([
    ["not JSON", "{nope", "Invalid JSON body"],
    ["a JSON null", "null", "Invalid JSON body"],
    ["missing sessionId", { message: "hi" }, "sessionId is required"],
    ["empty sessionId", { sessionId: "", message: "hi" }, "sessionId is required"],
    ["non-string sessionId", { sessionId: 5, message: "hi" }, "sessionId is required"],
    ["missing message", { sessionId: "s1" }, "message is required"],
    ["empty message", { sessionId: "s1", message: "" }, "message is required"],
    ["non-string message", { sessionId: "s1", message: 3 }, "message is required"],
  ])("%s -> 400 { error }", async (_name, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("rejects a message over 8000 characters", async () => {
    const res = await post({ sessionId: "s1", message: "x".repeat(8001) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message is too long (max 8000 characters)" });
  });

  it("accepts exactly 8000 characters", async () => {
    const res = await post({ sessionId: "s1", message: "x".repeat(8000) });
    expect(res.status).toBe(200);
    await res.text();
  });

  it("rejects malformed metadata", async () => {
    const res = await post({ sessionId: "s1", message: "hi", metadata: { diceRoll: { dice: "d7", result: "high" } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "metadata is invalid" });
    expect(runPipeline).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/stream — streaming", () => {
  it("streams the pipeline's tokens and done event", async () => {
    const res = await post({ sessionId: "s1", message: "hi" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain('data: {"type":"token","text":"Hi"}');
    expect(text).toContain('data: {"type":"done","text":"Hi there","messageId":"m1"}');
    expect(runPipeline).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1", message: "hi", metadata: undefined }));
  });

  it("passes client metadata through and strips server-only fields", async () => {
    const res = await post({
      sessionId: "s1",
      message: "hi",
      metadata: { diceRoll: { dice: "d20", result: 17 }, action: "attack", imageId: "x", mechanics: [{ text: "t", outcome: "success" }] },
    });
    await res.text();
    expect(runPipeline.mock.calls[0][0].metadata).toEqual({ diceRoll: { dice: "d20", result: 17 }, action: "attack" });
  });

  it("emits an error event when the pipeline throws", async () => {
    runPipeline.mockRejectedValue(new Error("kaboom"));
    const res = await post({ sessionId: "s1", message: "hi" });
    expect(await res.text()).toContain('data: {"type":"error","message":"kaboom"}');
  });
});

describe("POST /api/chat/stream — session opener", () => {
  it("builds the opener turn server-side and flags it in metadata", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id, { name: "Aria" });
    const res = await post({ sessionId: session.id, opener: true });
    expect(res.status).toBe(200);
    await res.text();
    const call = runPipeline.mock.calls[0][0];
    expect(call.sessionId).toBe(session.id);
    expect(call.message).toBe(openerPrompt("Aria", null));
    expect(call.message.startsWith("[SESSION START")).toBe(true);
    expect(call.metadata).toEqual({ opener: true });
  });

  it("answers 409 { error } when the session already started, without running the pipeline", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    db.insert(messages).values({ sessionId: session.id, role: "user", content: "hi" }).run();
    const res = await post({ sessionId: session.id, opener: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This session has already started." });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown session", async () => {
    const res = await post({ sessionId: "nope", opener: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("still validates the sessionId on an opener request", async () => {
    const res = await post({ sessionId: "", opener: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "sessionId is required" });
  });

  it("does not let a client flag a normal turn as the opener", async () => {
    const res = await post({ sessionId: "s1", message: "hi", metadata: { opener: true, action: "a" } });
    await res.text();
    expect(runPipeline.mock.calls[0][0].metadata).toEqual({ action: "a" });
  });
});
