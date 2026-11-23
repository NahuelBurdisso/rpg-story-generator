import { type NPCMemoryDoc, type DirectorDecision, type RetrievedMemory } from "@/types";
import type { SceneState } from "../db/jsonTypes";
import { buildDirectorBlock } from "./director";
import { estimateTokens } from "@/server/llm/providers";
import { config } from "../config";
import { hpValue, maxHpValue } from "@/lib/stats";

interface Campaign {
  genre: string;
  customGenre?: string | null;
  tone: string;
  difficulty: string;
  worldDescription: string;
  plotHooks?: string[];
}

interface Character {
  name: string;
  role: string;
  backstory?: string;
  gender?: string;
  stats: Record<string, number>;
  inventory: string[];
  statusNotes?: string;
}

interface PromptContext {
  campaign: Campaign;
  characters: Character[];
  npcs: (NPCMemoryDoc & { memories?: RetrievedMemory[] })[];
  director: DirectorDecision;
  sceneSummary: string;
  contextSummary?: string;
  sceneType?: string;
  sceneState?: SceneState | null;
}

export function buildNarratorPrompt(ctx: PromptContext, userMessage: string, maxCtx: number = config.ollamaNumCtx): string {
  const { campaign, characters, npcs, director, sceneSummary, contextSummary, sceneState } = ctx;

  const genreStyles: Record<string, string> = {
    fantasy: "Use rich sensory language. Describe the weight of armor, the smell of old stone, the crackle of arcane energy. Blend wonder with grit.",
    "sci-fi": "Use precise, technical language mixed with noir atmosphere. Describe the hum of machinery, the cold of space, the static of comms. Technology should feel tactile.",
    horror: "Use restraint — what's unseen is scarier than what's shown. Build dread through small wrong details. Sound, shadow, and silence are your tools.",
    "post-apocalyptic": "Use sparse, blunt prose. The world is broken — show it through rusted details, scarcity, and the weight of survival. Beauty exists only in contrast.",
    cyberpunk: "Neon and shadow. Blend corporate dystopia with street-level survival. Tech should feel oppressive but alluring. Rain, chrome, desperation.",
    western: "Sparse and sun-bleached. Short sentences. Moral ambiguity in every interaction. Silence says more than words. Dust, leather, gunmetal.",
    "space-opera": "Epic scale, personal stakes. The galaxy is vast but the crew is family. Use contrast: infinite void vs small human moments.",
    noir: "Shadows and moral gray. Short declarative sentences. Everyone has an angle. Describe light sources — what they reveal and what they hide.",
    steampunk: "Brass and steam. Victorian formality masking industrial brutality. Gears grind, pistons hiss, clockwork ticks. Invention and exploitation.",
    mythological: "Speak with weight and grandeur. Invoke the elements. Actions ripple through fate. Heroes are flawed, gods are petty, destiny is inescapable.",
    custom: "Adapt your prose style to match the world described above. Be vivid and specific.",
  };

  // For custom genres, look up style by customGenre name (e.g. "cyberpunk" → cyberpunk style)
  const effectiveGenre = campaign.genre === "custom" && campaign.customGenre
    ? campaign.customGenre.toLowerCase()
    : campaign.genre;
  const genreLabel = campaign.genre === "custom" && campaign.customGenre
    ? campaign.customGenre
    : campaign.genre;

  // Build the prompt skeleton WITHOUT the scene summary to measure fixed cost
  let prompt = `[ROLE] You are an immersive, vivid narrative game master for a ${genreLabel} RPG. You follow the player's lead, keep the world consistent, and write what happens next with dramatic, concrete detail. Violence, danger, loss and horror are fair game when the story calls for them; keep the tone fitting the genre.\n[LANGUAGE] Always write in English, even if the world description or the player's message uses another language. Address the player character in the second person ("you").\n\n`;

  const difficultyGuidance: Record<string, string> = {
    easy: "Be forgiving. Lucky breaks happen. NPCs offer help. The world is dangerous but fair. Injuries heal, supplies appear.",
    normal: "Balance challenge and reward. Consequences exist but aren't overwhelming. Fair outcomes for smart play.",
    hard: "The world is harsh. Resources are scarce. NPCs are self-interested. Mistakes cost dearly. Success requires clever planning.",
    nightmare: "Unforgiving. Every resource matters. NPCs are desperate and dangerous. Death is real. Trust is rare. Even victories come at a cost.",
  };

  prompt += `[WORLD] ${campaign.worldDescription}\n`;
  prompt += `[TONE] ${campaign.tone}\n`;
  prompt += `[DIFFICULTY] ${campaign.difficulty}: ${difficultyGuidance[campaign.difficulty] ?? difficultyGuidance.normal}\n`;
  prompt += `[STYLE] ${genreStyles[effectiveGenre] ?? genreStyles.custom}\n\n`;

  // Placeholder — will be replaced with truncated summary
  const summaryPlaceholder = "[CURRENT SCENE — continue from here, do NOT contradict or reset]\n";
  prompt += summaryPlaceholder;

  if (contextSummary) {
    prompt += `[PRIOR CONTEXT] ${contextSummary}\n\n`;
  }

  // Plot hooks — give the narrator active story goals to weave in
  if (campaign.plotHooks && campaign.plotHooks.length > 0) {
    prompt += `[ACTIVE PLOT HOOKS — reference these when natural, don't force them]\n`;
    for (const hook of campaign.plotHooks.slice(0, 4)) {
      prompt += `- ${hook}\n`;
    }
    prompt += "\n";
  }

  if (sceneState) {
    const timeAtmosphere: Record<string, string> = {
      morning: "early light, mist, birdsong, fresh starts",
      afternoon: "bright sun, heat, full activity, long shadows beginning",
      evening: "golden light fading, torches lit, people heading home, transition",
      night: "darkness, moonlight or torchlight only, quiet tension, the world asleep or hunting",
    };

    prompt += `[SCENE STATE — THIS IS GROUND TRUTH, DO NOT CONTRADICT]\n`;
    prompt += `Location: ${sceneState.location}\n`;
    prompt += `Time: ${sceneState.timeOfDay}${timeAtmosphere[sceneState.timeOfDay] ? ` (${timeAtmosphere[sceneState.timeOfDay]})` : ""}\n`;
    prompt += `Situation: ${sceneState.situation}\n`;
    if (sceneState.mood) {
      prompt += `Atmosphere: ${sceneState.mood}\n`;
    }
    if (sceneState.activeNPCs.length > 0) {
      prompt += `Active NPCs (KEEP THESE CONSISTENT — same name, appearance, personality):\n`;
      for (const npc of sceneState.activeNPCs) {
        prompt += `  - ${npc.name}: ${npc.desc} [${npc.disposition}]\n`;
      }
    }
    if (sceneState.pendingThreats.length > 0) {
      prompt += `Unresolved hooks: ${sceneState.pendingThreats.join(", ")}\n`;
    }
    prompt += "\n";
  }

  // Player character with full details
  prompt += `[PLAYER CHARACTER]\n`;
  for (const char of characters) {
    const hp = hpValue(char.stats) ?? "?";
    const maxHp = maxHpValue(char.stats) ?? "?";
    const genderHint = char.gender ? genderToPronouns(char.gender) : "";
    prompt += `Name: ${char.name}\nRole: ${char.role}${genderHint}\nHP: ${hp}/${maxHp}\nStatus: ${char.statusNotes || "healthy"}\n`;
    if (char.backstory) {
      prompt += `Backstory: ${char.backstory.slice(0, 300)}\n`;
    }
    prompt += `Stats: ${Object.entries(char.stats).map(([k,v]) => `${k}:${v}`).join(", ")}\n`;
    const invCounts = new Map<string, number>();
    for (const item of char.inventory) {
      invCounts.set(item, (invCounts.get(item) ?? 0) + 1);
    }
    const invStr = invCounts.size > 0
      ? Array.from(invCounts.entries())
          .map(([item, count]) => count > 1 ? `${item} (x${count})` : item)
          .join(", ")
      : "Nothing";
    prompt += `Inventory: ${invStr}\n`;
    // Highlight notable items the narrator should work into the story
    const notablePatterns = /sable|kyber|holocr[oó]n|lightsaber|blaster|datapad|comunicador|droi?de|cred|mapa|llave|amuleto|poción|espada|arco|escudo|grimorio|varita|anillo|sword|map|key|amulet|potion|shield|bow|grimoire|wand|ring/i;
    const notableItems = char.inventory.filter((item) => notablePatterns.test(item));
    if (notableItems.length > 0) {
      prompt += `Notable items to reference when relevant: ${notableItems.join(", ")}\n`;
    }
  }
  prompt += "\n";

  if (npcs.length > 0) {
    prompt += `[NPCS IN SCENE — maintain their identity across messages]\n`;
    for (const npc of npcs) {
      const relationships = npc.relationships ?? [];
      const secrets = npc.secrets ?? [];
      const playerRel = relationships.find((r) => r.target === "player");
      const disposition = playerRel ? dispositionWord(playerRel.disposition) : "neutral";
      const lastInteraction = playerRel?.lastInteraction ?? "none";
      let line = `- ${npc.name}: ${npc.personality.slice(0, 120)}, disposition: ${disposition}, last: "${lastInteraction}"`;
      if (secrets.length > 0) {
        line += `\n  HIDDEN MOTIVATION (weave subtly, DO NOT reveal directly): ${secrets[0].slice(0, 120)}`;
      }
      // Show NPC-to-NPC relationships for scene texture
      const otherRels = relationships.filter((r) => r.target !== "player");
      if (otherRels.length > 0) {
        const relSummary = otherRels.slice(0, 3).map((r) =>
          `${r.target}: ${dispositionWord(r.disposition)}`
        ).join(", ");
        line += `\n  KNOWS: ${relSummary}`;
      }
      if (npc.goal) {
        line += `\n  WANTS: ${npc.goal}`;
      }
      if (npc.speechPattern) {
        line += `\n  VOICE: ${npc.speechPattern}`;
        if (npc.vocabulary) line += ` — vocabulary: ${npc.vocabulary}`;
      }
      if (npc.memories && npc.memories.length > 0) {
        line += `\n  REMEMBERS:`;
        for (const mm of npc.memories) {
          const hedge = mm.source === "witnessed" ? "" : mm.source === "heard" ? " (heard from others)" : " (rumor, unverified)";
          const verb = mm.source === "witnessed" ? "" : "believes: ";
          line += `\n    - ${verb}${mm.content.slice(0, 140)}${hedge}`;
        }
      }
      prompt += line + "\n";
    }
    prompt += "\n";
  }

  prompt += "[INTERNAL — DIRECTOR NOTES, DO NOT REPRODUCE]\nThe following block is private staging guidance for you. NEVER copy, quote, paraphrase, or echo it in your response. Use it to shape the scene, then write ONLY in-world narration.\n\n";
  prompt += buildDirectorBlock(director) + "\n\n";

  const genreRules: Record<string, string> = {
    fantasy: "Magic has costs and consequences. Reference the weight of weapons, the taste of potions, the smell of spell components. Wounds bleed; travel is hard.",
    "sci-fi": "Technology fails, glitches, overheats. Zero-G has consequences. Radiation matters. Corp politics and alien biology add texture.",
    horror: "Less is more. The monster in shadow beats the monster described. Let dread build through wrong details. Characters should feel genuinely afraid — racing pulse, cold sweat, paralysis.",
    "post-apocalyptic": "Resources are scarce. Every bullet counts. Trust is currency. Describe what things USED to be, contrasted with what they are now. Desperation and hope coexist.",
    cyberpunk: "The system is rigged. Chrome and meat. Data is power. Every NPC has an angle. Rain-slicked streets, holographic ads, the hum of implants.",
    western: "Dust and distance. Silence is a weapon. Morality is personal, not legal. The land is as much a character as anyone.",
    "space-opera": "Scale matters — show the vastness. But zoom into crew dynamics. Every species has culture. FTL has rules. Space is beautiful and lethal.",
    noir: "Everyone lies. Follow the money. Describe light and shadow. Internal monologue reveals character. Trust no one, especially the narrator.",
    steampunk: "Clockwork logic — if it can break, it will. Class divide is visible. Innovation comes with exploitation. Describe the noise, heat, and grease.",
    mythological: "Fate is real. Prophecy is inescapable but interpretable. Gods are present. Nature reflects emotion. Names have power.",
  };

  const sceneTypeGuidance: Record<string, string> = {
    combat: "[SCENE: COMBAT] Write visceral, kinetic action. Short sentences. Impact and consequence. Describe the chaos — sound of steel, smell of blood, the burn of exertion. Every blow matters. If there's personal history between combatants, let it fuel the violence. Revenge and desperation make fights real.",
    stealth: "[SCENE: STEALTH] Write with tension and restraint. Silence is loud. Every sound could be the end. Describe shadows, breathing, heartbeats. The threat of discovery.",
    emotional: "[SCENE: EMOTIONAL] Write with vulnerability. Interior thoughts, physical tells of emotion. Let the moment land. Silence between words. This is about connection or loss.",
    investigation: "[SCENE: INVESTIGATION] Write with detail and discovery. Clues should feel earned. Describe textures, smells, anomalies. The satisfaction or frustration of piecing things together.",
    dialogue: "[SCENE: DIALOGUE] Let characters talk. Subtext matters more than text. Body language, pauses, what's left unsaid. Each NPC has their own rhythm and agenda.",
    exploration: "[SCENE: EXPLORATION] Write with wonder or unease. The world is a character. Describe what the senses find. Foreshadow through environment.",
    social: "[SCENE: SOCIAL] Write with warmth, humor, or tension depending on the company. Taverns smell of ale and woodsmoke. Markets bustle. NPCs have lives beyond the player. Show the world as a place where people eat, drink, laugh, argue, and scheme.",
  };
  if (ctx.sceneType && sceneTypeGuidance[ctx.sceneType]) {
    prompt += sceneTypeGuidance[ctx.sceneType] + "\n\n";
  }

  prompt += `[RULES]
- Stay in character as the game master: never refuse, redirect, or lecture. Describe what happens.
- Scene continuity: never reset location, swap NPCs, or contradict established facts. NPCs stay consistent.
- No meta: no choice lists, no fourth-wall breaks, no reproducing [DIRECTOR] or control text.
- Fresh language: never repeat phrases/structures from earlier messages.
- Word budget: ${director.wordBudget}. Advance plot, don't pad.
- Structure: react → develop → land on a hook. Never trail off. End on something specific: a noise, a look, an arrival, a question from an NPC, a decision point. Never end with "What do you do?" or any variant — let the hook speak for itself.
- Commit: no hedging ("maybe", "perhaps"). State what IS.
- No self-contradiction: one outcome per action.
- Never narrate the player's emotions, thoughts, or decisions for them. You describe what they SEE, HEAR, and FEEL physically. Their internal response is theirs to write.
- The player controls the PC. Narrate the action they wrote and its consequences — never add actions they didn't take, and never reverse what they did (if they keep an item, it stays with them).
- Show consequences: actions have real, lasting effects. NPCs remember. The world reacts. Nothing is forgotten.
- Sensory detail: ground every scene in at least two senses beyond sight. Sound, smell, texture, taste, temperature.
- ${genreRules[effectiveGenre] ?? "Adapt to the genre — be vivid, specific, and consistent with the world's internal logic."}
- STATE_UPDATE: append the block (format below) ONLY when inventory/stats/status actually changed. Omit if nothing changed. When the PC rests/heals/eats/uses a healing item, use statChanges to restore HP. When the player's action says they take something, use addInventory (physical objects only — never places, access or knowledge; never items they only saw or chose to leave). Items already in the inventory are never re-added. When they use/drop something, use removeInventory. Track the world state.
- Mechanics: when the PC attempts something risky or opposed — fighting, forcing, shoving past someone, climbing, sneaking past a watcher, intimidating or lying to someone wary — place ONE [MECHANIC:...] marker (format below) instead of deciding the outcome yourself. AT MOST ONE per response. If the player's action ends with [ROLL: dX = N], they already rolled: honor it (high = it goes well, low = it goes badly) and place no marker.
- The PC is ${characters[0]?.name ?? "the player"}: address them as "you" (second person); their name appears only in NPC dialogue. Reference backstory/inventory when relevant.
- Distinct NPC voices. Use VOICE descriptions if provided. Each NPC sounds DIFFERENT — vocabulary, cadence, attitude. A grizzled soldier uses clipped sentences; a nervous scholar rambles. Some NPCs talk a lot, others barely speak. Dialogue reveals what words say AND what they hide.
- NPCs have their own agendas. They don't exist to serve the player. They lie, withhold, manipulate, desire, fear. They act in character even when it's inconvenient.
- Commit to the scene. If it calls for blood, write blood. If it calls for fear, write fear. If it calls for cruelty, write cruelty. The story is real; don't water it down.
- Format: prose as text, NPC dialogue in > blockquotes, PC thoughts in *italics*.\n\n`;

  if (director.gmInitiative) {
    prompt += `[GM INITIATIVE — WORK THIS COMPLICATION INTO YOUR RESPONSE]
Before answering the player's action, FIRST introduce this complication naturally into the scene:
${director.gmInitiative}
Weave it into the narration — don't announce it artificially. The player's action still happens, but this complication occurs at the same time or just before/after.\n\n`;
  }

  // Remind the narrator about character condition
  const woundedChars = characters.filter((c) => c.statusNotes && c.statusNotes !== "healthy");
  if (woundedChars.length > 0) {
    prompt += `[CHARACTER CONDITION — reflect this in your prose]\n`;
    for (const c of woundedChars) {
      const hp = hpValue(c.stats) ?? 0;
      const maxHp = maxHpValue(c.stats) ?? 20;
      prompt += `${c.name}: ${c.statusNotes} (HP: ${hp}/${maxHp})\n`;
      if (hp === 0) {
        prompt += `  ⚠ ${c.name} is at 0 HP. They cannot act normally. Show them struggling, fading, or needing rescue. Do NOT ignore this.\n`;
      } else if (typeof hp === "number" && typeof maxHp === "number" && hp <= maxHp * 0.25) {
        prompt += `  ${c.name} is badly wounded — describe pain, slowness, difficulty with physical actions.\n`;
      }
    }
    prompt += "\n";
  }

  prompt += `[PLAYER ACTION]\n${userMessage}\n\n`;

  // List available stats for mechanic markers
  const availableStats = characters[0]
    ? Object.keys(characters[0].stats).filter((k) => k !== "HP" && k !== "hp" && k !== "MaxHP" && k !== "maxHp")
    : [];
  const statsHint = availableStats.length > 0
    ? `Available stats for {STAT}: ${availableStats.join(", ")}`
    : "";

  prompt += `[MECHANICS FORMAT]
Inline markers for uncertain outcomes (do NOT resolve, just place mid-sentence):
[MECHANIC:stat_check:{STAT}:DC{n}] | [MECHANIC:damage:{dice}] | [MECHANIC:save:{STAT}:DC{n}] | [MECHANIC:contest:{STAT}:vs:{mod}]
${statsHint}
Example: "You reach for the latch [MECHANIC:stat_check:${availableStats[1] ?? "Dexterity"}:DC12] as the guard's gaze sweeps the room."
Max 1 per response. Only for real risk. damage= only for PC taking damage. Must be inside prose.

[STATE_UPDATE FORMAT]
Append at END only if inventory/stats/status changed. Omit entirely if unchanged.
<!-- STATE_UPDATE
{"characters":{"${characters[0]?.name ?? "CharacterName"}":{"addInventory":["item"],"removeInventory":["item"],"statChanges":{"HP":-3},"statusNotes":"condition"}}}
STATE_UPDATE -->
Key = exact PC name. Omit unchanged fields. Negative stat = damage, positive = heal.`;

  // Anti-repetition: extract opening phrases from recent assistant messages
  const recentOpenings = extractRecentOpenings(sceneSummary);
  if (recentOpenings.length > 0) {
    prompt += `\n[DO NOT START WITH] These exact openings were used recently — find a fresh way in:\n${recentOpenings.map((o) => `- "${o}"`).join("\n")}\n\n`;
  }

  // Repeated last: with a non-English world or scene, e4b followed the context
  // language and ignored the [LANGUAGE] line at the top.
  prompt += `\n[LANGUAGE] Write your reply in English.`;

  // Token budget: compute how much scene summary fits and splice it in
  const { truncatedSummary } = computeSceneSummaryBudget(prompt, sceneSummary, userMessage, maxCtx);
  prompt = prompt.replace(
    summaryPlaceholder,
    `[CURRENT SCENE — continue from here, do NOT contradict or reset]\n${truncatedSummary}\n\n`
  );

  return prompt;
}

