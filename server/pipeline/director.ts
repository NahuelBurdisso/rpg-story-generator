import type { ArcPhase, CampaignStoryState, CampaignStoryThread, ConsequenceSeedLite, DirectorDecision, DirectorIntent, NpcAgendaLite, SessionStoryState, StoryThread, ThreadKind, ThreadStatus } from "@/types";
import { similarity } from "./memory/dedupe";
import { DEFAULT_THREAD_KIND, normalizeThreadKind, normalizeThreadStatus, normalizeThreadWeight } from "./threadFields";

/** Token-overlap (Jaccard) at which a new thread label counts as an existing one. */
const THREAD_DUPLICATE_SIMILARITY = 0.5;

export const CONSTANTS = {
  MAX_SESSION_THREADS: 6,
  MAX_CAMPAIGN_THREADS: 8,
  PROMOTE_WEIGHT: 4,
  PROMOTE_TOUCHES: 3,
  STALE_LIMIT: 4,
  ESCALATE_LIMIT: 3,
  MAX_FORCED_PAYOFF_TURNS: 2,
  ABANDON_LIMIT: 10,
  GM_INITIATIVE_GAP: 2,
  // Turns without a payoff before the GM forces a complication, and the gap
  // between those forced complications.
  QUIET_LIMIT: 5,
  QUIET_INITIATIVE_GAP: 4,
  NPC_ACT_GAP: 2,
  MAX_NEW_THREADS_PER_TURN: 2,
  // The extractor rates almost every new detail 4-5; new threads start at most
  // here and earn more weight by being touched (see the auto-weight boost).
  NEW_THREAD_MAX_WEIGHT: 3,
  // Tension reads the strongest few threads, not all of them — otherwise a
  // handful of open threads pins it at 100 and the arc hits climax by turn ~7.
  TENSION_TOP_THREADS: 3,
  TENSION_MAX_DELTA: 12,
  PLAYER_BONUS: 6,
  NOTES_MAX: 160,
  MIN_TURNS_IN_PHASE: 3,
} as const;

export function coldStartState(): SessionStoryState {
  return {
    version: 1, phase: "setup", tension: 2, turnsInPhase: 0,
    beatsSincePayoff: 0, turn: 0, lastGmInitiativeTurn: -CONSTANTS.GM_INITIATIVE_GAP,
    threads: [],
  };
}

export function deriveTension(args: {
  prevTension: number; threads: StoryThread[]; tensionRead: number; isPayoff: boolean;
}): number {
  const { prevTension, threads, tensionRead, isPayoff } = args;
  const pressures = threads
    .filter((t) => t.status === "open" || t.status === "escalating")
    .map((t) => t.weight * (t.status === "escalating" ? 2 : 1))
    .sort((a, b) => b - a)
    .slice(0, CONSTANTS.TENSION_TOP_THREADS);
  const fromThreads = Math.min(100, 8 * pressures.reduce((sum, p) => sum + p, 0));
  const read = Math.max(0, Math.min(100, Number.isFinite(tensionRead) ? tensionRead : fromThreads));
  let target = Math.round(0.5 * fromThreads + 0.5 * read);
  if (isPayoff) target -= 15;
  target = Math.max(0, Math.min(100, target));
  const delta = Math.max(-CONSTANTS.TENSION_MAX_DELTA,
    Math.min(CONSTANTS.TENSION_MAX_DELTA, target - prevTension));
  return Math.max(0, Math.min(100, prevTension + delta));
}

export function advancePhase(arc: { phase: ArcPhase; tension: number; turnsInPhase: number }):
  { phase: ArcPhase; turnsInPhase: number } {
  const { phase, tension, turnsInPhase } = arc;
  const turns = turnsInPhase + 1;
  if (turns < CONSTANTS.MIN_TURNS_IN_PHASE) return { phase, turnsInPhase: turns };
  let next: ArcPhase = phase;
  switch (phase) {
    case "setup": if (tension >= 40) next = "rising"; break;
    case "rising": if (tension >= 75) next = "climax"; else if (tension <= 20) next = "falling"; break;
    case "climax": if (tension <= 20) next = "falling"; break;
    case "falling": if (tension <= 5) next = "resolution"; else if (tension >= 75) next = "rising"; break;
    case "resolution": if (tension >= 40) next = "setup"; break;
  }
  return { phase: next, turnsInPhase: next !== phase ? 0 : turns };
}

