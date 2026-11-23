import { eq, desc } from "drizzle-orm";
import type { DB } from "../db";
import { sessions, messages, userSettings } from "../db/schema";
import { SETTINGS_ID } from "../config";
import { buildProviderConfig } from "../llm/config";
import { callLLM } from "../llm/providers";
import { cleanRecap } from "./utils";
import { enqueueBackground, waitForBackground, turnStateKey, sessionAuxKey } from "./backgroundQueue";
import { updateCampaignJournal } from "./turn/auxTasks";

/** The session to end does not exist. */
export class SessionNotFoundError extends Error {
  constructor() {
    super("Session not found");
    this.name = "SessionNotFoundError";
  }
}

/**
 * Close a session: wait for the last turn's background work, write a "Previously
 * on..." recap, mark the session completed and queue the campaign-journal update.
 * The caller must already hold the session lock (and keep it alive).
 */
export async function endSession(db: DB, sessionId: string): Promise<{ summary: string }> {
  // Let the last turn's extraction and summary land before closing the session.
  await waitForBackground(turnStateKey(sessionId));
  await waitForBackground(sessionAuxKey(sessionId));

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new SessionNotFoundError();

  const recentMsgs = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(10);

  const recentContext = recentMsgs
    .reverse()
    .map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
    .join("\n");

  // Include the rolling context summary so long sessions get coherent summaries
  const fullContext = session.contextSummary
    ? `Session summary so far:\n${session.contextSummary}\n\nMost recent messages:\n${recentContext}`
    : recentContext;

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.id, SETTINGS_ID));
  const llmConfig = buildProviderConfig(settings);

  let summary: string;
  try {
    summary = await callLLM(
      llmConfig,
      [
        {
          role: "user",
          content: `Write a dramatic 2-3 sentence "Previously on..." recap of this RPG session. Past tense, third person. Name the characters. Tell only what happened in the messages — don't invent. Focus on: the biggest decision, the most dramatic moment, and what was left unresolved. Make it sound like a TV episode recap — direct, vivid, ending on a hook. Return ONE recap, with no options, titles or preamble.\n\n${fullContext}`,
        },
      ],
      async () => {},
      { temperature: 0.5, maxTokens: 250 },
      { priority: "background", retries: 1 }
    );
    summary = cleanRecap(summary);
  } catch {
    summary = "Session ended.";
  }

  await db
    .update(sessions)
    .set({
      status: "completed",
      endedAt: Date.now(),
      summary: summary.trim(),
    })
    .where(eq(sessions.id, sessionId));

  // The mid-session journal cadence may never have fired — close the
  // session's chapter in the campaign journal now (queued, not awaited).
  const events = [session.contextSummary, summary].filter(Boolean).join("\n");
  // enqueueBackground never rejects (failures are logged as [background:<key>]).
  void enqueueBackground(sessionAuxKey(session.id), () =>
    updateCampaignJournal(session.campaignId, session.id, llmConfig, events));

  return { summary: summary.trim() };
}
