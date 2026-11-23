import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@/server/db/schema";
import type * as Providers from "@/server/llm/providers";
import { createTestDb, seedSession } from "../helpers/testDb";

const callLLM = vi.fn();
vi.mock("@/server/llm/providers", async (orig) => ({ ...(await orig<typeof Providers>()), callLLM: (...a: unknown[]) => callLLM(...a) }));
const updateCampaignJournal = vi.fn(async () => {});
vi.mock("@/server/pipeline/turn/auxTasks", () => ({ updateCampaignJournal: (...a: unknown[]) => updateCampaignJournal(...(a as [])) }));
import { waitForBackground, sessionAuxKey } from "@/server/pipeline/backgroundQueue";
import { endSession, SessionNotFoundError } from "@/server/pipeline/sessionEnd";

beforeEach(() => {
  callLLM.mockReset();
  updateCampaignJournal.mockClear();
});

describe("endSession service", () => {
  it("writes the recap, completes the session and queues the journal update", async () => {
    callLLM.mockResolvedValue("  The party fought on.  ");
    const db = createTestDb();
    const { session } = seedSession(db);

    const out = await endSession(db, session.id);
    await waitForBackground(sessionAuxKey(session.id));

    expect(out.summary).toBe("The party fought on.");
    const row = db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(row).toMatchObject({ status: "completed", summary: "The party fought on." });
    expect(row?.endedAt).not.toBeNull();
    expect(updateCampaignJournal).toHaveBeenCalledTimes(1);
    db.$client.close();
  });

  it("falls back to a stock summary when the LLM fails", async () => {
    callLLM.mockRejectedValue(new Error("down"));
    const db = createTestDb();
    const { session } = seedSession(db);
    expect((await endSession(db, session.id)).summary).toBe("Session ended.");
    await waitForBackground(sessionAuxKey(session.id));
    db.$client.close();
  });

  it("throws SessionNotFoundError for a missing session", async () => {
    const db = createTestDb();
    await expect(endSession(db, "nope")).rejects.toBeInstanceOf(SessionNotFoundError);
    db.$client.close();
  });
});