function wordBudgetFor(intent: DirectorIntent, phase: ArcPhase, turn?: number): string {
  // First turn gets generous budget to set the scene
  if (turn !== undefined && turn <= 1) return "200-350 words";
  if (intent === "payoff" && phase === "climax") return "200-400 words";
  if (intent === "payoff") return "180-350 words";
  if (phase === "climax") return "150-300 words";
  if (intent === "escalate") return "130-260 words";
  if (intent === "breathe") return "80-160 words";
  return "100-200 words";
}

export function runDirector(s: SessionStoryState, npcs: NpcAgendaLite[] = [], consequences: ConsequenceSeedLite[] = []): DirectorDecision {
  const active = s.threads.filter((t) => t.status === "open" || t.status === "escalating");

  // Spotlight: weight*(1+staleness) + player bonus; ties -> weight, then age.
  // Threads touched this turn get an additive PLAYER_BONUS so player-engaged threads win when otherwise close.
  let spotlight: StoryThread | undefined;
  let best = -Infinity;
  for (const t of active) {
    const staleness = s.turn - t.lastTouchedTurn;
    const bonus = t.lastTouchedTurn === s.turn ? CONSTANTS.PLAYER_BONUS : 0;
    const priority = t.weight * (1 + staleness) + bonus;
    if (priority > best ||
        (priority === best && spotlight &&
          (t.weight > spotlight.weight ||
           (t.weight === spotlight.weight && t.introducedTurn < spotlight.introducedTurn)))) {
      best = priority; spotlight = t;
    }
  }

  const staleness = spotlight ? s.turn - spotlight.lastTouchedTurn : 0;
  const maxStaleness = active.reduce((m, t) => Math.max(m, s.turn - t.lastTouchedTurn), 0);

  // Intent ladder — develop is the default.
  // Threats escalate faster; mysteries and promises can develop longer.
  const escalateThreshold = spotlight?.kind === "threat" ? CONSTANTS.STALE_LIMIT - 1
    : spotlight?.kind === "mystery" ? CONSTANTS.STALE_LIMIT + 1
    : CONSTANTS.STALE_LIMIT;

  let intent: DirectorIntent = "develop";
  if (spotlight && spotlight.status === "escalating" && staleness >= CONSTANTS.ESCALATE_LIMIT) intent = "payoff";
  else if (spotlight && s.phase === "climax" && spotlight.weight >= 4) intent = "payoff";
  else if (spotlight && staleness >= escalateThreshold && s.beatsSincePayoff >= 2) intent = "escalate";
  else if (active.length > 0 && s.beatsSincePayoff <= 1 && s.lastIntent !== "breathe") intent = "breathe";
  // Prevent two consecutive breathe beats — keep the story moving

  // Story-aware GM initiative with min-gap. Two triggers: a thread left alone
  // too long, or a long quiet stretch with no payoff — the extractor "touches"
  // every thread each turn, so staleness alone can keep the GM silent forever.
  let gmInitiative = "";
  const staleTrigger = maxStaleness >= CONSTANTS.STALE_LIMIT + 2 &&
    s.turn - s.lastGmInitiativeTurn >= CONSTANTS.GM_INITIATIVE_GAP;
  const quietTrigger = s.beatsSincePayoff >= CONSTANTS.QUIET_LIMIT &&
    s.turn - s.lastGmInitiativeTurn >= CONSTANTS.QUIET_INITIATIVE_GAP;
  if (staleTrigger || quietTrigger) {
    // Quiet stretch: something should go wrong, so prefer the heaviest threat.
    const threats = active.filter((t) => t.kind === "threat");
    const stalest = !staleTrigger && threats.length > 0
      ? threats.reduce((a, b) => (b.weight > a.weight ? b : a))
      : active.reduce((a, b) =>
          (s.turn - a.lastTouchedTurn) >= (s.turn - b.lastTouchedTurn) ? a : b, active[0]);
    if (stalest) {
      const complicationFlavors: Record<string, string[]> = {
        mystery: [
          `A new clue tied to "${stalest.label}" turns up — something the player wasn't looking for.`,
          `Someone who knows about "${stalest.label}" approaches, nervous and evasive.`,
          `Evidence tied to "${stalest.label}" turns up destroyed or tampered with.`,
        ],
        threat: [
          `The threat of "${stalest.label}" makes itself felt — something goes wrong NOW.`,
          `A messenger or sign warns that "${stalest.label}" is closer/worse than expected.`,
          `An ally is hit by "${stalest.label}" — the threat is no longer abstract.`,
        ],
        promise: [
          `An opportunity tied to "${stalest.label}" appears, but with a catch.`,
          `Someone offers help with "${stalest.label}" — but the price is steep.`,
          `Unexpected progress on "${stalest.label}" changes the situation.`,
        ],
        goal: [
          `An obstacle to "${stalest.label}" appears — something blocks the way.`,
          `New information about "${stalest.label}" changes what the player thought they knew.`,
          `A rival is also chasing "${stalest.label}" and got there first.`,
        ],
      };
      const flavors = complicationFlavors[stalest.kind] ?? complicationFlavors.goal;
      gmInitiative = flavors[s.turn % flavors.length];
    }
  }

  // NPC initiative: find the eligible NPC whose agenda targets the spotlight thread.
  // Eligible: agendaThreadId matches spotlight, has a non-empty agenda string, respects NPC_ACT_GAP.
  let actingNpc: DirectorDecision["actingNpc"] | undefined;
  if (spotlight) {
    const eligible = npcs.filter((n) =>
      n.agendaThreadId === spotlight!.id &&
      typeof n.agenda === "string" && n.agenda.trim() !== "" &&
      (n.lastActedTurn == null || s.turn - n.lastActedTurn >= CONSTANTS.NPC_ACT_GAP)
    );
    if (eligible.length > 0) {
      // Pick the one with the oldest lastActedTurn (null is treated as oldest)
      const chosen = eligible.reduce((a, b) => {
        const aTurn = a.lastActedTurn ?? -Infinity;
        const bTurn = b.lastActedTurn ?? -Infinity;
        return aTurn <= bTurn ? a : b;
      });
      actingNpc = {
        name: chosen.name,
        agenda: chosen.agenda as string,
        voice: chosen.speechPattern ?? undefined,
      };
    }
  }

  // Consequence surfacing: pick at most ONE eligible seed (messagesUntilEcho <= 0).
  // Priority: (1) threadId matches spotlight, (2) threadId matches any escalating thread, (3) first eligible.
  let consequenceEcho: string | undefined;
  const eligible = consequences.filter((c) => c.messagesUntilEcho <= 0);
  if (eligible.length > 0) {
    const escalatingIds = new Set(active.filter((t) => t.status === "escalating").map((t) => t.id));
    let chosen = eligible.find((c) => c.threadId !== undefined && c.threadId === spotlight?.id);
    if (!chosen) chosen = eligible.find((c) => c.threadId !== undefined && escalatingIds.has(c.threadId));
    if (!chosen) chosen = eligible[0];
    consequenceEcho = chosen.echo;
  }

  return {
    phase: s.phase, tension: s.tension, intent,
    wordBudget: wordBudgetFor(intent, s.phase, s.turn), spotlight, gmInitiative,
    activeThreads: active.map((t) => ({ label: t.label, kind: t.kind, notes: t.notes })),
    actingNpc,
    consequenceEcho,
  };
}

