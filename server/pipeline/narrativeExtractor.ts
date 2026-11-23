import { callLLM, type ProviderConfig, type LLMOptions } from "@/server/llm/providers";
import type { ThreadKind, ThreadStatus } from "@/types/index";
import { scanBalanced } from "./json";
import { DEFAULT_THREAD_KIND, normalizeThreadKind, normalizeThreadStatus, normalizeThreadWeight } from "./threadFields";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadUpdate {
  id: string;
  status?: ThreadStatus;
  notes?: string;
}

export interface NewThread {
  label: string;
  kind: ThreadKind;
  weight: number;
  notes?: string;
}

export interface StoryExtract {
  threadUpdates: ThreadUpdate[];
  newThreads: NewThread[];
  tensionRead: number;
}

export interface NpcUpdate {
  name: string;
  goal?: string;
  agenda?: string;
  agendaThreadId?: string;
  // Merged from extractNpcMemory
  dispositionDelta?: number;
  speechPattern?: string;
  vocabulary?: string;
  newState?: string;
  interactedWith?: string[];
}

export interface NpcExtract {
  updates: NpcUpdate[];
}

export interface WorldSeed {
  trigger: string;
  echo: string;
  threadId?: string;
}

export interface WorldExtract {
  newSeeds: WorldSeed[];
}

export interface ExtractedMemory {
  npc: string;       // holder (exact in-scene NPC name)
  about: string;     // subject: "player" | NPC name | place/thing
  content: string;   // episodic line, NPC POV
  valence: number;   // -100..100
  salience: number;  // 0..100
  threadId?: string;
}

export interface SceneExtract {
  location: string;
  activeNPCs: { name: string; desc: string; disposition: string }[];
  situation: string;
  pendingThreats: string[];
  timeOfDay: string;
  mood?: string;
}

export interface NarrativeStateResult {
  story: StoryExtract;
  npc: NpcExtract;
  world: WorldExtract;
  memories: ExtractedMemory[];
  scene: SceneExtract;
}

// ---------------------------------------------------------------------------
// Pure parser — never throws
// ---------------------------------------------------------------------------

const SAFE_DEFAULT: NarrativeStateResult = {
  story: { threadUpdates: [], newThreads: [], tensionRead: NaN },
  npc: { updates: [] },
  world: { newSeeds: [] },
  memories: [],
  scene: { location: "", activeNPCs: [], situation: "", pendingThreats: [], timeOfDay: "" },
};

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return v !== null && typeof v === "object";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function strNonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** A thread note that only says nothing happened ("still unresolved", "remains active"). */
function isFillerNote(notes: unknown): boolean {
  if (typeof notes !== "string" || !notes.trim()) return true;
  return /\b(remains?|still|persists?|noted|awaiting|unresolved|unaddressed|unexamined|no (?:new )?(?:change|progress|action))\b/i.test(notes);
}

/**
 * Repairs a key whose closing quote the model dropped, e.g. `"salience:50` →
 * `"salience":50`. Anchored to key position (after `{` or `,`) so it only runs
 * as a fallback and can't touch well-formed string values.
 */
export function repairJson(json: string): string {
  return json.replace(/([{,]\s*)"([A-Za-z_]\w*):(?=\s*[-\d[{"tfn])/g, '$1"$2":');
}

const TOP_LEVEL_KEYS = ["story", "npc", "world", "memories", "scene"] as const;

/**
 * Returns the bracket-balanced value that follows `"key":`, honouring strings.
 * Brackets the model never closed are closed at the end of the input.
 */
