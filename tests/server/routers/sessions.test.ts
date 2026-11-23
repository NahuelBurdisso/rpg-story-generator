import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@/server/db/schema";
import { sessionsRouter } from "@/server/routers/sessions";
import { tryAcquireSessionLock } from "@/server/pipeline/sessionLock";
import { createTestDb, seedSession } from "../../helpers/testDb";

describe("sessions.endSession", () => {
  it("refuses with CONFLICT while a turn holds the session lock, leaving the session active", async () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    expect(tryAcquireSessionLock(db, session.id)).toBe(true); // a turn is in flight

    const caller = sessionsRouter.createCaller({ db });
    await expect(caller.endSession({ sessionId: session.id })).rejects.toMatchObject({ code: "CONFLICT" });

    const row = db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(row?.status).toBe("active");
    expect(row?.endedAt).toBeNull();
    expect(row?.processingStartedAt).not.toBeNull(); // the turn's lock is untouched
    db.$client.close();
  });

  it("throws NOT_FOUND for a missing session", async () => {
    const db = createTestDb();
    const caller = sessionsRouter.createCaller({ db });
    await expect(caller.endSession({ sessionId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.$client.close();
  });
});

describe("sessions create / get / listByCampaign", () => {
  it("creates an active session and lists it", async () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    const caller = sessionsRouter.createCaller({ db });

    const created = await caller.create({ campaignId: campaign.id, title: "Second" });
    expect(created).toMatchObject({ title: "Second", status: "active", campaignId: campaign.id });
    expect(await caller.get({ id: created.id })).toMatchObject({ id: created.id });

    const listed = await caller.listByCampaign({ campaignId: campaign.id });
    expect(listed.map((s) => s.id).sort()).toEqual([created.id, session.id].sort());
    expect(await caller.listByCampaign({ campaignId: "other" })).toEqual([]);
    db.$client.close();
  });

  it("rejects an empty title or unknown status, and get throws NOT_FOUND", async () => {
    const db = createTestDb();
    const { campaign } = seedSession(db);
    const caller = sessionsRouter.createCaller({ db });

    await expect(caller.create({ campaignId: campaign.id, title: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error not a session status
    await expect(caller.create({ campaignId: campaign.id, title: "x", status: "paused" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.get({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.$client.close();
  });
});