export function mergeStoryState(
  prev: SessionStoryState,
  ex: {
    threadUpdates: { id: string; status?: ThreadStatus; notes?: string }[];
    newThreads: { label: string; kind: ThreadKind; weight: number; notes?: string }[];
    tensionRead: number;
  },
  turn: number
): SessionStoryState {
  // (1) Clone threads; apply updates by id then case-insensitive label
  let threads: StoryThread[] = prev.threads.map((t) => ({ ...t }));

  for (const upd of ex.threadUpdates) {
    // Belt-and-suspenders: skip if id is not a usable string (parser is the primary filter)
    if (typeof upd.id !== "string") continue;
    // Find by id first, then by normalized label
    let idx = threads.findIndex((t) => t.id === upd.id);
    if (idx === -1) {
      const normId = upd.id.trim().toLowerCase();
      idx = threads.findIndex((t) => t.label.trim().toLowerCase() === normId);
    }
    if (idx !== -1) {
      const t = threads[idx];
      const status = normalizeThreadStatus(upd.status);
      if (status) t.status = status;
      if (upd.notes !== undefined) t.notes = upd.notes.slice(0, CONSTANTS.NOTES_MAX);
      // Auto-weight boost: threads touched 5+ times gain weight (player is invested)
      if (t.touchedCount >= 5 && t.weight < 4) {
        t.weight = Math.min(5, t.weight + 1) as 1 | 2 | 3 | 4 | 5;
      }
      t.lastTouchedTurn = turn;
      t.touchedCount = t.touchedCount + 1;
    }
  }

  // (2) Forced-payoff logic
  if (prev.lastIntent === "payoff" && prev.lastSpotlightId) {
    const spIdx = threads.findIndex((t) => t.id === prev.lastSpotlightId);
    if (spIdx !== -1) {
      const sp = threads[spIdx];
      if (sp.status !== "resolved") {
        sp.forcedPayoffTurns = sp.forcedPayoffTurns + 1;
        if (sp.forcedPayoffTurns >= CONSTANTS.MAX_FORCED_PAYOFF_TURNS) {
          sp.status = "resolved";
          sp.lastTouchedTurn = turn;
        }
      }
    }
  }

  // Reset forcedPayoffTurns on all threads when last intent was not payoff
  if (prev.lastIntent !== "payoff") {
    for (const t of threads) {
      t.forcedPayoffTurns = 0;
    }
  }

  // (3) Add new threads (capped at MAX_NEW_THREADS_PER_TURN, deduped by normalized label)
  const existingLabels = new Set(threads.map((t) => t.label.trim().toLowerCase()));
  let addedCount = 0;
  for (const nt of ex.newThreads) {
    if (addedCount >= CONSTANTS.MAX_NEW_THREADS_PER_TURN) break;
    // A full board takes no new threads — eviction can't remove weight>=4 ones.
    const activeCount = threads.filter((t) => t.status === "open" || t.status === "escalating").length;
    if (activeCount >= CONSTANTS.MAX_SESSION_THREADS) break;
    // Belt-and-suspenders: skip if label is not a usable string (parser is the primary filter)
    if (typeof nt.label !== "string") continue;
    // weight 1 = flavor, per the extractor prompt — not a plot thread.
    const ntWeight = normalizeThreadWeight(nt.weight);
    if (ntWeight === undefined || ntWeight <= 1) continue;
    const normalLabel = nt.label.trim().toLowerCase();
    if (existingLabels.has(normalLabel)) continue;
    // Near-duplicates: "Rhythmic sound from depths" vs "Heavy, dragging sound from depths".
    if (threads.some((t) => similarity(t.label, nt.label) >= THREAD_DUPLICATE_SIMILARITY)) continue;
    existingLabels.add(normalLabel);
    const weight = Math.min(CONSTANTS.NEW_THREAD_MAX_WEIGHT, ntWeight) as 2 | 3;
    threads.push({
      id: crypto.randomUUID(),
      label: nt.label,
      kind: normalizeThreadKind(nt.kind) ?? DEFAULT_THREAD_KIND,
      status: "open",
      weight,
      scope: "session",
      introducedTurn: turn,
      lastTouchedTurn: turn,
      touchedCount: 1,
      forcedPayoffTurns: 0,
      notes: nt.notes,
    });
    addedCount++;
  }

  // (4) beatsSincePayoff: reset if any became resolved this turn, else increment
  const resolvedThisTurn = threads.some((t) => t.status === "resolved" && t.lastTouchedTurn === turn);
  const beatsSincePayoff = resolvedThisTurn ? 0 : prev.beatsSincePayoff + 1;

  // Drop threads resolved for more than 2 turns
  threads = threads.filter((t) => {
    if (t.status === "resolved") {
      return (turn - t.lastTouchedTurn) <= 2;
    }
    return true;
  });

  // (5) Age open weight<=2 untouched >= ABANDON_LIMIT -> drop
  threads = threads.filter((t) => {
    if (t.status === "open" && t.weight <= 2 && (turn - t.lastTouchedTurn) >= CONSTANTS.ABANDON_LIMIT) {
      return false;
    }
    return true;
  });

  // (6) Evict if active > MAX_SESSION_THREADS
  // Eviction order: abandoned -> resolved -> lowest weight -> stalest; never evict unresolved weight>=4
  while (threads.length > CONSTANTS.MAX_SESSION_THREADS) {
    // Build a list of evictable candidates (unresolved weight>=4 are protected)
    const candidates = threads
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !(t.status !== "resolved" && t.weight >= 4));

    if (candidates.length === 0) break; // All remaining are protected

    // Sort by eviction priority: abandoned first, resolved second, then lowest weight, then stalest
    candidates.sort((a, b) => {
      const statusPriority = (s: ThreadStatus) => {
        if (s === "abandoned") return 0;
        if (s === "resolved") return 1;
        return 2;
      };
      const sp = statusPriority(a.t.status) - statusPriority(b.t.status);
      if (sp !== 0) return sp;
      const wp = a.t.weight - b.t.weight;
      if (wp !== 0) return wp;
      // stalest = largest (turn - lastTouchedTurn)
      return (turn - b.t.lastTouchedTurn) - (turn - a.t.lastTouchedTurn);
    });

    // Remove the top eviction candidate
    const evictIdx = candidates[0].i;
    threads.splice(evictIdx, 1);
  }

  // (7) tension via deriveTension
  const isPayoff = prev.lastIntent === "payoff";
  const tension = deriveTension({ prevTension: prev.tension, threads, tensionRead: ex.tensionRead, isPayoff });

  // (8) phase via advancePhase
  const { phase, turnsInPhase } = advancePhase({ phase: prev.phase, tension, turnsInPhase: prev.turnsInPhase });

  return {
    version: 1,
    phase,
    tension,
    turnsInPhase,
    beatsSincePayoff,
    turn,
    lastGmInitiativeTurn: prev.lastGmInitiativeTurn,
    lastIntent: prev.lastIntent,
    lastSpotlightId: prev.lastSpotlightId,
    lastReconcileTurn: prev.lastReconcileTurn,
    lastJournalTurn: prev.lastJournalTurn,
    threads,
  };
}

