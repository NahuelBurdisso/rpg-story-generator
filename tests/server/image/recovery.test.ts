import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedSession } from "../../helpers/testDb";
import { messages, sceneImages } from "@/server/db/schema";
import { failStaleImageJobs, IMAGE_JOB_STALE_MS, PROCESS_STARTED_AT } from "@/server/image/recovery";

function seedImage(db: ReturnType<typeof createTestDb>, createdAt: number, status: "generating" | "completed" = "generating") {
  const { campaign, session } = seedSession(db);
  const msg = db.insert(messages).values({ sessionId: session.id, role: "assistant", content: "x" }).returning().get();
  return db.insert(sceneImages).values({
    messageId: msg.id, campaignId: campaign.id, sessionId: session.id, triggerType: "player_request",
    sdPrompt: "", sdNegativePrompt: "", width: 1, height: 1, status, createdAt,
  }).returning().get();
}

describe("PROCESS_STARTED_AT", () => {
  it("is derived from process uptime, not module evaluation time", () => {
    // Allow a little slack for the clock reads happening at different instants.
    expect(PROCESS_STARTED_AT).toBeLessThanOrEqual(Date.now() - process.uptime() * 1000 + 50);
  });
});

describe("failStaleImageJobs", () => {
  it("fails jobs started before this process (their worker died with the old one)", () => {
    const db = createTestDb();
    const old = seedImage(db, 1_000);
    const n = failStaleImageJobs(db, { now: 10_000, processStartedAt: 5_000 });
    expect(n).toBe(1);
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, old.id)).get()?.status).toBe("failed");
  });

  it("fails jobs running longer than the stale window", () => {
    const db = createTestDb();
    const hung = seedImage(db, 6_000);
    failStaleImageJobs(db, { now: 6_000 + IMAGE_JOB_STALE_MS + 1, processStartedAt: 5_000 });
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, hung.id)).get()?.status).toBe("failed");
  });

  it("leaves live and finished jobs alone", () => {
    const db = createTestDb();
    const live = seedImage(db, 9_000);
    const done = seedImage(db, 1_000, "completed");
    expect(failStaleImageJobs(db, { now: 10_000, processStartedAt: 5_000 })).toBe(0);
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, live.id)).get()?.status).toBe("generating");
    expect(db.select().from(sceneImages).where(eq(sceneImages.id, done.id)).get()?.status).toBe("completed");
  });
});
