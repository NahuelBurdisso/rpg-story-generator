import type { CampaignRow, CharacterRow } from "../../db/schema";

/** The campaign block of the narrator prompt (shared by the trivial and standard paths). */
export function promptCampaign(campaign: CampaignRow) {
  return {
    genre: campaign.genre,
    customGenre: campaign.customGenre,
    tone: campaign.tone,
    difficulty: campaign.difficulty,
    worldDescription: campaign.worldDescription,
    plotHooks: campaign.plotHooks ?? [],
  };
}

/** The characters block of the narrator prompt (shared by the trivial and standard paths). */
export function promptCharacters(chars: CharacterRow[]) {
  return chars.map((c) => ({
    name: c.name,
    role: c.role,
    backstory: c.backstory,
    gender: c.appearance?.gender,
    stats: c.stats,
    inventory: c.inventory,
    statusNotes: c.statusNotes ?? undefined,
  }));
}

/**
 * Recent history for the prompt. Trivial: the last 6 messages, each cut to 200
 * chars. Standard: every message, the last 4 in full and older ones cut to 200 chars.
 */
export function buildSceneSummary(
  recentMessages: { role: string; content: string }[],
  mode: "trivial" | "standard"
): string {
  if (mode === "trivial") {
    return recentMessages
      .slice(-6)
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 200)}`)
      .join("\n\n");
  }
  return recentMessages
    .map((m, i) => {
      const distFromEnd = recentMessages.length - 1 - i;
      const content = distFromEnd < 4 ? m.content : m.content.slice(0, 200) + (m.content.length > 200 ? "..." : "");
      return `[${m.role.toUpperCase()}]: ${content}`;
    })
    .join("\n\n");
}
