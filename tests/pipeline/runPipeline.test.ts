import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as Providers from "@/server/llm/providers";
import { eq } from "drizzle-orm";

vi.mock("@/server/llm/providers", async (orig) => {
  const actual = await orig<typeof Providers>();
  return { ...actual, callLLM: vi.fn() };
});

import { db } from "@/server/db";
import { messages, sessions } from "@/server/db/schema";
import { callLLM, LLMAbortedError } from "@/server/llm/providers";
import { runPipeline } from "@/server/pipeline/orchestrator";
import { tryAcquireSessionLock, releaseSessionLock } from "@/server/pipeline/sessionLock";
import { waitForBackground, turnStateKey, sessionAuxKey } from "@/server/pipeline/backgroundQueue";
import { seedSession, seedCharacter } from "../helpers/testDb";

const ACTION = "I search the abandoned warehouse for clues about the missing shipment.";
const mockLLM = vi.mocked(callLLM);
const touched = new Set<string>();

function run(sessionId: string, signal?: AbortSignal) {
  touched.add(sessionId);
  const out = {
    tokens: [] as string[], resets: 0, done: null as string | null, doneId: null as string | null,
    error: null as string | null, restore: undefined as string | undefined,
  };
  const p = runPipeline({
    sessionId, message: ACTION, signal,
    onToken: (t) => out.tokens.push(t),
    onReset: () => { out.resets++; },
    onComplete: (t, id) => { out.done = t; out.doneId = id; },
    onError: (e, details) => { out.error = e; out.restore = details?.restoreInput; },
  });
  return { p, out };
}

async function settle(sessionId: string) {
  await waitForBackground(turnStateKey(sessionId));
  await waitForBackground(sessionAuxKey(sessionId));
}

// Braces matter: returning the mock would make vitest call it as a cleanup hook.
beforeEach(() => {
  mockLLM.mockReset();
});
// Background work (step 3, summary, journal) must not leak into the next test.
afterEach(async () => {
  for (const id of touched) await settle(id);
  touched.clear();
});

describe("runPipeline", () => {
  it("narrates, commits the turn and releases the lock", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      if (opts?.priority === "streaming") { await onChunk("The warehouse is dark and cold. Crates loom in rows."); return "The warehouse is dark and cold. Crates loom in rows."; }
      return "{}";
    });
    const { p, out } = run(session.id);
    await p;
    await settle(session.id);
    expect(out.error).toBeNull();
    expect(out.done).toContain("warehouse");
    const rows = db.select().from(messages).where(eq(messages.sessionId, session.id)).all();
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(out.doneId).toBe(rows.find((r) => r.role === "assistant")?.id); // done carries the saved row's id
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.processingStartedAt).toBeNull();
  });

  it("reports the saved assistant message id on the trivial path too", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    touched.add(session.id);
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      if (opts?.priority === "streaming") { await onChunk("You nod."); return "You nod."; }
      return "{}";
    });
    let doneId: string | null = null;
    await runPipeline({
      sessionId: session.id, message: "ok", // a bare acknowledgment: trivial
      onToken: () => {}, onComplete: (_t, id) => { doneId = id; }, onError: (e) => { throw new Error(e); },
    });
    const assistant = db.select().from(messages).where(eq(messages.sessionId, session.id)).all().find((r) => r.role === "assistant");
    expect(assistant).toBeDefined();
    expect(doneId).toBe(assistant?.id);
  });

  it("removes the user message and asks the client to restore it when the turn fails", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    mockLLM.mockRejectedValue(new Error("ECONNREFUSED"));
    const { p, out } = run(session.id);
    await p;
    expect(out.error).toBeTruthy();
    expect(out.restore).toBe(ACTION);
    expect(db.select().from(messages).where(eq(messages.sessionId, session.id)).all()).toHaveLength(0);
  });

  it("asks the client to restore the draft when the turn lock is taken", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    expect(tryAcquireSessionLock(db, session.id)).toBe(true);
    try {
      const { p, out } = run(session.id);
      await p;
      expect(out.error).toMatch(/already processing/);
      expect(out.restore).toBe(ACTION);
      expect(mockLLM).not.toHaveBeenCalled();
    } finally {
      releaseSessionLock(db, session.id);
    }
  });

  it("stops quietly and leaves nothing behind when the client aborts mid-stream", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    const ac = new AbortController();
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      await onChunk("The ware");
      ac.abort();
      if (opts?.signal?.aborted) throw new LLMAbortedError();
      return "unreachable";
    });
    const { p, out } = run(session.id, ac.signal);
    await p;
    expect(out.done).toBeNull();
    expect(out.error).toBeNull();
    // Aborted turns never start a retry or a fallback call.
    expect(mockLLM).toHaveBeenCalledTimes(1);
    expect(db.select().from(messages).where(eq(messages.sessionId, session.id)).all()).toHaveLength(0);
    expect(db.select().from(sessions).where(eq(sessions.id, session.id)).get()?.processingStartedAt).toBeNull();
  });

  it("persists nothing when the abort lands after the last token", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    const ac = new AbortController();
    mockLLM.mockImplementation(async (_c, _m, onChunk) => {
      const text = "The warehouse is dark and cold. Crates loom in rows.";
      await onChunk(text);
      ac.abort(); // the model finished, but the client is already gone
      return text;
    });
    const { p, out } = run(session.id, ac.signal);
    await p;
    expect(out.done).toBeNull();
    expect(out.error).toBeNull();
    expect(db.select().from(messages).where(eq(messages.sessionId, session.id)).all()).toHaveLength(0);
  });

  it("tells the client to reset when a retry follows a partial stream", async () => {
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    let streamingCalls = 0;
    mockLLM.mockImplementation(async (_c, _m, onChunk, _o, opts) => {
      if (opts?.priority !== "streaming") return "{}";
      streamingCalls++;
      if (streamingCalls === 1) { await onChunk("Half a sent"); throw new Error("socket hang up"); }
      await onChunk("A full, fresh narration of the warehouse search.");
      return "A full, fresh narration of the warehouse search.";
    });
    const { p, out } = run(session.id);
    await p;
    await settle(session.id);
    expect(out.resets).toBe(1);
    expect(out.done).toContain("fresh narration");
  });
});
