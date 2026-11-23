# NPC Episodic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NPCs episodic memory — a queryable substrate of remembered events from which callbacks, evolving relationships, reputation that spreads, and resurfacing consequences all emerge.

**Architecture:** A new `memories` SQLite table keyed by NPC, written by a `memories` key added to the existing `extractNarrativeState` call (no new LLM call), aged by the existing `storyState.turn` clock via lazy decay (computed at read), retrieved by a heuristic scorer behind a swappable `RelevanceRanker` interface, injected into the narrator prompt per-NPC, periodically consolidated ("sleep") and gossiped between co-present NPCs, with hot unresolved memories feeding the existing consequence-seed flow.

**Tech Stack:** TypeScript (strict), Drizzle ORM + better-sqlite3, Next.js/tRPC backend, Ollama (local LLM), Vitest. Pure logic is split from DB I/O so the scoring/decay/dedupe/gossip/seed logic is unit-tested without a database, matching the repo's `tests/convex/` convention.

**Spec:** `docs/superpowers/specs/2026-06-03-npc-episodic-memory-design.md`

---

## Conventions for this plan

- Run a single test file: `npx vitest run tests/convex/<file>.test.ts`
- Run everything: `npm test`
- Path alias `@/*` maps to repo root; existing pipeline tests import via relative paths (`../../server/pipeline/...`) — follow that.
- Tests live in `tests/convex/` (misnamed — it tests `server/pipeline`, not Convex; see CLAUDE.md).
- Each pure module exports its testable core; DB-touching wrappers are thin and verified by build + the existing suite + optional E2E, not unit tests.
- Commit after every task.

## File structure (locked decomposition)

| File | Responsibility |
|------|----------------|
| `server/db/schema.ts` (modify) | Add the `memories` table. |
| `types/index.ts` (modify) | Add `NPCMemoryEntry` mirror type + `RetrievedMemory`. |
| `server/pipeline/memory/score.ts` (create) | **Pure.** Turn-based decay, effective-salience scoring, `RelevanceRanker` interface + `KeywordRanker`, `tagOverlap`. |
| `server/pipeline/memory/dedupe.ts` (create) | **Pure.** Content similarity + reinforce-or-insert decision. |
| `server/pipeline/memory/prepare.ts` (create) | **Pure.** Turn extracted `memories[]` + scene NPCs into insert-ready rows (holder name→npcId resolution, drop unresolved). |
| `server/pipeline/memory/seeds.ts` (create) | **Pure.** Derive at most one candidate `WorldSeed` from hot unresolved memories. |
| `server/pipeline/memory/consolidate.ts` (create) | **Pure** `selectForConsolidation` + thin DB runner `runConsolidation`. |
| `server/pipeline/memory/gossip.ts` (create) | **Pure** `planGossip` + thin DB runner `runGossip`. |
| `server/pipeline/memory/store.ts` (create) | DB I/O: `formMemories` (insert/reinforce), `retrieveMemories` (read + score). |
| `server/pipeline/narrativeExtractor.ts` (modify) | Add `memories` to the prompt + defensive parser. |
| `server/pipeline/promptBuilder.ts` (modify) | `REMEMBERS:` sub-block inside `[NPCS IN SCENE]`. |
| `server/pipeline/orchestrator.ts` (modify) | Retrieval before narrator; formation + consolidation + gossip + seed-feed inside step 3d. |
| `server/routers/memories.ts` (create, optional) | Read-only `listByNpc` for a future debug view. |

---

## Task 1: `memories` table + types + migration

**Files:**
- Modify: `server/db/schema.ts` (after the `sceneImages` table, ~line 174)
- Modify: `types/index.ts`

- [ ] **Step 1: Add the table to `schema.ts`**

```ts
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  npcId: text("npc_id").notNull().references(() => npcMemory.id, { onDelete: "cascade" }),
  about: text("about").notNull(),
  kind: text("kind", { enum: ["episodic", "semantic"] }).notNull().default("episodic"),
  content: text("content").notNull(),
  valence: integer("valence").notNull(),
  salienceBase: integer("salience_base").notNull(),
  source: text("source", { enum: ["witnessed", "heard", "rumor"] }).notNull().default("witnessed"),
  confidence: integer("confidence").notNull().default(100),
  threadId: text("thread_id"),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  introducedTurn: integer("introduced_turn").notNull(),
  lastReinforcedTurn: integer("last_reinforced_turn").notNull(),
  status: text("status", { enum: ["active", "consolidated", "forgotten"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_memories_npc_status").on(table.npcId, table.status),
  index("idx_memories_campaign").on(table.campaignId),
  index("idx_memories_thread").on(table.threadId),
]);
```

- [ ] **Step 2: Add mirror types to `types/index.ts`**

```ts
export type MemoryKind = "episodic" | "semantic";
export type MemorySource = "witnessed" | "heard" | "rumor";
export type MemoryStatus = "active" | "consolidated" | "forgotten";

export interface NPCMemoryEntry {
  id: string;
  campaignId: string;
  npcId: string;
  about: string;
  kind: MemoryKind;
  content: string;
  valence: number;          // -100..100
  salienceBase: number;     // 0..100
  source: MemorySource;
  confidence: number;       // 0..100
  threadId: string | null;
  sessionId: string | null;
  messageId: string | null;
  introducedTurn: number;
  lastReinforcedTurn: number;
  status: MemoryStatus;
  createdAt: number;
}

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
```

- [ ] **Step 3: Generate and apply the migration**

Run: `npx drizzle-kit generate`
Expected: a new file under `drizzle/` (or the configured migrations dir) creating `memories`.
Run: `npx drizzle-kit push`
Expected: prompt confirms creating table `memories`; applies to `./data/rpg.db`.

- [ ] **Step 4: Verify the table exists**

Run: `node -e "const D=require('better-sqlite3');const db=new D('./data/rpg.db');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='memories'\").all())"`
Expected: `[ { name: 'memories' } ]`

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add server/db/schema.ts types/index.ts drizzle/
git commit -m "feat(memory): add memories table + types"
```

---

## Task 2: Pure scorer — `memory/score.ts`

**Files:**
- Create: `server/pipeline/memory/score.ts`
- Test: `tests/convex/memoryScore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  effectiveSalience,
  scoreMemory,
  KeywordRanker,
  tagOverlap,
} from "../../server/pipeline/memory/score";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m1", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player burned the warehouse", valence: -80, salienceBase: 90,
    source: "witnessed", confidence: 100, threadId: null, sessionId: null,
    messageId: null, introducedTurn: 5, lastReinforcedTurn: 5, status: "active",
    createdAt: 0, ...over,
  };
}

