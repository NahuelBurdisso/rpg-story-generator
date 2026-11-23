import type { DB } from "../../db";
import { campaigns, characters, sessions, messages, npcMemory, userSettings } from "../../db/schema";
import type {
  CampaignRow, CharacterRow, MessageRow, NpcMemoryRow, SessionRow,
} from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import type { CampaignStoryState, ConsequenceSeed, SceneState, SessionStoryState } from "@/types";
import type { ProviderConfig } from "../../llm/providers";
import { buildProviderConfig, buildFallbackConfig } from "../../llm/config";
import { readSessionStoryState, readSceneState, readConsequenceSeeds, readCampaignStoryState } from "../../db/jsonSchemas";
import { stripMechanicMarkersLoose } from "../text";
import { deduplicateContent, lastAssistantContents, historyLimit } from "../utils";
import { SETTINGS_ID } from "../../config";

/** Everything a turn reads before narrating, loaded in one place. */
export interface TurnContext {
  session: SessionRow;
  campaign: CampaignRow;
  chars: CharacterRow[];
  allNPCs: NpcMemoryRow[];
  llmConfig: ProviderConfig;
  fallbackConfig: ProviderConfig | null;
  storyState0: SessionStoryState;
  sceneState0: SceneState | null;
  consequenceSeeds0: ConsequenceSeed[];
  campaignStory0: CampaignStoryState | null;
  recentMessages: MessageRow[];
  lastAssistantMessages: string[];
}

/**
 * Load the turn's context. `onProvider` receives the provider name as soon as
 * the config is built, so a later failure is still classified against it.
 */
export async function loadTurnContext(
  db: DB,
  sessionId: string,
  onProvider?: (providerName: string) => void
): Promise<TurnContext> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new Error("Session not found");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, session.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  const chars = await db.select().from(characters).where(eq(characters.campaignId, session.campaignId));
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.id, SETTINGS_ID));
  const allNPCs = await db.select().from(npcMemory).where(eq(npcMemory.campaignId, session.campaignId));

  const llmConfig = buildProviderConfig(settings);
  onProvider?.(llmConfig.provider);
  const fallbackConfig = buildFallbackConfig(settings);

  // JSON columns are validated on read: a corrupt or old blob degrades to a safe default instead of throwing.
  const storyState0 = readSessionStoryState(session.storyState);
  const sceneState0 = readSceneState(session.sceneState);
  const consequenceSeeds0 = readConsequenceSeeds(session.consequenceSeeds);
  const campaignStory0 = readCampaignStoryState(campaign.storyState);

  // Recent messages for context
  const recentMsgs = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(historyLimit(settings?.maxContextMessages));
  const recentMessages = recentMsgs.reverse().map((m) => ({
    ...m,
    content: deduplicateContent(stripMechanicMarkersLoose(m.content)),
  }));
  const lastAssistantMessages = lastAssistantContents(recentMessages, 3);

  return {
    session, campaign, chars, allNPCs, llmConfig, fallbackConfig,
    storyState0, sceneState0, consequenceSeeds0, campaignStory0,
    recentMessages, lastAssistantMessages,
  };
}
