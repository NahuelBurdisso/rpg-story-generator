import type { ContextSnapshot } from "@/server/db/jsonTypes";
import type { TriggerType } from "@/lib/enums";

export type { ContextSnapshot };

export interface GalleryImage {
  id: string;
  messageId: string;
  sessionId: string;
  campaignId: string;
  triggerType: TriggerType;
  sdPrompt: string;
  sdNegativePrompt: string;
  filePath: string | null;
  width: number;
  height: number;
  contextSnapshot: ContextSnapshot | null;
  characterId: string | null;
  generationTimeMs: number | null;
  seed?: number | null;
  createdAt: number;
  narrativeText: string;
  messageCreatedAt: number;
}

export interface CampaignGalleryImage extends GalleryImage {
  sessionTitle: string;
}