/**
 * Strips any echoed control blocks the model may have appended to its narration.
 *
 * Removes:
 * - Any [DIRECTOR] block: from a line that starts with [DIRECTOR] (case-insensitive)
 *   through to the next blank line (\n\s*\n) or end-of-string.
 * - Stray [STATE_UPDATE_END], [STATE_UPDATE], and [/DIRECTOR] tokens on their own lines.
 *
 * After removal the result is trimmed of trailing whitespace/blank lines.
 * The function is a no-op when no such tokens are present.
 */
export function stripControlEcho(text: string): string {
  // 1. Remove [DIRECTOR] blocks: from the [DIRECTOR] line to the next blank line or EOS.
  //    The block may be preceded by a blank line; consume that blank line too so we don't
  //    leave a dangling empty paragraph.
  //    Regex: optional leading blank line, then the [DIRECTOR] line, then everything up to
  //    the next blank line or end-of-string.
  let result = text.replace(
    /(\n\s*\n)?[ \t]*\[DIRECTOR\][^\n]*(?:\n(?!\s*\n)[^\n]*)*/gi,
    (match, leadingBlank) => {
      // If the match consumed a leading blank line, we need to decide what to restore.
      // We return nothing — the surrounding text will handle spacing via the final trim.
      return leadingBlank ? "" : "";
    }
  );

  // 2. Remove stray single-line control tokens on their own line (including the line's newline).
  //    Match: optional preceding newline + the whole token line + its trailing newline (if any).
  result = result.replace(/\n?[ \t]*\[STATE_UPDATE_END\][ \t]*\n?/gi, "\n");
  result = result.replace(/\n?[ \t]*\[STATE_UPDATE\][ \t]*\n?/gi, "\n");
  result = result.replace(/\n?[ \t]*\[\/DIRECTOR\][ \t]*\n?/gi, "\n");
  //    Meta notes on a line of their own: "// (Attempting to ...)" or "(Intentás ...)".
  result = result.replace(/^[ \t]*(?:\/\/.*|\([^()\n]*\))[ \t]*$/gm, "");
  //    Marker leftovers stuck to the prose after substitution: ":DC{N/A}", ":DC12".
  result = result.replace(/[ \t]*:[ \t]*DC[ \t]*(?:\{[^}\n]*\}|\d+)/gi, "");

  // 3. Trim trailing blank lines / whitespace; collapse internal runs of 3+ newlines.
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

