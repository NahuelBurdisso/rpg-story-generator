import type {
  CampaignRow, CharacterRow, MemoryRow, MessageRow, NpcMemoryRow, SceneImageRow, SessionRow, UserSettingsRow,
} from "@/server/db/schema";
import type {
  ArcPhase, ConsequenceSeed, DirectorIntent, StoryThread, ThreadKind,
} from "@/server/db/jsonTypes";
import type { MemoryKind, MemorySource } from "@/lib/enums";

// Enums come from lib/enums.ts, JSON-column shapes and story-state types from
// server/db/jsonTypes.ts, row types from server/db/schema.ts. Type-only imports
// are erased at compile time, so this file stays safe to import from client code.
export type {
  Genre, Tone, Difficulty, DiceType, LLMErrorType, LLMProvider, MessageRole, SessionStatus,
  ImageStyle, TriggerType, ImageStatus, MemoryKind, MemorySource, MemoryStatus,
} from "@/lib/enums";
export type {
  QuickAction, CustomImageConfig, Appearance, ConsequenceSeed, SceneState, DiceRoll, MechanicRoll,
  MessageMetadata, NpcRelationship, NpcMemoryLogEntry, ContextSnapshot,
  ThreadKind, ThreadStatus, ArcPhase, DirectorIntent, StoryThread, SessionStoryState,
  CampaignStoryThread, CampaignStoryState,
} from "@/server/db/jsonTypes";

export interface StateUpdate {
  characters: Record<
    string,
    {
      addInventory?: string[];
      removeInventory?: string[];
      statusNotes?: string;
      statChanges?: Record<string, number>;
    }
  >;
}

// ============================================
// Database document types (derived from the schema)
// ============================================

export type Campaign = CampaignRow;
export type Character = CharacterRow;
export type Session = SessionRow;
export type Message = MessageRow;
export type SceneImage = SceneImageRow;
export type NPCMemoryDoc = NpcMemoryRow;
export type NPCMemoryEntry = MemoryRow;

/** API shape of user settings: the API keys never leave the server; only `has*Key` flags do. */
export type UserSettings = Omit<UserSettingsRow, "openaiApiKey" | "anthropicApiKey"> & {
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
};

// ============================================
// Pipeline types
// ============================================

export interface StatCheckParams { stat: string; dc: number; }
export interface DamageParams { dice: string; }
export interface ContestParams { stat: string; modifier: number; }

type MechanicParams = StatCheckParams | DamageParams | ContestParams;

export interface MechanicMarker {
  index: number;
  startIndex: number;
  endIndex: number;
  fullMatch: string;
  type: "stat_check" | "damage" | "save" | "contest";
  params: MechanicParams;
}

export interface Resolution {
  index: number;
  roll: number[];
  modifier: number;
  total: number;
  success?: boolean;
  description: string;
}

export type InputComplexity = "trivial" | "standard";

export type { GalleryImage, CampaignGalleryImage } from "./gallery";

// ============================================
// Story-state + director types
// ============================================

export interface DirectorDecision {
  phase: ArcPhase;
  tension: number;
  intent: DirectorIntent;
  wordBudget: string;
  spotlight?: StoryThread;
  gmInitiative: string;
  activeThreads: { label: string; kind: ThreadKind; notes?: string }[];
  actingNpc?: { name: string; agenda: string; voice?: string };
  consequenceEcho?: string;
}

export interface NpcAgendaLite {
  id: string;
  name: string;
  agenda?: string | null;
  agendaThreadId?: string | null;
  lastActedTurn?: number | null;
  speechPattern?: string | null;
}

export type ConsequenceSeedLite = Pick<ConsequenceSeed, "echo" | "messagesUntilEcho" | "threadId">;

// ============================================
// NPC Episodic Memory types
// ============================================

/** A memory plus its computed effective salience, returned by retrieval. */
export interface RetrievedMemory {
  id: string;
  about: string;
  kind: MemoryKind;
  content: string;
  valence: number;
  source: MemorySource;
  confidence: number;
  effectiveSalience: number;
}
