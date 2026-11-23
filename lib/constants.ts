import type { QuickAction } from "../types/index";
import {
  GENRES as GENRE_IDS,
  TONES as TONE_IDS,
  DIFFICULTIES as DIFFICULTY_IDS,
  DICE_TYPES as DICE_TYPE_IDS,
  type Genre,
  type Tone,
  type Difficulty,
  type DiceType,
  type ImageStyle,
  type TriggerType,
  type SessionStatus,
} from "./enums";

// ============================================
// Enums and option lists (values come from lib/enums.ts)
// ============================================

const GENRE_LABELS: Record<Genre, string> = {
  fantasy: "Fantasy",
  "sci-fi": "Sci-Fi",
  horror: "Horror",
  "post-apocalyptic": "Post-Apocalyptic",
  custom: "Custom",
};

const TONE_LABELS: Record<Tone, string> = {
  serious: "Serious",
  humorous: "Humorous",
  dark: "Dark",
  lighthearted: "Lighthearted",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  nightmare: "Nightmare",
};

export const GENRE_OPTIONS: Array<{ value: Genre; label: string }> =
  GENRE_IDS.map((value) => ({ value, label: GENRE_LABELS[value] }));

export const TONE_OPTIONS: Array<{ value: Tone; label: string }> =
  TONE_IDS.map((value) => ({ value, label: TONE_LABELS[value] }));

export const DIFFICULTY_OPTIONS: Array<{ value: Difficulty; label: string }> =
  DIFFICULTY_IDS.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }));

export const DICE_TYPE_OPTIONS: DiceType[] = [...DICE_TYPE_IDS];

// ============================================
// Genre-based presets
// ============================================

export const STAT_PRESETS: Record<Genre, string[]> = {
  fantasy: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  "sci-fi": ["Strength", "Agility", "Endurance", "Intelligence", "Tech", "Charisma"],
  horror: ["Strength", "Agility", "Endurance", "Intelligence", "Willpower", "Composure"],
  "post-apocalyptic": ["Strength", "Agility", "Endurance", "Intelligence", "Survival", "Charisma"],
  custom: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
};

export const QUICK_ACTION_PRESETS: Record<Genre, QuickAction[]> = {
  fantasy: [
    { label: "Attack", prompt: "I draw my weapon and attack the nearest threat." },
    { label: "Investigate", prompt: "I carefully examine my surroundings, looking for anything unusual or hidden." },
    { label: "Talk", prompt: "I approach and try to strike up a conversation, sizing up their intentions." },
    { label: "Cast Spell", prompt: "I channel my power and cast a spell." },
    { label: "Sneak", prompt: "I move silently, keeping to the shadows." },
    { label: "Rest", prompt: "I look for a safe place to rest and tend to my wounds." },
  ],
  "sci-fi": [
    { label: "Shoot", prompt: "I draw my weapon and open fire on the target." },
    { label: "Scan", prompt: "I activate my scanner and sweep the area for threats, signals, or anomalies." },
    { label: "Hack", prompt: "I jack into the system and try to break through its security." },
    { label: "Negotiate", prompt: "I raise my hands and try to talk my way out of this." },
    { label: "Use Tech", prompt: "I pull out my gear and use it to solve the problem." },
    { label: "Evade", prompt: "I dive behind cover and try to stay out of sight." },
  ],
  horror: [
    { label: "Hide", prompt: "I press myself into the darkest corner I can find and hold my breath." },
    { label: "Investigate", prompt: "Against my better judgment, I move closer and examine the source of the disturbance." },
    { label: "Run", prompt: "I don't look back — I run as fast as my legs will carry me." },
    { label: "Barricade", prompt: "I shove furniture against the door and brace for whatever comes next." },
    { label: "Listen", prompt: "I stand perfectly still and strain my ears." },
    { label: "Search", prompt: "I desperately search the area for anything that might help me survive." },
  ],
  "post-apocalyptic": [
    { label: "Fight", prompt: "There's no choice — I ready my weapon and engage." },
    { label: "Scavenge", prompt: "I pick through the ruins for anything useful — food, ammo, supplies." },
    { label: "Trade", prompt: "I show what I've got and try to negotiate a fair trade." },
    { label: "Sneak", prompt: "I crouch low and move from cover to cover, avoiding detection." },
    { label: "Camp", prompt: "I set up a makeshift camp, ration what I have, and try to rest." },
    { label: "Intimidate", prompt: "I make myself look as dangerous as possible and dare them to try something." },
  ],
  custom: [
    { label: "Attack", prompt: "I attack the threat head-on." },
    { label: "Investigate", prompt: "I search the area for clues or hidden details." },
    { label: "Talk", prompt: "I approach and try to communicate." },
    { label: "Sneak", prompt: "I move quietly and try not to be seen." },
    { label: "Defend", prompt: "I take a defensive stance and brace for whatever comes." },
    { label: "Rest", prompt: "I look for a safe place to rest and recover." },
  ],
};

// ============================================
// Defaults and configuration
// ============================================

export const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
/** Longest chat message the server accepts (app/api/chat/stream/route.ts); the input box enforces it too. */
export const MAX_MESSAGE_LENGTH = 8000;
// keep in sync with server/config.ts default (client code cannot import server/config)
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// ============================================
// Display labels shared across screens
// ============================================

/**
 * Literal class names (not `genre-${g}`) so Tailwind sees them when it scans lib/.
 * The CSS lives in app/globals.css.
 */
export const GENRE_CLASS: Record<Genre, string> = {
  fantasy: "genre-fantasy",
  "sci-fi": "genre-sci-fi",
  horror: "genre-horror",
  "post-apocalyptic": "genre-post-apocalyptic",
  custom: "genre-custom",
};

/** Full labels (lightbox). */
export const TRIGGER_LABELS: Record<TriggerType, string> = {
  scene_change: "Scene Change",
  combat: "Combat",
  consequence: "Consequence",
  gm_event: "GM Event",
  player_request: "Player Request",
};

/** Short labels (gallery cards). */
export const TRIGGER_SHORT_LABELS: Record<TriggerType, string> = {
  scene_change: "Scene",
  combat: "Combat",
  consequence: "Consequence",
  gm_event: "Event",
  player_request: "Requested",
};

export const IMAGE_STYLE_LABELS: Record<ImageStyle, string> = {
  "painterly-fantasy": "Painterly Fantasy",
  "cinematic-scifi": "Cinematic Sci-Fi",
  "dark-ink": "Dark Ink",
  "anime-rpg": "Anime RPG",
  "sketch-parchment": "Sketch & Parchment",
  photorealistic: "Photorealistic",
  "grimdark-horror": "Grimdark Horror",
  "extreme-horror": "Extreme Horror",
  custom: "Custom",
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  active: "active",
  completed: "ended",
};

/** The label for `value` in an option list, or the raw value when it is not in the list. */
export function optionLabel<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
