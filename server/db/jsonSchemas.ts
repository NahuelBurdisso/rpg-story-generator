/**
 * Runtime validation for the JSON columns whose shapes live in jsonTypes.ts.
 * Each `read*` function takes the raw column value and returns a safe value,
 * falling back (with a `console.warn`) instead of throwing. Nothing is written
 * back: the clean version is persisted by the next turn commit.
 *
 * Every schema is annotated `z.ZodType<T>` (or with an `unknown` input where it
 * fills defaults), so it cannot drift from the type in jsonTypes.ts.
 */
import { z } from "zod";
import { DICE_TYPES, LLM_ERROR_TYPES } from "@/lib/enums";
import type {
  CampaignStoryState,
  CampaignStoryThread,
  ConsequenceSeed,
  MessageMetadata,
  SceneState,
  SessionStoryState,
  StoryThread,
  ThreadStatus,
} from "./jsonTypes";
import { coldStartState } from "../pipeline/director";
import { DEFAULT_THREAD_KIND, normalizeThreadKind, normalizeThreadStatus, normalizeThreadWeight } from "../pipeline/threadFields";

type Lenient<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

// Thread kind/status/weight degrade to a safe value instead of dropping the whole thread.
const threadKind = z.unknown().transform((v) => normalizeThreadKind(v) ?? DEFAULT_THREAD_KIND);
const threadStatus = z.unknown().transform((v): ThreadStatus => normalizeThreadStatus(v) ?? "open");
const arcPhase = z.enum(["setup", "rising", "climax", "falling", "resolution"]);
const directorIntent = z.enum(["develop", "escalate", "payoff", "breathe"]);
const weight = z.unknown().transform((v) => normalizeThreadWeight(v) ?? 3);

// ---------------------------------------------------------------------------
// messages.metadata
// ---------------------------------------------------------------------------

const messageMetadataObject = z.object({
  diceRoll: z.object({ dice: z.enum(DICE_TYPES), result: z.number() }).optional(),
  mechanics: z
    .array(
      z.object({
        text: z.string(),
        outcome: z.enum(["success", "failure", "critical", "fumble", "neutral"]),
      })
    )
    .optional(),
  action: z.string().optional(),
  error: z.boolean().optional(),
  errorType: z.enum(LLM_ERROR_TYPES).optional(),
  errorMessage: z.string().optional(),
  imageId: z.string().optional(),
  opener: z.boolean().optional(),
});

/** Full shape of `messages.metadata`, including the server-written `mechanics`, `imageId` and `opener`. */
export const messageMetadataSchema: z.ZodType<MessageMetadata> = messageMetadataObject;

/**
 * What a client may send. `mechanics`, `imageId`, `opener` and the error fields
 * (`error`, `errorType`, `errorMessage`) are written only by the pipeline /
 * image router (the object schema strips them).
 */
export const clientMessageMetadataSchema = messageMetadataObject.omit({
  mechanics: true,
  imageId: true,
  opener: true,
  error: true,
  errorType: true,
  errorMessage: true,
});

// ---------------------------------------------------------------------------
// sessions.storyState / campaigns.storyState
// ---------------------------------------------------------------------------

const storyThreadSchema: Lenient<StoryThread> = z.object({
  id: z.string(),
  label: z.string(),
  kind: threadKind,
  status: threadStatus,
  weight,
  scope: z.enum(["session", "campaign"]),
  introducedTurn: z.number(),
  lastTouchedTurn: z.number(),
  touchedCount: z.number(),
  forcedPayoffTurns: z.number(),
  ownerNpcId: z.string().optional(),
  notes: z.string().optional(),
  campaignThreadId: z.string().optional(),
});

