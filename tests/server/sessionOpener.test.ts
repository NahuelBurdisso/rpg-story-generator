import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { openerPrompt, prepareOpener } from "@/server/pipeline/sessionOpener";
import { createTestDb, seedSession, seedCharacter } from "../helpers/testDb";
import { campaigns, messages, sessions } from "@/server/db/schema";

describe("openerPrompt", () => {
  it("matches the text the client used to build (no journal)", () => {
    expect(openerPrompt("Aria", null)).toBe(
      `[SESSION START — set the opening scene. Describe where Aria is and what is happening around them. Establish atmosphere, location, and an immediate hook. Write in English.]`
    );
  });

  it("matches the text the client used to build (with journal)", () => {
    expect(openerPrompt("Aria", "…journal…")).toBe(
      `[SESSION START — continue the story. The last thing that happened: "…journal…". Set the scene for a new chapter that picks up the open threads. Describe where Aria is and what is happening. Write in English.]`
    );
  });

  it("keeps only the last 300 characters of a long journal", () => {
    const journal = "Q".repeat(100) + "b".repeat(300);
    const out = openerPrompt("Aria", journal);
    expect(out).toContain(`"${"b".repeat(300)}"`);
    expect(out).not.toContain("Q");
  });

  it("starts with the prefix the classifier keys on", () => {
    expect(openerPrompt("X", null).startsWith("[SESSION START")).toBe(true);
    expect(openerPrompt("X", "j").startsWith("[SESSION START")).toBe(true);
  });
});

describe("prepareOpener", () => {
  it("404s on an unknown session", () => {
    const db = createTestDb();
    expect(prepareOpener(db, "nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("409s on a completed session", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    db.update(sessions).set({ status: "completed" }).where(eq(sessions.id, session.id)).run();
    expect(prepareOpener(db, session.id)).toMatchObject({ ok: false, status: 409 });
  });

  it("409s when the session already has messages", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id);
    db.insert(messages).values({ sessionId: session.id, role: "user", content: "hi" }).run();
    expect(prepareOpener(db, session.id)).toMatchObject({ ok: false, status: 409 });
  });

  it("409s when the campaign has no characters", () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    expect(prepareOpener(db, session.id)).toMatchObject({ ok: false, status: 409 });
  });

  it("builds the opener for the first character, with the campaign journal", () => {
    const db = createTestDb();
    const { campaign, session } = seedSession(db);
    seedCharacter(db, campaign.id, { name: "Aria" });
    seedCharacter(db, campaign.id, { name: "Borin" });
    expect(prepareOpener(db, session.id)).toEqual({ ok: true, message: openerPrompt("Aria", null) });

    db.update(campaigns).set({ campaignJournal: "The bridge fell." }).where(eq(campaigns.id, campaign.id)).run();
    expect(prepareOpener(db, session.id)).toEqual({ ok: true, message: openerPrompt("Aria", "The bridge fell.") });
  });
});