/**
 * Pure function that reconciles session story threads into the persistent campaign arc.
 *
 * Steps:
 * 1. SEED — if the campaign thread list is empty, seed one campaign thread per plotHook entry.
 * 2. PROMOTE — session threads that are high-weight/high-touch and have no campaignThreadId
 *    get promoted into a new (or matched existing) campaign thread.
 * 3. MIRROR — session threads already linked to a campaign thread mirror their status onto it;
 *    when status changed, a history entry is appended (capped at 8).
 * 4. CAP — trim to MAX_CAMPAIGN_THREADS, dropping lowest-weight resolved threads first.
 *
 * Returns the new CampaignStoryState and a list of promotions for the caller to write back.
 * Does NOT mutate inputs.
 */
export function reconcileCampaignThreads(
  campaign: CampaignStoryState | null,
  session: SessionStoryState,
  plotHooks: string[],
  sessionId: string,
): { campaign: CampaignStoryState; promotions: { sessionThreadId: string; campaignThreadId: string }[] } {
  // Clone campaign threads (never mutate the input).
  const threads: CampaignStoryThread[] = campaign ? campaign.threads.map((t) => ({ ...t, history: [...t.history] })) : [];

  const promotions: { sessionThreadId: string; campaignThreadId: string }[] = [];

  // ── 1. SEED from plotHooks when the campaign thread list is empty ──────────
  if (threads.length === 0 && plotHooks.length > 0) {
    for (const hook of plotHooks) {
      threads.push({
        id: crypto.randomUUID(),
        label: hook,
        kind: "goal",
        status: "open",
        weight: 3,
        introducedSession: sessionId,
        lastTouchedSession: sessionId,
        history: [],
      });
    }
  }

  // ── 2. PROMOTE qualifying session threads ────────────────────────────────────
  for (const t of session.threads) {
    if (
      t.scope !== "session" ||
      t.weight < CONSTANTS.PROMOTE_WEIGHT ||
      t.touchedCount < CONSTANTS.PROMOTE_TOUCHES ||
      t.campaignThreadId !== undefined
    ) {
      continue;
    }

    const normLabel = t.label.trim().toLowerCase();
    const existing = threads.find((ct) => ct.label.trim().toLowerCase() === normLabel);

    if (existing) {
      // Match found — record promotion to the existing campaign thread, no duplicate.
      promotions.push({ sessionThreadId: t.id, campaignThreadId: existing.id });
    } else {
      // No match — create a new campaign thread.
      const newId = crypto.randomUUID();
      threads.push({
        id: newId,
        label: t.label,
        kind: t.kind,
        status: "open",
        weight: t.weight,
        introducedSession: sessionId,
        lastTouchedSession: sessionId,
        history: [],
      });
      promotions.push({ sessionThreadId: t.id, campaignThreadId: newId });
    }
  }

  // ── 3. MIRROR status from linked session threads ──────────────────────────────
  for (const t of session.threads) {
    if (!t.campaignThreadId) continue;
    const ctIdx = threads.findIndex((ct) => ct.id === t.campaignThreadId);
    if (ctIdx === -1) continue;

    const ct = threads[ctIdx];
    if (ct.status !== t.status) {
      // Status changed — mirror it and append a history entry.
      ct.status = t.status;
      ct.lastTouchedSession = sessionId;
      const entry = `${t.status} in session ${sessionId}`;
      if (ct.history.length >= 8) {
        ct.history.shift(); // drop oldest
      }
      ct.history.push(entry);
    }
  }

  // ── 4. CAP at MAX_CAMPAIGN_THREADS ────────────────────────────────────────────
  while (threads.length > CONSTANTS.MAX_CAMPAIGN_THREADS) {
    // Drop lowest-weight resolved threads first, then lowest weight overall.
    // Sort: resolved first (status=resolved), then by weight ascending (lowest first).
    const evictIdx = (() => {
      let bestIdx = -1;
      let bestIsResolved = false;
      let bestWeight = Infinity;

      for (let i = 0; i < threads.length; i++) {
        const ct = threads[i];
        const isResolved = ct.status === "resolved";
        if (bestIdx === -1) {
          bestIdx = i; bestIsResolved = isResolved; bestWeight = ct.weight;
          continue;
        }
        // Prefer resolved over non-resolved
        if (isResolved && !bestIsResolved) {
          bestIdx = i; bestIsResolved = isResolved; bestWeight = ct.weight;
        } else if (isResolved === bestIsResolved && ct.weight < bestWeight) {
          bestIdx = i; bestWeight = ct.weight;
        }
      }
      return bestIdx;
    })();

    if (evictIdx === -1) break;
    threads.splice(evictIdx, 1);
  }

  return { campaign: { version: 1, threads }, promotions };
}

