/**
 * Shapes of the JSON columns in schema.ts, plus the story-state types they
 * contain. Type-only (no runtime code), so client code may `import type` from
 * here. schema.ts depends on this file, never the other way round.
 */
import type { DiceType, LLMErrorType, ThreadKind, ThreadStatus } from "@/lib/enums";

// ---------------------------------------------------------------------------
// campaigns / characters
// ---------------------------------------------------------------------------

export interface QuickAction {
  label: string;
  prompt: string;
}

export interface CustomImageConfig {
  checkpoint?: string;
  lora?: { name: string; strength: number };
  negativePrompt?: string;
  defaultDimensions?: { width: number; height: number };
}

export interface Appearance {
  gender?: string;
  build?: string;
  height?: string;
  age?: string;
  skinTone?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  eyeFeature?: string;
  clothing?: string;
  features?: string;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export interface ConsequenceSeed {
  trigger: string;
  echo: string;
  messagesUntilEcho: number;
  threadId?: string;
}

export interface SceneState {
  location: string;
  activeNPCs: { name: string; desc: string; disposition: string }[];
  situation: string;
  pendingThreats: string[];
  timeOfDay: string;
  mood?: string;
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export interface DiceRoll {
  dice: DiceType;
  result: number;
}

/** A narrator-triggered [MECHANIC] roll, as shown to the player. */
export interface MechanicRoll {
  text: string;
  outcome: "success" | "failure" | "critical" | "fumble" | "neutral";
}

export interface MessageMetadata {
  diceRoll?: DiceRoll;
  mechanics?: MechanicRoll[];
  action?: string;
  error?: boolean;
  errorType?: LLMErrorType;
  errorMessage?: string;
  imageId?: string;
  /** Server-written: the hidden opener turn. */
  opener?: boolean;
}

// ---------------------------------------------------------------------------
// npc_memory
// ---------------------------------------------------------------------------

export interface NpcRelationship {
  target: string;
  disposition: number;
  lastInteraction: string;
}

export interface NpcMemoryLogEntry {
  sessionId: string;
  summary: string;
  emotionalShift: string;
}

// ---------------------------------------------------------------------------
// scene_images
// ---------------------------------------------------------------------------

export interface ContextSnapshot {
  location: string | null;
  timeOfDay: string | null;
  activeNPCs: string[];
  situation: string | null;
  characterName: string | null;
  characterStatus: string | null;
}

// ---------------------------------------------------------------------------
// Story state (sessions.storyState / campaigns.storyState)
// ---------------------------------------------------------------------------

export type { ThreadKind, ThreadStatus };
export type ArcPhase = "setup" | "rising" | "climax" | "falling" | "resolution";
export type DirectorIntent = "develop" | "escalate" | "payoff" | "breathe";

export interface StoryThread {
  id: string;
  label: string;
  kind: ThreadKind;
  status: ThreadStatus;
  weight: 1 | 2 | 3 | 4 | 5;
  scope: "session" | "campaign";
  introducedTurn: number;
  lastTouchedTurn: number;
  touchedCount: number;
  forcedPayoffTurns: number;
  ownerNpcId?: string;
  notes?: string;
  campaignThreadId?: string;
}

export interface SessionStoryState {
  version: 1;
  phase: ArcPhase;
  tension: number;
  turnsInPhase: number;
  beatsSincePayoff: number;
  turn: number;
  lastGmInitiativeTurn: number;
  lastIntent?: DirectorIntent;
  lastSpotlightId?: string;
  /** Turn of the last campaign-thread reconcile (cadence bookkeeping). */
  lastReconcileTurn?: number;
  /** Turn of the last mid-session campaign-journal rewrite. */
  lastJournalTurn?: number;
  threads: StoryThread[];
}

export interface CampaignStoryThread {
  id: string;
  label: string;
  kind: ThreadKind;
  status: ThreadStatus;
  weight: 1 | 2 | 3 | 4 | 5;
  introducedSession: string;
  lastTouchedSession: string;
  notes?: string;
  history: string[];
}

export interface CampaignStoryState {
  version: 1;
  threads: CampaignStoryThread[];
}
