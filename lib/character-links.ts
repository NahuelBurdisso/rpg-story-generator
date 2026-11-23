export interface CharacterLink {
  name: string;
  id: string;
  campaignId: string;
}

/** Replace character names with markdown links to their sheet */
export function injectCharacterLinks(text: string, links: CharacterLink[]): string {
  if (links.length === 0) return text;
  // Sort by name length descending to match longer names first (e.g. "Sera Vane" before "Sera")
  const sorted = [...links].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const { name, id, campaignId } of sorted) {
    // Match whole-word occurrences not already inside markdown link syntax
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!\\[)\\b(${escaped})\\b(?![\\]\\(])`, "g");
    result = result.replace(regex, `[$1](/campaigns/${campaignId}/characters/${id})`);
  }
  return result;
}
