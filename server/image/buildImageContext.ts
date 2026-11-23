import { db } from "../db";
import { sessions, campaigns, characters, npcMemory, messages, userSettings } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { selectRelevantNPCs } from "../pipeline/npcSelection";
import { buildProviderConfig, buildLocalConfig } from "../llm/config";
import { SETTINGS_ID } from "../config";

export async function buildImageContext(sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, session.campaignId));
  if (!campaign) return null;
  const chars = await db.select().from(characters).where(eq(characters.campaignId, session.campaignId));
  const allNPCs = await db.select().from(npcMemory).where(eq(npcMemory.campaignId, session.campaignId));

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.id, SETTINGS_ID));
  const llmConfig = buildProviderConfig(settings);
  const local = buildLocalConfig(settings);

  const recentAssistant = await db.select().from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "assistant")))
    .orderBy(desc(messages.createdAt)).limit(4);
  const lastMsg = recentAssistant[0];
  if (!lastMsg) return null;

  const lastAssistantMessages = recentAssistant.map(m => m.content);
  const relevantNPCs = selectRelevantNPCs(lastMsg.content, lastAssistantMessages, allNPCs, 3);

  return { session, campaign, chars, relevantNPCs, finalText: lastMsg.content, messageId: lastMsg.id, llmConfig, baseUrl: local.ollamaBaseUrl! };
}
