import { count, eq } from "drizzle-orm";
import type { DB } from "../db";
import { campaigns, characters, messages, sessions } from "../db/schema";

/** The hidden first player turn of a session. Text kept verbatim from the old client opener: the classifier keys on its prefix. */
export function openerPrompt(charName: string, campaignJournal: string | null): string {
  if (campaignJournal) {
    return `[SESSION START — continue the story. The last thing that happened: "${campaignJournal.slice(-300)}". Set the scene for a new chapter that picks up the open threads. Describe where ${charName} is and what is happening. Write in English.]`;
  }
  return `[SESSION START — set the opening scene. Describe where ${charName} is and what is happening around them. Establish atmosphere, location, and an immediate hook. Write in English.]`;
}

export type OpenerResult = { ok: true; message: string } | { ok: false; status: 404 | 409; error: string };

/** Checks that `sessionId` can be opened (active, empty, with a character) and builds the opener text. */
export function prepareOpener(db: DB, sessionId: string): OpenerResult {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return { ok: false, status: 404, error: "Session not found" };
  if (session.status === "completed") return { ok: false, status: 409, error: "This session has ended." };
  const [{ n }] = db.select({ n: count() }).from(messages).where(eq(messages.sessionId, sessionId)).all();
  if (n > 0) return { ok: false, status: 409, error: "This session has already started." };
  const campaign = db.select().from(campaigns).where(eq(campaigns.id, session.campaignId)).get();
  // Same query and row order as characters.listByCampaign, whose first row the client used to name.
  const first = db.select().from(characters).where(eq(characters.campaignId, session.campaignId)).all()[0];
  if (!campaign || !first) return { ok: false, status: 409, error: "Create a character before starting the session." };
  return { ok: true, message: openerPrompt(first.name, campaign.campaignJournal) };
}