function sliceSection(json: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*[[{]`).exec(json);
  if (!m) return undefined;
  const start = m.index + m[0].length - 1;
  const { end, unclosed } = scanBalanced(json, start, "any");
  return end !== -1 ? json.slice(start, end) : json.slice(start) + unclosed;
}

/**
 * Parses the whole object; failing that, each top-level section on its own, so
 * a missing or extra brace (common with small local models) costs one section
 * instead of the whole extraction.
 */
function parseJsonLenient(json: string): Rec {
  try {
    return JSON.parse(json);
  } catch {
    const repaired = repairJson(json);
    try {
      return JSON.parse(repaired);
    } catch (err) {
      const out: Rec = {};
      for (const key of TOP_LEVEL_KEYS) {
        const section = sliceSection(repaired, key);
        if (section === undefined) continue;
        try {
          out[key] = JSON.parse(section);
        } catch {
          // Drop only this section.
        }
      }
      if (Object.keys(out).length === 0) throw err;
      console.warn(
        `[narrativeExtractor] malformed JSON, recovered sections: ${Object.keys(out).join(", ")}`
      );
      return out;
    }
  }
}

/**
 * Extracts the first JSON blob from a raw LLM response and returns all keys.
 * Returns safe defaults when missing or malformed.
 */
export function parseNarrativeState(raw: string): NarrativeStateResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[narrativeExtractor] no JSON object in response:", raw.slice(0, 200));
      return SAFE_DEFAULT;
    }

    const parsed: Rec = parseJsonLenient(jsonMatch[0]);
    // A lost story section must not take memories/npc/scene down with it.
    const story: Rec = isRec(parsed?.story) ? parsed.story : {};

    const rawUpdates: unknown[] = Array.isArray(story.threadUpdates) ? story.threadUpdates : [];
    const rawNewThreads: unknown[] = Array.isArray(story.newThreads) ? story.newThreads : [];

    // A status that is not a ThreadStatus (after trim + lowercase) is ignored; the update still counts as a touch.
    const threadUpdates: ThreadUpdate[] = rawUpdates
      .filter((item): item is Rec => isRec(item) && !!strNonEmpty((item as Rec).id))
      // e4b lists every thread each turn with "X remains active, awaiting player
      // response" — that counts as a touch and nothing ever goes stale.
      .filter((item) => {
        const status = normalizeThreadStatus(item.status);
        return !(status === undefined || status === "open") || !isFillerNote(item.notes);
      })
      .map((item) => {
        const status = normalizeThreadStatus(item.status);
        return {
          id: item.id as string,
          ...(status ? { status } : {}),
          ...(str(item.notes) ? { notes: item.notes as string } : {}),
        };
      });

    const newThreads: NewThread[] = rawNewThreads
      .filter(
        (item): item is Rec =>
          isRec(item) &&
          !!strNonEmpty((item as Rec).label) &&
          !!str((item as Rec).kind) &&
          normalizeThreadWeight((item as Rec).weight) !== undefined
      )
      .map((item) => ({
        label: item.label as string,
        kind: normalizeThreadKind(item.kind) ?? DEFAULT_THREAD_KIND,
        weight: normalizeThreadWeight(item.weight) as number,
        ...(str(item.notes) ? { notes: item.notes as string } : {}),
      }));

    // -----------------------------------------------------------------------
    // npc key — defensive parsing
    // -----------------------------------------------------------------------
    const rawNpcUpdates: unknown[] = Array.isArray((parsed?.npc as Rec)?.updates)
      ? (parsed.npc as Rec).updates as unknown[]
      : [];

    const npcUpdates: NpcUpdate[] = rawNpcUpdates
      .filter((item): item is Rec => isRec(item) && !!strNonEmpty((item as Rec).name))
      .map((item) => ({
        name: item.name as string,
        ...(str(item.goal) ? { goal: item.goal as string } : {}),
        ...(str(item.agenda) ? { agenda: item.agenda as string } : {}),
        ...(str(item.agendaThreadId) ? { agendaThreadId: item.agendaThreadId as string } : {}),
        ...(num(item.disposition_delta) !== undefined ? { dispositionDelta: item.disposition_delta as number } : {}),
        ...(str(item.speech_pattern) ? { speechPattern: item.speech_pattern as string } : {}),
        ...(str(item.vocabulary) ? { vocabulary: item.vocabulary as string } : {}),
        ...(str(item.new_state) ? { newState: item.new_state as string } : {}),
        ...(Array.isArray(item.interacted_with) ? { interactedWith: (item.interacted_with as unknown[]).filter((n): n is string => typeof n === "string") } : {}),
      }));

    // -----------------------------------------------------------------------
    // world key
    // -----------------------------------------------------------------------
    const rawWorldSeeds: unknown[] = Array.isArray((parsed?.world as Rec)?.newSeeds)
      ? (parsed.world as Rec).newSeeds as unknown[]
      : [];

    const worldSeeds: WorldSeed[] = rawWorldSeeds
      .filter(
        (item): item is Rec =>
          isRec(item) &&
          !!strNonEmpty((item as Rec).trigger) &&
          !!strNonEmpty((item as Rec).echo)
      )
      .map((item) => ({
        trigger: item.trigger as string,
        echo: item.echo as string,
        ...(str(item.threadId) ? { threadId: item.threadId as string } : {}),
      }));

    // -----------------------------------------------------------------------
    // memories key
    // -----------------------------------------------------------------------
    const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
      typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;

    const rawMemories: unknown[] = Array.isArray(parsed?.memories) ? parsed.memories as unknown[] : [];
    const memories: ExtractedMemory[] = rawMemories
      .filter((item): item is Rec =>
        isRec(item) &&
        !!strNonEmpty((item as Rec).npc) &&
        !!strNonEmpty((item as Rec).about) &&
        !!strNonEmpty((item as Rec).content))
      .map((item) => ({
        npc: (item.npc as string).trim(),
        about: (item.about as string).trim(),
        content: (item.content as string).trim(),
        valence: clamp(item.valence, -100, 100, 0),
        salience: clamp(item.salience, 0, 100, 50),
        ...(strNonEmpty(item.threadId) ? { threadId: item.threadId as string } : {}),
      }));

    // -----------------------------------------------------------------------
    // scene key (merged from extractSceneState)
    // -----------------------------------------------------------------------
    const rawScene = parsed?.scene as Rec | undefined;
    const scene: SceneExtract = {
      location: typeof rawScene?.location === "string" ? rawScene.location : "",
      activeNPCs: Array.isArray(rawScene?.activeNPCs)
        ? (rawScene.activeNPCs as unknown[])
            .filter((n): n is Rec => isRec(n) && typeof (n as Rec).name === "string")
            .map((n) => ({
              name: String(n.name),
              desc: String(n.desc ?? ""),
              disposition: String(n.disposition ?? "neutral"),
            }))
        : [],
      situation: typeof rawScene?.situation === "string" ? rawScene.situation : "",
      pendingThreats: Array.isArray(rawScene?.pendingThreats)
        ? (rawScene.pendingThreats as unknown[]).filter((t): t is string => typeof t === "string")
        : [],
      timeOfDay: typeof rawScene?.timeOfDay === "string" ? rawScene.timeOfDay : "",
      ...(typeof rawScene?.mood === "string" && rawScene.mood ? { mood: rawScene.mood } : {}),
    };

    return {
      story: {
        threadUpdates,
        newThreads,
        tensionRead: typeof story.tensionRead === "number" ? story.tensionRead : NaN,
      },
      npc: { updates: npcUpdates },
      world: { newSeeds: worldSeeds },
      memories,
      scene,
    };
  } catch (err) {
    console.warn(
      "[narrativeExtractor] unparseable JSON, extraction dropped:",
      err instanceof Error ? err.message : err,
      raw.slice(0, 200)
    );
    return SAFE_DEFAULT;
  }
}

// ---------------------------------------------------------------------------
// Combined LLM caller — replaces 3 separate calls
// ---------------------------------------------------------------------------

/**
 * Single fire-and-forget extraction call that returns story threads, NPC updates,
 * world seeds, episodic memories, AND scene state. Replaces the old separate
 * extractSceneState, extractNpcMemory, and extractNarrativeState calls.
 */
export async function extractNarrativeState(args: {
  llmConfig: ProviderConfig;
  currentThreads: { id: string; label: string; status: ThreadStatus }[];
  npcs: { id: string; name: string }[];
  knownNpcNames: string[];
  playerAction: string;
  narration: string;
}): Promise<NarrativeStateResult> {
  const { llmConfig, currentThreads, npcs, knownNpcNames, playerAction, narration } = args;

  const threadsSection =
    currentThreads.length > 0
      ? currentThreads
          .map((t) => `  - id: "${t.id}", label: "${t.label}", status: "${t.status}"`)
          .join("\n")
      : "  (none yet)";

  const npcsSection =
    npcs.length > 0
      ? npcs.map((n) => `  - id: "${n.id}", name: "${n.name}"`).join("\n")
      : "  (none)";

  const allNpcNames = [...new Set([...knownNpcNames, ...npcs.map((n) => n.name)])];

  const prompt = `Analyse this RPG turn. Reply with ONLY a JSON object — no prose, no fences.

Threads: ${threadsSection}
Scene NPCs: ${npcsSection}
Known NPCs: ${allNpcNames.join(", ") || "(none)"}
Player: ${playerAction}
Narration: ${narration}

Output JSON with these keys:
story: {threadUpdates:[{id,status:(open|escalating|resolved|abandoned),notes}] — ONLY threads this narration actually moved forward; leave untouched threads out (no "still unresolved" entries), newThreads:[{label,kind:(mystery|threat|promise|goal),weight:1-5}] max 2 — only if genuinely NEW plot elements emerged (not restatements). label = concise 3-6 word hook. weight: 1=flavor, 3=significant, 5=campaign-defining. tensionRead:0-100}
npc: {updates:[{name, goal, agenda, agendaThreadId?, disposition_delta:-10..10, speech_pattern?, vocabulary?, new_state, interacted_with?:[string]}]} — only NPCs that spoke/acted. speech_pattern = HOW they talk (accent, rhythm, verbal tics, formality — e.g. "clipped, drops slang", "formal and distant, long sentences"). vocabulary = specific words/phrases they use repeatedly. ALWAYS fill speech_pattern if the NPC spoke dialogue. interacted_with = names of other NPCs they directly addressed or reacted to.
world: {newSeeds:[{trigger,echo,threadId?}]} max 2. echo = a dramatic future consequence, not a generic statement.
memories: [{npc,about,content,valence:-100..100,salience:0..100,threadId?}] max 3. content = written from the NPC's point of view as a specific memory ("I saw the player steal the merchant's purse", not "player stole something"). about = who/what the memory is about.
scene: {location, activeNPCs:[{name,desc,disposition}], situation, pendingThreats:[], timeOfDay:(morning|afternoon|evening|night), mood?:string} — mood = one-line atmosphere/feeling of the current scene

{"story":{"threadUpdates":[],"newThreads":[],"tensionRead":0},"npc":{"updates":[]},"world":{"newSeeds":[]},"memories":[],"scene":{"location":"","activeNPCs":[],"situation":"","pendingThreats":[],"timeOfDay":""}}`;

  const extractOptions: LLMOptions = { temperature: 0.1, maxTokens: 768 };

  try {
    const response = await callLLM(
      llmConfig,
      [{ role: "user", content: prompt }],
      async () => {},
      extractOptions,
      { priority: "background", retries: 1, retryDelayMs: 1500 }
    );
    return parseNarrativeState(response);
  } catch (err) {
    console.warn("[narrativeExtractor] LLM call failed:", err instanceof Error ? err.message : err);
    return SAFE_DEFAULT;
  }
}