export function buildDirectorBlock(decision: DirectorDecision): string {
  const { phase, tension, intent, spotlight, gmInitiative, activeThreads, actingNpc, consequenceEcho } = decision;

  // Translate intent to a directive sentence
  const spotlightCtx = spotlight?.notes ? ` (last known: ${spotlight.notes})` : "";
  const intentDirective = ((): string => {
    switch (intent) {
      case "develop":
        return spotlight
          ? `Develop the thread "${spotlight.label}" (${spotlight.kind})${spotlightCtx} further in this scene. Add a detail, reveal, or complication that deepens it.`
          : "Develop the scene — introduce or deepen a story thread with a concrete detail or encounter.";
      case "escalate":
        return spotlight
          ? `Escalate the tension around "${spotlight.label}" (${spotlight.kind})${spotlightCtx} — raise the stakes. Something gets worse, a deadline tightens, or a new danger emerges from this thread.`
          : "Escalate the tension — push an existing thread toward a crisis point. The situation should feel more urgent after this beat.";
      case "payoff":
        return spotlight
          ? `Bring "${spotlight.label}" (${spotlight.kind})${spotlightCtx} to a decisive moment — payoff or confrontation. This thread should reach a turning point or resolution that changes the status quo.`
          : "Drive the scene toward a payoff or resolution of the dominant conflict.";
      case "breathe": {
        const breatheOptions = [
          "Let the scene breathe — a quieter beat. Show the world existing around the player: ambient life, weather, background NPCs. Build atmosphere, not plot.",
          "A moment of rest. Let NPCs show personality outside of conflict. Banter, memory, vulnerability. The player gets a human moment.",
          "Quiet tension. Nothing overt happens, but let something feel off — a detail that doesn't add up, a look between NPCs, a silence where there should be noise.",
          "The aftermath. Let the weight of recent events sink in. Describe what the player's body feels like, what the environment looks like in the calm.",
          "World-building beat. Show something about the setting's culture, economy, or daily life. Ground the world as a place people live in, not just an adventure backdrop.",
        ];
        return breatheOptions[tension % breatheOptions.length];
      }
    }
  })();

  const lines: string[] = [
    "[DIRECTOR]",
    `The story is ${phase} (tension ${tension}/100).`,
  ];

  // "In play:" line: list active threads with notes when available
  if (activeThreads.length > 0) {
    lines.push(`In play:`);
    for (const t of activeThreads) {
      const noteSuffix = t.notes ? ` — ${t.notes}` : "";
      lines.push(`  • ${t.kind}: "${t.label}"${noteSuffix}`);
    }
  }

  lines.push(intentDirective);

  if (consequenceEcho) {
    lines.push(`Because of what came before: ${consequenceEcho}.`);
  }

  if (gmInitiative) {
    lines.push(`Complication: ${gmInitiative}`);
  }

  if (actingNpc) {
    const { name, agenda, voice } = actingNpc;
    lines.push(`${name} acts on their own aim now: ${agenda}${voice ? ` (their voice: ${voice})` : ""}.`);
  }

  // Dramatic moment flag: climax + payoff = this is THE moment
  if (phase === "climax" && intent === "payoff") {
    lines.push("THIS IS A PIVOTAL MOMENT. Write it like it matters. Stakes are real. Consequences are permanent. Make it memorable.");
  }

  // Thread convergence hint: when 2+ threads share owner NPC, they're about to collide
  if (spotlight && activeThreads.length >= 2) {
    const otherThreads = activeThreads.filter((t) => t.label !== spotlight!.label);
    if (otherThreads.length > 0 && (intent === "escalate" || intent === "payoff")) {
      lines.push(`Consider how "${spotlight.label}" connects to or collides with other active threads — convergence creates powerful moments.`);
    }
  }

  return lines.join("\n");
}
