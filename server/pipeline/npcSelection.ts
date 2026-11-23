import type { NpcMemoryRow } from "../db/schema";
import { sameName } from "./text";

function nameMatchesText(npcName: string, text: string): boolean {
  const textLower = text.toLowerCase();
  const nameLower = npcName.toLowerCase();

  // Full name match
  if (textLower.includes(nameLower)) return true;

  // Any word of the NPC's name (min 3 chars to avoid false positives like "El")
  const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 3);
  return nameWords.some(word => {
    // Word boundary check: the word should appear as a standalone word
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return regex.test(textLower);
  });
}

export function selectRelevantNPCs(
  message: string,
  lastAssistantMessages: string[],
  allNPCs: NpcMemoryRow[],
  maxCount: number = 3,
  sceneState?: { activeNPCs?: { name: string }[] } | null
): NpcMemoryRow[] {
  const selected: NpcMemoryRow[] = [];
  const messageLower = message.toLowerCase();

  // Priority 1: NPCs named by the player
  for (const npc of allNPCs) {
    if (nameMatchesText(npc.name, messageLower)) {
      selected.push(npc);
    }
  }

  // Priority 2: NPCs in the active scene state (they're HERE, so they're relevant)
  if (sceneState?.activeNPCs) {
    for (const sceneNpc of sceneState.activeNPCs) {
      const match = allNPCs.find(
        (n) => !selected.includes(n) && sameName(n.name, sceneNpc.name)
      );
      if (match) selected.push(match);
    }
  }

  // Priority 3: NPCs mentioned in recent assistant messages
  for (const npc of allNPCs) {
    if (selected.includes(npc)) continue;
    if (lastAssistantMessages.some((m) => nameMatchesText(npc.name, m))) {
      selected.push(npc);
    }
  }

  // Priority 4: Most recently interacted NPCs
  const remaining = allNPCs
    .filter((n) => !selected.includes(n))
    .sort((a, b) => (b.lastInteractedAt ?? 0) - (a.lastInteractedAt ?? 0));

  while (selected.length < maxCount && remaining.length > 0) {
    selected.push(remaining.shift()!);
  }

  return selected.slice(0, maxCount);
}
