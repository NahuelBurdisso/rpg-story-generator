import type { Difficulty, Genre, ImageStyle, QuickAction, Tone } from "@/types";

export interface CampaignFormData {
  name: string;
  genre: Genre;
  customGenre?: string;
  tone: Tone;
  difficulty: Difficulty;
  worldDescription: string;
  customRules?: string;
  statDefinitions: string[];
  quickActions: QuickAction[];
  plotHooks?: string[];
  imageEnabled?: boolean;
  imageStyle?: ImageStyle;
}

/** The fields campaigns.create and campaigns.update share, built from the form. */
export function toCampaignInput(data: CampaignFormData) {
  return {
    name: data.name,
    genre: data.genre,
    customGenre: data.customGenre,
    tone: data.tone,
    difficulty: data.difficulty,
    worldDescription: data.worldDescription,
    customRules: data.customRules,
    statDefinitions: data.statDefinitions,
    quickActions: data.quickActions,
    plotHooks: data.plotHooks,
    imageEnabled: data.imageEnabled,
    imageStyle: data.imageStyle,
  };
}