const sessionStoryStateBase = z.object({
  version: z.literal(1),
  phase: arcPhase,
  tension: z.number(),
  turnsInPhase: z.number(),
  beatsSincePayoff: z.number(),
  turn: z.number(),
  lastGmInitiativeTurn: z.number(),
  lastIntent: directorIntent.optional(),
  lastSpotlightId: z.string().optional(),
  lastReconcileTurn: z.number().optional(),
  lastJournalTurn: z.number().optional(),
});

const campaignThreadSchema: Lenient<CampaignStoryThread> = z.object({
  id: z.string(),
  label: z.string(),
  kind: threadKind,
  status: threadStatus,
  weight,
  introducedSession: z.string(),
  lastTouchedSession: z.string(),
  notes: z.string().optional(),
  history: z.array(z.string()),
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keeps the elements that parse; reports how many were dropped. */
function keepValid<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, items: unknown[]): { valid: T[]; dropped: number } {
  const valid: T[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) valid.push(r.data);
  }
  return { valid, dropped: items.length - valid.length };
}

export function readSessionStoryState(raw: unknown): SessionStoryState {
  if (raw === null || raw === undefined) return coldStartState();
  if (!isRecord(raw) || !Array.isArray(raw.threads)) {
    console.warn("[json] invalid sessions.storyState: not an object with threads; using a cold start");
    return coldStartState();
  }
  const base = sessionStoryStateBase.safeParse(raw);
  if (!base.success) {
    console.warn("[json] invalid sessions.storyState", base.error.issues);
    return coldStartState();
  }
  const { valid, dropped } = keepValid(storyThreadSchema, raw.threads);
  if (dropped > 0) console.warn(`[json] invalid sessions.storyState: dropped ${dropped} malformed thread(s)`);
  return { ...base.data, threads: valid };
}

export function readCampaignStoryState(raw: unknown): CampaignStoryState | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.threads)) {
    console.warn("[json] invalid campaigns.storyState: not a version-1 object with threads");
    return null;
  }
  const { valid, dropped } = keepValid(campaignThreadSchema, raw.threads);
  if (dropped > 0) console.warn(`[json] invalid campaigns.storyState: dropped ${dropped} malformed thread(s)`);
  return { version: 1, threads: valid };
}

// ---------------------------------------------------------------------------
// sessions.sceneState / sessions.consequenceSeeds
// ---------------------------------------------------------------------------

/** An array column: missing or non-array becomes [], elements failing `schema` are dropped. */
function lenientArray<T>(schema: Lenient<T>): Lenient<T[]> {
  return z.preprocess((v) => (Array.isArray(v) ? keepValid(schema, v).valid : []), z.array(schema)) as Lenient<T[]>;
}

const sceneNpcSchema = z.object({
  name: z.string(),
  desc: z.string().catch(""),
  disposition: z.string().catch(""),
});

const sceneStateSchema: Lenient<SceneState> = z.object({
  location: z.string(),
  activeNPCs: lenientArray(sceneNpcSchema),
  situation: z.string(),
  pendingThreats: lenientArray(z.string()),
  timeOfDay: z.string(),
  mood: z.string().optional().catch(undefined),
});

export function readSceneState(raw: unknown): SceneState | null {
  if (raw === null || raw === undefined) return null;
  const r = sceneStateSchema.safeParse(raw);
  if (!r.success) {
    console.warn("[json] invalid sessions.sceneState", r.error.issues);
    return null;
  }
  return r.data;
}

const consequenceSeedSchema: Lenient<ConsequenceSeed> = z.object({
  trigger: z.string().catch(""),
  echo: z.string().min(1),
  messagesUntilEcho: z.number(),
  threadId: z.string().optional().catch(undefined),
});

export function readConsequenceSeeds(raw: unknown): ConsequenceSeed[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    console.warn("[json] invalid sessions.consequenceSeeds: not an array");
    return [];
  }
  const { valid, dropped } = keepValid(consequenceSeedSchema, raw);
  if (dropped > 0) console.warn(`[json] invalid sessions.consequenceSeeds: dropped ${dropped} malformed seed(s)`);
  return valid;
}