/** Spell out what the ending's roll means — e4b narrated a FAILURE as a breakthrough. */
function outcomeLine(description: string): string {
  if (/CRITICAL FUMBLE/i.test(description)) return "THE ROLL WAS A CRITICAL FAILURE — the attempt backfires badly and the situation gets worse.";
  if (/CRITICAL HIT/i.test(description)) return "THE ROLL WAS A CRITICAL SUCCESS — the attempt works spectacularly.";
  if (/FAILURE/i.test(description)) return "THE ROLL FAILED — the player does NOT get what they tried for: no insight, no progress on that action, and a cost.";
  if (/SUCCESS/i.test(description)) return "THE ROLL SUCCEEDED — the player gets what they tried for.";
  return "Describe the result of this roll.";
}

export function buildSnippetPrompt(
  campaign: Campaign,
  characters: Character | Character[],
  resolutions: { index: number; description: string; contextBefore: string; contextAfter: string; draftTail?: string }[]
): string {
  const charList = Array.isArray(characters) ? characters : [characters];
  let prompt = `[ROLE] Write brief narrative snippets for resolved game mechanics. ALWAYS write in English.\n\n`;
  prompt += `[TONE] ${campaign.tone} / ${campaign.genre}\n`;
  if (charList.length === 1) {
    const character = charList[0];
    const hp = hpValue(character.stats) ?? "?";
    const maxHp = maxHpValue(character.stats) ?? "?";
    prompt += `[CHARACTER] ${character.name}, ${character.role}\n`;
    prompt += `HP: ${hp}/${maxHp} | Status: ${character.statusNotes ?? "healthy"}\n`;
    prompt += `Inventory: ${character.inventory.length > 0 ? character.inventory.join(", ") : "Nothing"}\n\n`;
  } else {
    prompt += `[PARTY]\n`;
    for (const c of charList) {
      const hp = hpValue(c.stats) ?? "?";
      const maxHp = maxHpValue(c.stats) ?? "?";
      prompt += `- ${c.name} (${c.role}) HP:${hp}/${maxHp} [${c.statusNotes ?? "healthy"}]: ${c.inventory.length > 0 ? c.inventory.join(", ") : "Nothing"}\n`;
    }
    prompt += "\n";
  }
  prompt += `[RESOLVED MECHANICS]\n`;

  for (const res of resolutions) {
    prompt += `#${res.index}: ${res.description}\n`;
    prompt += `  Context before: "${res.contextBefore}"\n`;
    if (res.draftTail) {
      prompt += `  Draft ending (written BEFORE the roll — you replace it): "${res.draftTail}"\n\n`;
    } else {
      prompt += `  Context after: "${res.contextAfter}"\n\n`;
    }
  }
  const tail = resolutions.find((r) => r.draftTail);

  prompt += `[INSTRUCTIONS]
For each numbered mechanic, write 1-2 sentences of vivid narrative prose describing the outcome.
- SUCCESS: the action WORKS — describe how. Muscle memory, training, luck, skill. Be specific about the technique.
- FAILURE: the action FAILS — describe the attempt and what went wrong. A fumble, a misjudgment, bad timing. Show the consequence.
- DAMAGE: describe the IMPACT — visceral, physical, painful. Where does it hit? What does it feel like? Blood, bone, force. Don't sanitize.
- CRITICAL SUCCESS (natural 20): the action succeeds spectacularly — describe something impressive or lucky.
- CRITICAL FAILURE (natural 1): something goes badly wrong — a weapon slips, footing is lost, the situation worsens.
Match the surrounding tone and voice. Be concise but vivid. Use sensory detail.
- VOICE: second person, addressing the PC as "you" — never third person, never the PC's name as the subject.
- Only in-world prose: no notes, labels or parentheses explaining the roll or its purpose.

CRITICAL: Your snippet REPLACES the [MECHANIC:...] marker in the text. The "context before" and "context after" will remain. Do NOT repeat or paraphrase the context — write ONLY the new connecting prose that fits between them.
${tail ? `
ENDING (#${tail.index}): ${outcomeLine(tail.description)}
It has a "Draft ending" instead of "context after". The draft ending is DELETED — your #${tail.index} text replaces the marker AND the whole draft ending, so it closes the turn:
- Start with the outcome of the roll, then continue the scene as a direct consequence of it. A FAILURE costs something real: a wound, lost gear, noise that draws attention, a worse position — not just a near miss.
- Keep the draft's NPC dialogue, discoveries and details that still fit the outcome; rewrite or drop anything that assumes the opposite result. On SUCCESS the player gets what they were trying for — show it concretely.
- The player only does what they said: don't have them take, use or say anything more.
- 2-4 short paragraphs. NPC dialogue on its own line as: > "Line."
- End on a concrete beat: what the player now sees, holds or faces. Do not ask the player what they do.
- If your ending wounds the PC or they gain/lose an item, add this last line (HP loss 1-6):
<!-- STATE_UPDATE {"characters":{"${charList[0]?.name ?? "Name"}":{"statChanges":{"HP":-3},"addInventory":["item"]}}} STATE_UPDATE -->
` : ""}
Output format (strict):
#0: {prose}
#1: {prose}
...`;

  return prompt;
}

/**
 * Estimate total token usage for a narrator prompt + messages array.
 * If it exceeds maxCtx, returns how many chars to trim from sceneSummary.
 */
export function computeSceneSummaryBudget(
  promptWithoutSummary: string,
  sceneSummary: string,
  userMessage: string,
  maxCtx: number = config.ollamaNumCtx,
  reserveForResponse: number = 1200
): { truncatedSummary: string } {
  const fixedTokens = estimateTokens(promptWithoutSummary) + estimateTokens(userMessage) + reserveForResponse;
  const budgetForSummary = maxCtx - fixedTokens;

  if (budgetForSummary <= 0) {
    // Extreme case — no room at all. Keep last 200 chars.
    return { truncatedSummary: sceneSummary.slice(-800) };
  }

  const summaryTokens = estimateTokens(sceneSummary);
  if (summaryTokens <= budgetForSummary) {
    return { truncatedSummary: sceneSummary };
  }

  // Truncate: keep the most recent messages (end of summary)
  const charBudget = budgetForSummary * 4;
  return { truncatedSummary: "..." + sceneSummary.slice(-charBudget) };
}

/**
 * Extract the first ~8 words of each recent ASSISTANT message from the scene summary.
 * These are passed to the model as "do not start with" guidance to prevent
 * repetitive openings like "The tavern..." or "You see..." over and over.
 */
function extractRecentOpenings(sceneSummary: string): string[] {
  const lines = sceneSummary.split("\n\n");
  const openings: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("[ASSISTANT]:")) continue;
    const content = line.replace("[ASSISTANT]: ", "").trim();
    if (!content) continue;
    // Take the first 8 words as the opening phrase
    const words = content.split(/\s+/).slice(0, 8);
    if (words.length >= 3) {
      openings.push(words.join(" "));
    }
  }
  // Only keep the most recent 4 to avoid bloating the prompt
  return openings.slice(-4);
}

/** Map SD gender token to narrative pronoun hint */
function genderToPronouns(gender: string): string {
  const g = gender.toLowerCase();
  // "woman" contains "man" — check it first.
  if (g.includes("woman") || g.includes("girl")) return " (she/her)";
  if (g.includes("man") || g.includes("boy")) return " (he/him)";
  if (g.includes("androgynous") || g.includes("person")) return " (they/them)";
  return "";
}

function dispositionWord(value: number): string {
  if (value >= 50) return "friendly";
  if (value >= 20) return "warm";
  if (value >= -20) return "neutral";
  if (value >= -50) return "cool";
  return "hostile";
}
