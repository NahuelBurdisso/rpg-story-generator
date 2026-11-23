import { db } from "../../db";
import { campaigns, sessions, messages } from "../../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { callLLM, type ProviderConfig } from "../../llm/providers";
import { nextSummaryWindow } from "../utils";

/**
 * Rewrite the campaign journal from the rolling context summary (the caller
 * decides the cadence); pass `latestEvents` (session end) to use those instead.
 */
export async function updateCampaignJournal(
  campaignId: string,
  sessionId: string,
  llmConfig: ProviderConfig,
  latestEvents?: string
): Promise<void> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return;

  let events = latestEvents;
  if (!events) {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session?.contextSummary) return;

    events = session.contextSummary;
  }

  const existingJournal = campaign.campaignJournal ?? "";

  const prompt = `You are the chronicler of an RPG campaign. Write a vivid "The Story So Far" journal entry (100 words max).

${existingJournal ? `Existing chronicle:\n${existingJournal}\n\nLatest events:\n` : "First entry:\n"}${events}

Weave the new events into one cohesive narrative. Prioritize: turning points, betrayals, victories and defeats, unresolved threats, shifting relationships. Write like a skilled novelist's recap — evocative, not dry. Past tense, third person. Name names. End on what is most unresolved or dangerous. Return ONLY the chronicle text.`;

  try {
    const journal = await callLLM(
      llmConfig,
      [{ role: "user", content: prompt }],
      async () => {},
      { temperature: 0.3, maxTokens: 256 },
      { priority: "background", retries: 1 }
    );
    await db.update(campaigns).set({ campaignJournal: journal.trim() }).where(eq(campaigns.id, campaignId));
  } catch (err) {
    console.error("[journal]", err);
  }
}

export async function updateContextSummary(
  sessionId: string,
  llmConfig: ProviderConfig
): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return;

  const [{ count: totalCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));

  const summaryWindow = nextSummaryWindow(totalCount, session.lastSummaryAt ?? 0);
  if (!summaryWindow) return;

  const allMsgs = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);

  const msgsToSummarize = allMsgs.slice(summaryWindow.start, summaryWindow.end);
  const existingSummary = session.contextSummary ?? "";

  const prompt = `Condense this RPG session into a running summary (150 words max). The narrator reads it to keep continuity, so focus on what a narrator needs to remember:
- What the player DID and WHY (their goals, not just actions)
- NPC attitudes and what they revealed or hid
- Promises made, threats issued, deals struck
- Items and resources that changed hands
- Where the player is now and what is pending
- The emotional state of relationships and unresolved tension

Write in present tense ("the player is in the tavern, having just..."). Be specific with names, places and consequences.

${existingSummary ? `Previous summary:\n${existingSummary}\n\nNew messages since then:\n` : "Full session:\n"}${msgsToSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 300)}`).join("\n")}

Return ONLY the summary paragraph, nothing else.`;

  try {
    const summary = await callLLM(
      llmConfig,
      [{ role: "user", content: prompt }],
      async () => {},
      { temperature: 0.2, maxTokens: 256 },
      { priority: "background", retries: 1 }
    );
    await db
      .update(sessions)
      .set({ contextSummary: summary.trim(), lastSummaryAt: summaryWindow.end })
      .where(eq(sessions.id, sessionId));
  } catch (err) {
    console.error("[summary]", err);
  }
}

export async function maybeGenerateTitle(sessionId: string, narrative: string, llmConfig: ProviderConfig): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || !session.title.startsWith("Session ")) return;

  const [{ count: msgCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));
  if (msgCount < 3) return;

  const recentMsgs = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(4);
  const context = recentMsgs.reverse().map((m) => m.content).join("\n\n");

  try {
    const title = await callLLM(
      llmConfig,
      [{ role: "user", content: `Generate a short, dramatic title (3-6 words) for this RPG session. Think TV episode titles — evocative, hinting at the central conflict or turning point. Nothing generic. Return ONLY the title, nothing else.\n\n${context}` }],
      async () => {},
      { temperature: 0.7, maxTokens: 20 },
      { priority: "background", retries: 0 }
    );
    const cleaned = title.trim().replace(/^["']|["']$/g, "");
    if (cleaned.length > 0 && cleaned.length < 60) {
      await db.update(sessions).set({ title: cleaned }).where(eq(sessions.id, sessionId));
    }
  } catch (err) {
    console.error("[title]", err);
  }
}
