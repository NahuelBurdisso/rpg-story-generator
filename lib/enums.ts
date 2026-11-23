/**
 * Single definition of every enum-like value set. Client-safe: no imports.
 * The DB schema, zod input schemas and UI option lists are all built from
 * these arrays, so a new value is added in exactly one place.
 */

export const GENRES = ["fantasy", "sci-fi", "horror", "post-apocalyptic", "custom"] as const;
export const TONES = ["serious", "humorous", "dark", "lighthearted"] as const;
export const DIFFICULTIES = ["easy", "normal", "hard", "nightmare"] as const;
export const IMAGE_STYLES = [
  "painterly-fantasy",
  "cinematic-scifi",
  "dark-ink",
  "anime-rpg",
  "sketch-parchment",
  "photorealistic",
  "grimdark-horror",
  "extreme-horror",
  "custom",
] as const;
export const LLM_PROVIDERS = ["ollama", "openai", "anthropic"] as const;
export const TRIGGER_TYPES = ["scene_change", "consequence", "combat", "gm_event", "player_request"] as const;
export const IMAGE_STATUSES = ["generating", "completed", "failed", "replaced"] as const;
export const SESSION_STATUSES = ["active", "completed"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export const DICE_TYPES = ["d4", "d6", "d8", "d10", "d12", "d20"] as const;
export const LLM_ERROR_TYPES = [
  "connection_failed",
  "auth_failed",
  "model_not_found",
  "rate_limited",
  "timeout",
  "context_too_long",
  "unknown",
] as const;
export const MEMORY_KINDS = ["episodic", "semantic"] as const;
export const MEMORY_SOURCES = ["witnessed", "heard", "rumor"] as const;
export const MEMORY_STATUSES = ["active", "consolidated", "forgotten"] as const;
export const THREAD_KINDS = ["mystery", "threat", "promise", "goal"] as const;
export const THREAD_STATUSES = ["open", "escalating", "resolved", "abandoned"] as const;

export type Genre = (typeof GENRES)[number];
export type Tone = (typeof TONES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type ImageStyle = (typeof IMAGE_STYLES)[number];
export type LLMProvider = (typeof LLM_PROVIDERS)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ImageStatus = (typeof IMAGE_STATUSES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type DiceType = (typeof DICE_TYPES)[number];
export type LLMErrorType = (typeof LLM_ERROR_TYPES)[number];
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type ThreadKind = (typeof THREAD_KINDS)[number];
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