describe("effectiveSalience", () => {
  it("equals base at the reinforcement turn", () => {
    expect(effectiveSalience(mem({ salienceBase: 80, lastReinforcedTurn: 10 }), 10)).toBe(80);
  });
  it("decays monotonically as turns pass", () => {
    const m = mem({ salienceBase: 80, lastReinforcedTurn: 0 });
    const s1 = effectiveSalience(m, 5);
    const s2 = effectiveSalience(m, 20);
    expect(s1).toBeLessThan(80);
    expect(s2).toBeLessThan(s1);
    expect(s2).toBeGreaterThanOrEqual(0);
  });
});

describe("tagOverlap", () => {
  it("is higher when scene words overlap the memory content", () => {
    const m = mem({ content: "the player burned the warehouse" });
    const hot = tagOverlap("you mention the burned warehouse", m);
    const cold = tagOverlap("a quiet morning by the river", m);
    expect(hot).toBeGreaterThan(cold);
  });
});

describe("scoreMemory", () => {
  it("ranks a hot, recent, scene-relevant memory above a faint, stale, irrelevant one", () => {
    const ranker = new KeywordRanker();
    const hot = scoreMemory(mem({ valence: -80, salienceBase: 90, lastReinforcedTurn: 19,
      content: "player burned the warehouse" }), 20, "the warehouse still smells of smoke", ranker);
    const faint = scoreMemory(mem({ valence: 5, salienceBase: 20, lastReinforcedTurn: 0,
      content: "player asked the time" }), 20, "the warehouse still smells of smoke", ranker);
    expect(hot).toBeGreaterThan(faint);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memoryScore.test.ts`
Expected: FAIL — cannot find module `score`.

- [ ] **Step 3: Implement `score.ts`**

```ts
import type { NPCMemoryEntry } from "@/types/index";

/** Tunable scorer weights. Start here; tune against the play-loop. */
export const SCORE_WEIGHTS = { valence: 0.4, recency: 0.3, overlap: 0.25, source: 0.05 };
/** Turns over which salience halves (turn-based, mirrors the director clock). */
export const DECAY_HALF_LIFE_TURNS = 15;

/** Effective salience: base, halved every DECAY_HALF_LIFE_TURNS of staleness. Never negative. */
export function effectiveSalience(m: NPCMemoryEntry, currentTurn: number): number {
  const age = Math.max(0, currentTurn - m.lastReinforcedTurn);
  const decayed = m.salienceBase * Math.pow(0.5, age / DECAY_HALF_LIFE_TURNS);
  return Math.max(0, decayed);
}

/** Pluggable relevance scorer (the only piece an embedding ranker would replace). */
export interface RelevanceRanker {
  score(sceneText: string, memory: NPCMemoryEntry): number; // 0..1
}

const STOP = new Set(["the","a","an","of","to","and","in","on","at","is","it","you","your","player","with","for"]);
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

/** Jaccard-ish overlap of significant words between the scene and the memory content. 0..1. */
export function tagOverlap(sceneText: string, memory: NPCMemoryEntry): number {
  const a = tokens(sceneText);
  const b = tokens(memory.content);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of b) if (a.has(w)) inter++;
  return inter / Math.min(a.size, b.size);
}

export class KeywordRanker implements RelevanceRanker {
  score(sceneText: string, memory: NPCMemoryEntry): number {
    return tagOverlap(sceneText, memory);
  }
}

function sourceWeight(m: NPCMemoryEntry): number {
  const base = m.source === "witnessed" ? 1 : m.source === "heard" ? 0.7 : 0.5;
  return base * (m.confidence / 100);
}

/** Composite retrieval score for ranking a memory in the current scene. */
export function scoreMemory(
  m: NPCMemoryEntry,
  currentTurn: number,
  sceneText: string,
  ranker: RelevanceRanker
): number {
  const w = SCORE_WEIGHTS;
  const salience = effectiveSalience(m, currentTurn) / 100;     // 0..1
  const valence = Math.abs(m.valence) / 100;                    // 0..1
  const overlap = ranker.score(sceneText, m);                   // 0..1
  return w.valence * valence + w.recency * salience + w.overlap * overlap + w.source * sourceWeight(m);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memoryScore.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/score.ts tests/convex/memoryScore.test.ts
git commit -m "feat(memory): pure turn-based scorer + keyword ranker"
```

---

## Task 3: Pure dedupe — `memory/dedupe.ts`

**Files:**
- Create: `server/pipeline/memory/dedupe.ts`
- Test: `tests/convex/memoryDedupe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { similarity, findReinforceTarget } from "../../server/pipeline/memory/dedupe";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m1", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player spared my brother at the bridge", valence: 60, salienceBase: 70,
    source: "witnessed", confidence: 100, threadId: null, sessionId: null, messageId: null,
    introducedTurn: 1, lastReinforcedTurn: 1, status: "active", createdAt: 0, ...over,
  };
}

describe("similarity", () => {
  it("is high for near-identical content", () => {
    expect(similarity("player spared my brother at the bridge", "the player spared my brother on the bridge"))
      .toBeGreaterThan(0.6);
  });
  it("is low for unrelated content", () => {
    expect(similarity("player spared my brother", "player bought a horse in town")).toBeLessThan(0.4);
  });
});

describe("findReinforceTarget", () => {
  it("returns an existing memory with same 'about' and similar content", () => {
    const existing = [mem({ id: "old", about: "player", content: "player spared my brother at the bridge" })];
    const hit = findReinforceTarget(existing, { about: "player", content: "the player spared my brother on the bridge" });
    expect(hit?.id).toBe("old");
  });
  it("returns null when 'about' differs", () => {
    const existing = [mem({ id: "old", about: "Sera", content: "player spared my brother at the bridge" })];
    expect(findReinforceTarget(existing, { about: "player", content: "player spared my brother at the bridge" })).toBeNull();
  });
  it("returns null when content is dissimilar", () => {
    const existing = [mem({ id: "old", about: "player", content: "player bought a horse" })];
    expect(findReinforceTarget(existing, { about: "player", content: "player burned the warehouse" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memoryDedupe.test.ts`
Expected: FAIL — cannot find module `dedupe`.

- [ ] **Step 3: Implement `dedupe.ts`**

```ts
import type { NPCMemoryEntry } from "@/types/index";

const STOP = new Set(["the","a","an","of","to","and","in","on","at","is","it","you","your","player","my","with"]);
function toks(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** Symmetric token-set overlap (Jaccard). 0..1. */
export function similarity(a: string, b: string): number {
  const ta = toks(a), tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export const REINFORCE_SIMILARITY_THRESHOLD = 0.5;

/**
 * Find an existing active memory the candidate should REINFORCE rather than duplicate:
 * same subject (`about`, case-insensitive) and content similarity over threshold.
 */
export function findReinforceTarget(
  existing: NPCMemoryEntry[],
  candidate: { about: string; content: string }
): NPCMemoryEntry | null {
  const aboutKey = candidate.about.trim().toLowerCase();
  let best: NPCMemoryEntry | null = null;
  let bestSim = REINFORCE_SIMILARITY_THRESHOLD;
  for (const m of existing) {
    if (m.status !== "active") continue;
    if (m.about.trim().toLowerCase() !== aboutKey) continue;
    const sim = similarity(m.content, candidate.content);
    if (sim >= bestSim) { best = m; bestSim = sim; }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memoryDedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/dedupe.ts tests/convex/memoryDedupe.test.ts
git commit -m "feat(memory): pure content similarity + reinforce decision"
```

---

## Task 4: Extractor `memories` key — `narrativeExtractor.ts`

**Files:**
- Modify: `server/pipeline/narrativeExtractor.ts`
- Test: `tests/convex/narrativeExtractorMemories.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseNarrativeState } from "../../server/pipeline/narrativeExtractor";

describe("parseNarrativeState — memories key", () => {
  it("parses well-formed memories", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 30 },
      npc: { updates: [] },
      world: { newSeeds: [] },
      memories: [
        { npc: "Sera", about: "player", content: "the player spared my brother", valence: 60, salience: 80, threadId: "t1" },
      ],
    });
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0]).toMatchObject({ npc: "Sera", about: "player", valence: 60, salience: 80, threadId: "t1" });
  });

  it("defaults memories to [] when key is missing", () => {
    const raw = JSON.stringify({ story: { threadUpdates: [], newThreads: [], tensionRead: 30 }, npc: { updates: [] }, world: { newSeeds: [] } });
    expect(parseNarrativeState(raw).memories).toEqual([]);
  });

  it("drops memories missing npc/content and clamps numbers", () => {
    const raw = JSON.stringify({
      story: { threadUpdates: [], newThreads: [], tensionRead: 30 }, npc: { updates: [] }, world: { newSeeds: [] },
      memories: [
        { about: "player", content: "no holder" },                              // drop: no npc
        { npc: "Sera", content: "no about" },                                    // drop: no about
        { npc: "Sera", about: "player", content: "" },                           // drop: empty content
        { npc: "Sera", about: "player", content: "valid", valence: 999, salience: -5 }, // clamp
      ],
    });
    const r = parseNarrativeState(raw);
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0].valence).toBe(100);
    expect(r.memories[0].salience).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(parseNarrativeState("not json").memories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/narrativeExtractorMemories.test.ts`
Expected: FAIL — `r.memories` is undefined.

- [ ] **Step 3: Extend the types, parser, and prompt**

In `narrativeExtractor.ts`:

Add an interface and extend the result type:
```ts
export interface ExtractedMemory {
  npc: string;       // holder (exact in-scene NPC name)
  about: string;     // subject: "player" | NPC name | place/thing
  content: string;   // episodic line, NPC POV
  valence: number;   // -100..100
  salience: number;  // 0..100
  threadId?: string;
}

export interface NarrativeStateResult {
  story: StoryExtract;
  npc: NpcExtract;
  world: WorldExtract;
  memories: ExtractedMemory[];   // <-- add
}
```

Update `safeDefault` and the final `return` (and the `catch` fallback in `extractNarrativeState`) to include `memories: []`.

Add defensive parsing before the final `return` in `parseNarrativeState`:
```ts
const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;

const rawMemories: unknown[] = Array.isArray((parsed as any)?.memories) ? (parsed as any).memories : [];
const memories: ExtractedMemory[] = rawMemories
  .filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" &&
    typeof (item as any).npc === "string" && (item as any).npc.trim() !== "" &&
    typeof (item as any).about === "string" && (item as any).about.trim() !== "" &&
    typeof (item as any).content === "string" && (item as any).content.trim() !== "")
  .map((item) => ({
    npc: (item.npc as string).trim(),
    about: (item.about as string).trim(),
    content: (item.content as string).trim(),
    valence: clamp(item.valence, -100, 100, 0),
    salience: clamp(item.salience, 0, 100, 50),
    ...(typeof item.threadId === "string" && item.threadId ? { threadId: item.threadId } : {}),
  }));
```
Include `memories` in the returned object.

In the prompt string, add to the instructions and the JSON shape:
```
For memories: record AT MOST 3 events worth remembering that an in-scene NPC just experienced. Each needs:
  - "npc": the EXACT name (from the NPC list above) of the NPC who remembers this
  - "about": who/what it concerns ("player", an NPC name, or a place/thing)
  - "content": one sentence in that NPC's voice describing what happened
  - "valence": integer -100..100 (how good/bad it felt to them)
  - "salience": integer 0..100 (how strongly they'd hold onto it)
  - "threadId": the related thread id from the list above (omit if none)
```
And append `,"memories":[{"npc":"<exact-name>","about":"player","content":"<one sentence>","valence":<-100..100>,"salience":<0..100>,"threadId":"<id-or-omit>"}]` to the required-shape JSON.

Bump `maxTokens` from 400 to 512 in the `callOllama` call (the added array needs headroom — see spec §15).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/narrativeExtractorMemories.test.ts`
Expected: PASS. Also run the existing extractor tests if any to confirm no regression: `npm test`.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/narrativeExtractor.ts tests/convex/narrativeExtractorMemories.test.ts
git commit -m "feat(memory): extractor emits memories key (no new LLM call)"
```

---

## Task 5: Pure row preparation — `memory/prepare.ts`

**Files:**
- Create: `server/pipeline/memory/prepare.ts`
- Test: `tests/convex/memoryPrepare.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { prepareMemoryRows } from "../../server/pipeline/memory/prepare";

const sceneNpcs = [{ id: "npc-sera", name: "Sera Vane" }, { id: "npc-dax", name: "Dax Korr" }];
const ctx = { campaignId: "camp1", sessionId: "sess1", messageId: "msg1", turn: 7 };

describe("prepareMemoryRows", () => {
  it("resolves holder name to npcId (case-insensitive) and fills defaults", () => {
    const rows = prepareMemoryRows(
      [{ npc: "sera vane", about: "player", content: "spared my brother", valence: 60, salience: 80, threadId: "t1" }],
      sceneNpcs, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      npcId: "npc-sera", campaignId: "camp1", about: "player", content: "spared my brother",
      valence: 60, salienceBase: 80, source: "witnessed", confidence: 100, threadId: "t1",
      sessionId: "sess1", messageId: "msg1", introducedTurn: 7, lastReinforcedTurn: 7,
      kind: "episodic", status: "active",
    });
  });

  it("drops a memory whose holder is not in the scene", () => {
    const rows = prepareMemoryRows(
      [{ npc: "Unknown Stranger", about: "player", content: "x", valence: 0, salience: 50 }],
      sceneNpcs, ctx);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memoryPrepare.test.ts`
Expected: FAIL — cannot find module `prepare`.

- [ ] **Step 3: Implement `prepare.ts`**

```ts
import type { ExtractedMemory } from "@/server/pipeline/narrativeExtractor";

export interface SceneNpcRef { id: string; name: string; }
export interface FormationCtx { campaignId: string; sessionId: string; messageId: string; turn: number; }

/** Insert-ready memory row (no id/createdAt — DB defaults those). */
export interface NewMemoryRow {
  campaignId: string; npcId: string; about: string; kind: "episodic";
  content: string; valence: number; salienceBase: number; source: "witnessed";
  confidence: number; threadId: string | null; sessionId: string; messageId: string;
  introducedTurn: number; lastReinforcedTurn: number; status: "active";
}

/** Turn extracted memories + the scene NPC list into insert-ready rows. Drops unresolved holders. Pure. */
export function prepareMemoryRows(
  extracted: ExtractedMemory[],
  sceneNpcs: SceneNpcRef[],
  ctx: FormationCtx
): NewMemoryRow[] {
  const byName = new Map(sceneNpcs.map((n) => [n.name.trim().toLowerCase(), n.id]));
  const rows: NewMemoryRow[] = [];
  for (const m of extracted) {
    const npcId = byName.get(m.npc.trim().toLowerCase());
    if (!npcId) continue;
    rows.push({
      campaignId: ctx.campaignId, npcId, about: m.about, kind: "episodic",
      content: m.content, valence: m.valence, salienceBase: m.salience, source: "witnessed",
      confidence: 100, threadId: m.threadId ?? null, sessionId: ctx.sessionId, messageId: ctx.messageId,
      introducedTurn: ctx.turn, lastReinforcedTurn: ctx.turn, status: "active",
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memoryPrepare.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/prepare.ts tests/convex/memoryPrepare.test.ts
git commit -m "feat(memory): pure holder-resolution row prep"
```

---

## Task 6: Pure seed derivation — `memory/seeds.ts`

**Files:**
- Create: `server/pipeline/memory/seeds.ts`
- Test: `tests/convex/memorySeeds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { memoriesToSeed } from "../../server/pipeline/memory/seeds";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m", campaignId: "c", npcId: "n", about: "player", kind: "episodic",
    content: "the player betrayed me", valence: -85, salienceBase: 90, source: "witnessed",
    confidence: 100, threadId: "t1", sessionId: null, messageId: null,
    introducedTurn: 2, lastReinforcedTurn: 2, status: "active", createdAt: 0, ...over,
  };
}

describe("memoriesToSeed", () => {
  it("derives one seed from a hot, negative, player memory tied to a thread", () => {
    const seed = memoriesToSeed([mem()], 4);
    expect(seed).not.toBeNull();
    expect(seed!.threadId).toBe("t1");
    expect(typeof seed!.trigger).toBe("string");
    expect(typeof seed!.echo).toBe("string");
  });
  it("returns null when no memory is hot enough", () => {
    expect(memoriesToSeed([mem({ salienceBase: 10, lastReinforcedTurn: 0 })], 60)).toBeNull();
  });
  it("ignores positive or non-player memories", () => {
    expect(memoriesToSeed([mem({ valence: 70 }), mem({ about: "Sera" })], 4)).toBeNull();
  });
  it("returns at most one seed (the hottest)", () => {
    const seed = memoriesToSeed([mem({ content: "a", valence: -60 }), mem({ content: "b", valence: -95 })], 4);
    expect(seed!.trigger).toContain("b");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memorySeeds.test.ts`
Expected: FAIL — cannot find module `seeds`.

- [ ] **Step 3: Implement `seeds.ts`**

```ts
import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";

export interface CandidateSeed { trigger: string; echo: string; threadId?: string; }

export const SEED_SALIENCE_FLOOR = 55;   // must still be "hot"
export const SEED_VALENCE_CEILING = -40; // must be meaningfully negative

/** Derive AT MOST one consequence seed from a hot, unresolved, negative player memory. Pure. */
export function memoriesToSeed(memories: NPCMemoryEntry[], currentTurn: number): CandidateSeed | null {
  const eligible = memories
    .filter((m) => m.status === "active" && m.about.trim().toLowerCase() === "player" && m.valence <= SEED_VALENCE_CEILING)
    .map((m) => ({ m, s: effectiveSalience(m, currentTurn) }))
    .filter((x) => x.s >= SEED_SALIENCE_FLOOR)
    .sort((a, b) => b.m.valence - a.m.valence === 0 ? b.s - a.s : a.m.valence - b.m.valence); // most negative first
  if (eligible.length === 0) return null;
  const top = eligible[0].m;
  return {
    trigger: top.content,
    echo: `someone acts on the memory: "${top.content}"`,
    ...(top.threadId ? { threadId: top.threadId } : {}),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memorySeeds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/seeds.ts tests/convex/memorySeeds.test.ts
git commit -m "feat(memory): pure hot-memory -> consequence seed derivation"
```

---

## Task 7: Consolidation — `memory/consolidate.ts`

**Files:**
- Create: `server/pipeline/memory/consolidate.ts`
- Test: `tests/convex/memoryConsolidate.test.ts`

- [ ] **Step 1: Write the failing test (pure selector only)**

```ts
import { describe, it, expect } from "vitest";
import { selectForConsolidation, CONSOLIDATION_THRESHOLD } from "../../server/pipeline/memory/consolidate";
import type { NPCMemoryEntry } from "../../types/index";

function mem(id: string, over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id, campaignId: "c", npcId: "n", about: "player", kind: "episodic", content: "c" + id,
    valence: 10, salienceBase: 50, source: "witnessed", confidence: 100, threadId: null,
    sessionId: null, messageId: null, introducedTurn: 0, lastReinforcedTurn: 0, status: "active",
    createdAt: 0, ...over,
  };
}

describe("selectForConsolidation", () => {
  it("returns empty when under threshold", () => {
    const few = Array.from({ length: 3 }, (_, i) => mem("m" + i));
    expect(selectForConsolidation(few, 10)).toEqual([]);
  });
  it("folds the faint tail once over threshold, keeps the salient head", () => {
    const many = Array.from({ length: CONSOLIDATION_THRESHOLD + 4 }, (_, i) =>
      mem("m" + i, { salienceBase: i < 4 ? 5 : 90, lastReinforcedTurn: i < 4 ? 0 : 10 }));
    const fold = selectForConsolidation(many, 10);
    expect(fold.length).toBeGreaterThan(0);
    expect(fold.every((m) => m.salienceBase <= 5)).toBe(true);   // only the faint ones
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memoryConsolidate.test.ts`
Expected: FAIL — cannot find module `consolidate`.

- [ ] **Step 3: Implement `consolidate.ts` (pure selector + thin DB runner)**

```ts
import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";

export const CONSOLIDATION_THRESHOLD = 12; // active episodics per NPC before sleep triggers
export const CONSOLIDATION_FLOOR = 20;     // effective salience below which an episodic is foldable

/** Given an NPC's active episodics, return the faint tail to fold (empty if under threshold). Pure. */
export function selectForConsolidation(active: NPCMemoryEntry[], currentTurn: number): NPCMemoryEntry[] {
  const episodics = active.filter((m) => m.kind === "episodic" && m.status === "active");
  if (episodics.length <= CONSOLIDATION_THRESHOLD) return [];
  return episodics.filter((m) => effectiveSalience(m, currentTurn) < CONSOLIDATION_FLOOR);
}

/**
 * Thin DB runner: for one NPC, fold faint episodics into a single semantic impression and
 * mark the raws "consolidated". Best-effort; never throws to the caller.
 * Summary is deterministic (no guaranteed LLM call) — see spec §8/§15.
 */
export async function runConsolidation(npcId: string, campaignId: string, currentTurn: number): Promise<void> {
  try {
    const rows = (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
    const fold = selectForConsolidation(rows, currentTurn);
    if (fold.length === 0) return;

    // Group the folded raws by subject and synthesize one semantic line per subject.
    const bySubject = new Map<string, NPCMemoryEntry[]>();
    for (const m of fold) {
      const key = m.about.trim().toLowerCase();
      (bySubject.get(key) ?? bySubject.set(key, []).get(key)!).push(m);
    }
    for (const [, group] of bySubject) {
      const avgValence = Math.round(group.reduce((s, m) => s + m.valence, 0) / group.length);
      const lean = avgValence > 15 ? "warmly" : avgValence < -15 ? "with distrust" : "with mixed feelings";
      await db.insert(memories).values({
        campaignId, npcId, about: group[0].about, kind: "semantic",
        content: `remembers ${group[0].about} ${lean} (${group.length} folded moments)`,
        valence: avgValence, salienceBase: 60, source: "witnessed", confidence: 100,
        threadId: null, sessionId: null, messageId: null,
        introducedTurn: currentTurn, lastReinforcedTurn: currentTurn, status: "active",
      });
    }
    for (const m of fold) {
      await db.update(memories).set({ status: "consolidated" }).where(eq(memories.id, m.id));
    }
  } catch (err) {
    console.warn("[memory.consolidate] failed:", err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memoryConsolidate.test.ts`
Expected: PASS. (The DB runner is verified later via build + orchestrator wiring; not unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/consolidate.ts tests/convex/memoryConsolidate.test.ts
git commit -m "feat(memory): threshold-gated consolidation (sleep)"
```

---

## Task 8: Gossip — `memory/gossip.ts`

**Files:**
- Create: `server/pipeline/memory/gossip.ts`
- Test: `tests/convex/memoryGossip.test.ts`

- [ ] **Step 1: Write the failing test (pure planner)**

```ts
import { describe, it, expect } from "vitest";
import { planGossip, GOSSIP_SALIENCE_FLOOR } from "../../server/pipeline/memory/gossip";
import type { NPCMemoryEntry } from "../../types/index";

function mem(over: Partial<NPCMemoryEntry> = {}): NPCMemoryEntry {
  return {
    id: "m", campaignId: "c", npcId: "holder", about: "player", kind: "episodic",
    content: "player burned the warehouse", valence: -80, salienceBase: 95, source: "witnessed",
    confidence: 100, threadId: null, sessionId: null, messageId: null,
    introducedTurn: 1, lastReinforcedTurn: 1, status: "active", createdAt: 0, ...over,
  };
}

describe("planGossip", () => {
  it("copies a hot player memory to a recipient who lacks it, as 'heard' with lowered confidence", () => {
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a" })],
      recipientId: "b", recipientMemories: [], currentTurn: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ npcId: "b", about: "player", source: "heard", confidence: 60 });
    expect(out[0].salienceBase).toBeLessThan(95);
  });
  it("does not copy memories the recipient already holds", () => {
    const existing = mem({ npcId: "b", content: "player burned the warehouse" });
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a" })],
      recipientId: "b", recipientMemories: [existing], currentTurn: 1 });
    expect(out).toEqual([]);
  });
  it("skips faint memories and non-player subjects", () => {
    const out = planGossip({ holderId: "a",
      holderMemories: [mem({ npcId: "a", salienceBase: GOSSIP_SALIENCE_FLOOR - 10, lastReinforcedTurn: 0 }), mem({ npcId: "a", about: "Sera" })],
      recipientId: "b", recipientMemories: [], currentTurn: 30 });
    expect(out).toEqual([]);
  });
  it("downgrades to 'rumor' when the origin confidence is already low", () => {
    const out = planGossip({ holderId: "a", holderMemories: [mem({ npcId: "a", source: "heard", confidence: 50 })],
      recipientId: "b", recipientMemories: [], currentTurn: 1 });
    expect(out[0].source).toBe("rumor");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/memoryGossip.test.ts`
Expected: FAIL — cannot find module `gossip`.

- [ ] **Step 3: Implement `gossip.ts` (pure planner + thin DB runner)**

```ts
import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { NPCMemoryEntry } from "@/types/index";
import { effectiveSalience } from "./score";
import { similarity, REINFORCE_SIMILARITY_THRESHOLD } from "./dedupe";
import type { NewMemoryRow } from "./prepare";

export const GOSSIP_SALIENCE_FLOOR = 70;   // only strong memories travel
export const GOSSIP_CONFIDENCE_FACTOR = 0.6;
export const GOSSIP_MAX_PER_PAIR = 1;      // bound per pair per pass

export interface GossipRow extends Omit<NewMemoryRow, "source" | "sessionId" | "messageId"> {
  source: "heard" | "rumor"; sessionId: null; messageId: null;
}

/** Plan which of holder's hot player-memories should copy to recipient as hearsay. Pure. */
export function planGossip(args: {
  holderId: string; holderMemories: NPCMemoryEntry[];
  recipientId: string; recipientMemories: NPCMemoryEntry[];
  currentTurn: number;
}): GossipRow[] {
  const { holderMemories, recipientId, recipientMemories, currentTurn } = args;
  const out: GossipRow[] = [];
  const candidates = holderMemories
    .filter((m) => m.status === "active" && m.about.trim().toLowerCase() === "player")
    .filter((m) => effectiveSalience(m, currentTurn) >= GOSSIP_SALIENCE_FLOOR)
    .sort((a, b) => effectiveSalience(b, currentTurn) - effectiveSalience(a, currentTurn));

  for (const m of candidates) {
    if (out.length >= GOSSIP_MAX_PER_PAIR) break;
    const known = recipientMemories.some(
      (r) => r.about.trim().toLowerCase() === "player" && similarity(r.content, m.content) >= REINFORCE_SIMILARITY_THRESHOLD
    );
    if (known) continue;
    const source: "heard" | "rumor" = m.source === "witnessed" ? "heard" : "rumor";
    out.push({
      campaignId: m.campaignId, npcId: recipientId, about: m.about, kind: "episodic",
      content: m.content, valence: Math.round(m.valence * 0.85),
      salienceBase: Math.round(effectiveSalience(m, currentTurn) * 0.7),
      confidence: Math.round(m.confidence * GOSSIP_CONFIDENCE_FACTOR),
      threadId: m.threadId, sessionId: null, messageId: null,
      introducedTurn: currentTurn, lastReinforcedTurn: currentTurn, status: "active",
      source,
    });
  }
  return out;
}

/** Thin DB runner: gossip player-memories between co-present NPC ids. Best-effort; never throws. */
export async function runGossip(npcIds: string[], currentTurn: number): Promise<void> {
  try {
    if (npcIds.length < 2) return;
    const all = (await db.select().from(memories)) as unknown as NPCMemoryEntry[];
    const byNpc = new Map<string, NPCMemoryEntry[]>();
    for (const id of npcIds) byNpc.set(id, all.filter((m) => m.npcId === id));
    const inserts: GossipRow[] = [];
    for (const holderId of npcIds) {
      for (const recipientId of npcIds) {
        if (holderId === recipientId) continue;
        inserts.push(...planGossip({
          holderId, holderMemories: byNpc.get(holderId) ?? [],
          recipientId, recipientMemories: byNpc.get(recipientId) ?? [], currentTurn,
        }));
      }
    }
    for (const row of inserts) await db.insert(memories).values(row);
  } catch (err) {
    console.warn("[memory.gossip] failed:", err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/memoryGossip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/memory/gossip.ts tests/convex/memoryGossip.test.ts
git commit -m "feat(memory): pure gossip planner + co-presence runner"
```

---

## Task 9: Store — `memory/store.ts` (formation + retrieval DB I/O)

**Files:**
- Create: `server/pipeline/memory/store.ts`

No new unit test (DB I/O; pure pieces already covered by Tasks 2/3/5). Verified by typecheck + Task 10 wiring + optional E2E.

- [ ] **Step 1: Implement `store.ts`**

```ts
import { db } from "@/server/db";
import { memories } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { NPCMemoryEntry, RetrievedMemory } from "@/types/index";
import type { ExtractedMemory } from "@/server/pipeline/narrativeExtractor";
import { prepareMemoryRows, type SceneNpcRef, type FormationCtx } from "./prepare";
import { findReinforceTarget } from "./dedupe";
import { scoreMemory, effectiveSalience, KeywordRanker, type RelevanceRanker } from "./score";

const ranker: RelevanceRanker = new KeywordRanker(); // swap to an EmbeddingRanker later — no caller change

/** Form memories from this turn's extract: reinforce near-duplicates, insert the rest. Best-effort. */
export async function formMemories(extracted: ExtractedMemory[], sceneNpcs: SceneNpcRef[], ctx: FormationCtx): Promise<void> {
  try {
    const rows = prepareMemoryRows(extracted, sceneNpcs, ctx);
    if (rows.length === 0) return;
    // Pre-load existing active memories per holder once.
    const holderIds = [...new Set(rows.map((r) => r.npcId))];
    const existingByNpc = new Map<string, NPCMemoryEntry[]>();
    for (const id of holderIds) {
      existingByNpc.set(id, (await db.select().from(memories)
        .where(and(eq(memories.npcId, id), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[]);
    }
    for (const row of rows) {
      const target = findReinforceTarget(existingByNpc.get(row.npcId) ?? [], { about: row.about, content: row.content });
      if (target) {
        await db.update(memories)
          .set({ salienceBase: Math.min(100, target.salienceBase + 15), lastReinforcedTurn: ctx.turn })
          .where(eq(memories.id, target.id));
      } else {
        await db.insert(memories).values(row);
      }
    }
  } catch (err) {
    console.warn("[memory.form] failed:", err instanceof Error ? err.message : err);
  }
}

/** Retrieve top-k memories for an NPC in the current scene. Semantic impressions are always considered. */
export async function retrieveMemories(args: {
  npcId: string; currentTurn: number; sceneText: string; k?: number;
}): Promise<RetrievedMemory[]> {
  const { npcId, currentTurn, sceneText, k = 3 } = args;
  try {
    const rows = (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
    return rows
      .map((m) => ({ m, score: scoreMemory(m, currentTurn, sceneText, ranker) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ m }) => ({
        id: m.id, about: m.about, kind: m.kind, content: m.content, valence: m.valence,
        source: m.source, confidence: m.confidence, effectiveSalience: effectiveSalience(m, currentTurn),
      }));
  } catch (err) {
    console.warn("[memory.retrieve] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Load an NPC's active memories (used by seed-derivation and consolidation in the orchestrator). */
export async function loadActiveMemories(npcId: string): Promise<NPCMemoryEntry[]> {
  try {
    return (await db.select().from(memories)
      .where(and(eq(memories.npcId, npcId), eq(memories.status, "active")))) as unknown as NPCMemoryEntry[];
  } catch { return []; }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/pipeline/memory/store.ts
git commit -m "feat(memory): formation + retrieval DB layer"
```

---

## Task 10: Prompt injection — `promptBuilder.ts`

**Files:**
- Modify: `server/pipeline/promptBuilder.ts` (the `[NPCS IN SCENE]` block, ~lines 103–117; and the `npcs` field type, ~line 23)
- Test: `tests/convex/promptBuilderMemories.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildNarratorPrompt } from "../../server/pipeline/promptBuilder";

const base = {
  campaign: { genre: "fantasy", tone: "dark", difficulty: "normal", worldDescription: "w", plotHooks: [] },
  characters: [{ name: "Kael", role: "warrior", stats: {}, inventory: [] }],
  director: { phase: "rising", tension: 30, intent: "develop", wordBudget: "100-200 words",
    spotlight: undefined, gmInitiative: "", actingNpc: undefined, consequenceEcho: undefined } as any,
  sceneSummary: "s", contextSummary: undefined, sceneState: null,
};

describe("buildNarratorPrompt — REMEMBERS block", () => {
  it("renders retrieved memories under the NPC", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [{
        id: "n1", name: "Sera", personality: "guarded", relationships: [], speechPattern: null, vocabulary: null,
        memories: [{ id: "m", about: "player", kind: "episodic", content: "the player spared my brother",
          valence: 60, source: "witnessed", confidence: 100, effectiveSalience: 70 }],
      }] as any,
    }, "I greet Sera");
    expect(prompt).toContain("REMEMBERS");
    expect(prompt).toContain("spared my brother");
  });

  it("hedges heard/rumor memories", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [{
        id: "n1", name: "Dax", personality: "gruff", relationships: [], speechPattern: null, vocabulary: null,
        memories: [{ id: "m", about: "player", kind: "episodic", content: "the player torched the docks",
          valence: -50, source: "heard", confidence: 60, effectiveSalience: 50 }],
      }] as any,
    }, "hi");
    expect(prompt).toMatch(/heard|believes/i);
  });

  it("omits the block when an NPC has no memories", () => {
    const prompt = buildNarratorPrompt({
      ...base,
      npcs: [{ id: "n1", name: "Sera", personality: "guarded", relationships: [], speechPattern: null, vocabulary: null }] as any,
    }, "hi");
    expect(prompt).not.toContain("REMEMBERS");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convex/promptBuilderMemories.test.ts`
Expected: FAIL — no "REMEMBERS" in output.

- [ ] **Step 3: Modify `promptBuilder.ts`**

Extend the `npcs` field type in the `buildNarratorPrompt` context (the `NPCMemoryDoc[]` entry near line 23) to allow an optional `memories?: RetrievedMemory[]` (import `RetrievedMemory` from `@/types`).

Inside the per-NPC loop (after the VOICE lines, before `prompt += line + "\n"`), append:
```ts
const mems = (npc as any).memories as import("@/types").RetrievedMemory[] | undefined;
if (mems && mems.length > 0) {
  line += `\n  REMEMBERS:`;
  for (const mm of mems) {
    const hedge = mm.source === "witnessed" ? "" : mm.source === "heard" ? " (heard secondhand)" : " (rumor, unverified)";
    const verb = mm.source === "witnessed" ? "" : "believes: ";
    line += `\n    - ${verb}${mm.content.slice(0, 140)}${hedge}`;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convex/promptBuilderMemories.test.ts`
Expected: PASS. Then `npm test` to confirm no regression in existing promptBuilder usage.

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/promptBuilder.ts tests/convex/promptBuilderMemories.test.ts
git commit -m "feat(memory): REMEMBERS sub-block in narrator prompt"
```

---

## Task 11: Orchestrator wiring — `orchestrator.ts`

**Files:**
- Modify: `server/pipeline/orchestrator.ts`

No unit test (integration glue). Verified by `npm test` (no regression), `npx tsc --noEmit`, build, and the optional E2E in Task 13. Every memory call is wrapped/guarded so the turn never breaks (matches the existing fire-and-forget convention; logs on error per CLAUDE.md).

- [ ] **Step 1: Import the memory layer**

At the top of `orchestrator.ts`:
```ts
import { formMemories, retrieveMemories, loadActiveMemories } from "./memory/store";
import { runConsolidation } from "./memory/consolidate";
import { runGossip } from "./memory/gossip";
import { memoriesToSeed } from "./memory/seeds";
```

- [ ] **Step 2: Retrieval before the narrator prompt (standard path only)**

After `const relevantNPCs = selectRelevantNPCs(...)` (line ~206) and before `buildNarratorPrompt` (line ~236), attach memories to each relevant NPC. Build the scene text from the player message + recent assistant lines:
```ts
const memSceneText = [message, ...lastAssistantMessages].join(" ");
const npcsWithMemories = await Promise.all(
  relevantNPCs.map(async (n) => ({
    ...n,
    memories: await retrieveMemories({ npcId: n.id, currentTurn: storyState.turn, sceneText: memSceneText, k: 3 }),
  }))
);
```
Pass `npcs: npcsWithMemories` to `buildNarratorPrompt` instead of `relevantNPCs`. (Leave `relevantNPCs` as-is for the other consumers — director agendas, image context.)

- [ ] **Step 3: Formation + seed-feed + consolidation + gossip inside step 3d**

Inside the `extractNarrativeState(...).then(async (ex) => { ... })` block (line ~591), after `merged` is computed and the NPC agenda updates are applied, but **before** the consequence-seed block builds `ex.world.newSeeds`:

```ts
// Form this turn's memories (holder name -> npcId resolved against the scene NPCs).
await formMemories(
  ex.memories,
  relevantNPCs.map((n) => ({ id: n.id, name: n.name })),
  { campaignId: session.campaignId, sessionId, messageId: assistantMessageId, turn: nextTurn }
);
```

Then, where new seeds are appended (line ~634, the `for (const seed of ex.world.newSeeds)` loop), first fold in a memory-derived candidate so it flows through the SAME merge + 8-seed cap:
```ts
// Memory-derived candidate seed (hot, unresolved, negative player memory) — at most one.
const sceneNpcIds = relevantNPCs.map((n) => n.id);
const hotMemories = (await Promise.all(sceneNpcIds.map((id) => loadActiveMemories(id)))).flat();
const memSeed = memoriesToSeed(hotMemories, nextTurn);
if (memSeed) {
  newSeeds.push({ trigger: memSeed.trigger, echo: memSeed.echo, threadId: memSeed.threadId,
    messagesUntilEcho: Math.floor(Math.random() * 6) + 5 });
}
```
(Keep this above the existing `newSeeds = newSeeds.slice(-8)` cap.)

After the storyState/consequence write at the end of the `.then` (line ~689), trigger sleep + gossip for the scene NPCs (best-effort, awaited so they complete within the fire-and-forget promise the image step already waits on):
```ts
for (const id of relevantNPCs.map((n) => n.id)) {
  await runConsolidation(id, session.campaignId, nextTurn);
}
await runGossip(relevantNPCs.map((n) => n.id), nextTurn);
```
**Intentional v1 narrowing:** spec §9 names co-presence as `relevantNPCs` *plus* `sceneState.activeNPCs` (resolved by name). v1 uses only `relevantNPCs` — they are the co-present set the turn already resolved to ids, and `sceneState` here is the prior turn's value updated asynchronously by step 3a. Folding in `sceneState.activeNPCs` name→id resolution is a clean follow-up; do not treat its absence as a missed requirement.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: all tests pass (no regression).

- [ ] **Step 5: Commit**

```bash
git add server/pipeline/orchestrator.ts
git commit -m "feat(memory): wire retrieval/formation/sleep/gossip/seed-feed into the tick"
```

---

## Task 12 (optional): Read-only router — `server/routers/memories.ts`

**Files:**
- Create: `server/routers/memories.ts`
- Modify: `server/root.ts`

- [ ] **Step 1: Implement a `listByNpc` query**

```ts
import { z } from "zod";
import { router, publicProcedure } from "../trpc"; // match the import style used by sibling routers
import { db } from "../db";
import { memories } from "../db/schema";
import { eq, desc } from "drizzle-orm";

export const memoriesRouter = router({
  listByNpc: publicProcedure
    .input(z.object({ npcId: z.string() }))
    .query(async ({ input }) =>
      db.select().from(memories).where(eq(memories.npcId, input.npcId)).orderBy(desc(memories.lastReinforcedTurn))),
});
```
(Confirm the exact `router`/`publicProcedure` import path against an existing router, e.g. `server/routers/npcMemory.ts`.)

- [ ] **Step 2: Register in `server/root.ts`**

Add `import { memoriesRouter } from "./routers/memories";` and `memories: memoriesRouter,` to the `appRouter` composition.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add server/routers/memories.ts server/root.ts
git commit -m "feat(memory): read-only memories.listByNpc for debug view"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full test suite + lint + build**

Run: `npm test`
Expected: all pass, including the 7 new memory test files.
Run: `npm run lint`
Expected: no new errors.
Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 2 (optional): E2E recall proof**

Extend `scripts/agency.test.mts` (env-gated `PLAY_LOOP=1`) with an assertion: play a turn that should form a memory (e.g. an emotionally charged player choice involving a named NPC), play several more turns, then assert the narrator prompt for a later turn involving that NPC contains a `REMEMBERS` line referencing the earlier event. Run: `PLAY_LOOP=1 npx vitest run scripts/agency.test.mts` (services must be up: `bash scripts/start-services.sh`).

- [ ] **Step 3: Update docs**

Add a short note to `CLAUDE.md` (the pipeline section) and `ARCHITECTURE.md` describing the memory subsystem and that `extractNarrativeState` now also emits memories. Commit:
```bash
git add CLAUDE.md ARCHITECTURE.md
git commit -m "docs(memory): document the episodic memory subsystem"
```

---

## Notes for the implementer

- **Never let memory break a turn.** Every DB-touching memory function is wrapped in try/catch and logs (not silently swallows) on error — matching CLAUDE.md's guidance to add logging to the otherwise-silent background extractors.
- **Turn clock, not wall-clock.** All aging uses `storyState.turn` / `nextTurn`. Do not introduce `Date.now()`-based decay.
- **Don't add an LLM call.** Formation rides the existing `extractNarrativeState` call. Consolidation's summary is deterministic by default (spec §8); do not make it a guaranteed per-turn model call.
- **Don't write to the `npc_memory` row from memory code.** Memories are their own table; this avoids compounding the existing concurrent read-modify-write on `npc_memory` (orchestrator step 3c / 3d / acting-NPC stamp).
- **Trivial path stays untouched** — no retrieval, no formation. Lazy decay keeps memories correct with zero writes there.
- **Scope guard:** memory must NOT influence `selectRelevantNPCs` or director spotlight in this plan — that is v2 (spec §11).
