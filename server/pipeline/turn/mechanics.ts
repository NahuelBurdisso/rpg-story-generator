import type { CampaignRow, CharacterRow } from "../../db/schema";
import type { MechanicRoll } from "@/types";
import { resolveMechanics, substituteMarkers, keepFirstMarker, dropEchoedSentences } from "../diceResolver";
import { parseSnippets, getMarkerContext } from "../snippetWriter";
import { buildSnippetPrompt } from "../promptBuilder";
import { callLLM, cleanGibberish, LLMAbortedError, type ProviderConfig, type LLMOptions } from "../../llm/providers";
import { parseStateUpdate } from "../stateParser";
import { stripControlEcho } from "../director";
import { narrate } from "../narrate";
import { stripMechanicMarkers } from "../text";
import { findAffectedCharacter, deduplicateContent } from "../utils";
import type { TurnCommit } from "../turnCommit";

const SNIPPET_OPTIONS: LLMOptions = {
  temperature: 0.3,
  maxTokens: 512,
};

/** Guard: if the draft is too short, retry once with a length nudge; keep whichever is longer. */
export async function retryShortDraft(args: {
  narratorDraft: string;
  narratorPrompt: string;
  message: string;
  llmConfig: ProviderConfig;
  narratorOptions: LLMOptions;
  signal?: AbortSignal;
}): Promise<string> {
  const { narratorPrompt, message, llmConfig, narratorOptions, signal } = args;
  let narratorDraft = args.narratorDraft;

  const draftWords = stripMechanicMarkers(narratorDraft).split(/\s+/).filter(Boolean);
  if (draftWords.length < 12) {
    try {
      const retry = await callLLM(
        llmConfig,
        [
          { role: "system", content: narratorPrompt },
          {
            role: "user",
            content: `${message}\n\n(Write the FULL narration as prose — at least a full paragraph that reacts to this action and lands on a concrete beat. Do not stop after a few words.)`,
          },
        ],
        async () => {},
        narratorOptions,
        { priority: "streaming", retries: 0, signal }
      );
      if (stripMechanicMarkers(retry).split(/\s+/).filter(Boolean).length > draftWords.length) {
        narratorDraft = retry;
      }
    } catch (err) {
      if (err instanceof LLMAbortedError) throw err;
      /* keep the short draft rather than fail the turn */
    }
  }
  return narratorDraft;
}

/**
 * Dice, snippet rewrite and cleanup: turns the narrator draft into the text
 * that gets committed, plus its rolls, STATE_UPDATE and dice damage.
 */
export async function resolveTurnMechanics(args: {
  narratorDraft: string;
  message: string;
  campaign: CampaignRow;
  chars: CharacterRow[];
  llmConfig: ProviderConfig;
  fallbackConfig: ProviderConfig | null;
  onToken: (token: string) => void;
  signal?: AbortSignal;
}): Promise<{
  finalText: string;
  mechanics: MechanicRoll[];
  stateUpdate: TurnCommit["stateUpdate"];
  damage: TurnCommit["damage"];
}> {
  const { message, campaign, chars, llmConfig, fallbackConfig, onToken, signal } = args;
  let narratorDraft = args.narratorDraft;

  // Step 1.5: Dice Resolver
  // Copied format line "[MECHANIC:a] | [MECHANIC:b]" — drop the pipe so it
  // isn't left dangling once the markers are substituted or stripped.
  narratorDraft = keepFirstMarker(narratorDraft.replace(/\]\s*\|\s*(?=\[MECHAN)/gi, "] "));
  // Take the STATE_UPDATE out now: it usually sits after the last marker,
  // in the stretch the outcome-aware rewrite below replaces.
  const draftState = parseStateUpdate(narratorDraft);
  narratorDraft = draftState.cleanedContent;
  const { markers, resolutions } = resolveMechanics(narratorDraft, {
    stats: chars[0]?.stats ?? {},
    difficulty: campaign.difficulty,
    resolveStatsForMarker: (markerStart, markerEnd) => {
      if (chars.length <= 1) return chars[0]?.stats ?? {};
      const windowStart = Math.max(0, markerStart - 120);
      const windowEnd = Math.min(narratorDraft.length, markerEnd + 120);
      const context = narratorDraft.slice(windowStart, windowEnd).toLowerCase();
      return findAffectedCharacter(context, chars).stats ?? {};
    },
  });

  // Send dice roll results to client. They're also stored on the assistant
  // message — the streamed text is replaced by the stored one when the turn ends.
  const mechanics: MechanicRoll[] = [];
  for (const res of resolutions) {
    const isCrit20 = res.roll[0] === 20;
    const isCrit1 = res.roll[0] === 1;
    let rollText: string;
    let outcome: MechanicRoll["outcome"] = "neutral";
    if (res.success !== undefined) {
      if (isCrit20) {
        rollText = `CRITICAL HIT! ${res.description}`;
        outcome = "critical";
      } else if (isCrit1) {
        rollText = `CRITICAL FUMBLE! ${res.description}`;
        outcome = "fumble";
      } else {
        rollText = `${res.description} — ${res.success ? "SUCCESS" : "FAILURE"}`;
        outcome = res.success ? "success" : "failure";
      }
    } else {
      rollText = res.description;
    }
    mechanics.push({ text: rollText, outcome });
    const emoji = isCrit20 ? "⚡" : isCrit1 ? "💀" : "🎲";
    onToken(`\n\n${emoji} *${rollText}*\n\n`);
  }

  let finalText: string;

  if (markers.length === 0) {
    finalText = narratorDraft;
  } else {
    // Step 2: Snippet Writer
    // The narrator wrote everything after the last marker without knowing
    // the roll, so it often contradicts it ("success" followed by "the
    // machine fights back"). The writer redoes that stretch with the outcome —
    // and when the draft stopped at the roll, it writes the ending itself
    // instead of a one-line result with no consequence.
    const lastMarker = markers[markers.length - 1];
    const draftTail = narratorDraft.slice(lastMarker.endIndex).trim() || "(nothing — the draft stops at the roll)";
    const snippetContext = resolutions.map((res, i) => {
      const marker = markers[res.index];
      const { before, after } = getMarkerContext(narratorDraft, marker.startIndex, marker.endIndex);
      const isTail = marker === lastMarker;
      return {
        index: res.index,
        // Carries the outcome (success/failure/crit) — the bare description
        // doesn't, and the snippet writer then guessed (often success).
        description: mechanics[i].text,
        contextBefore: isTail ? narratorDraft.slice(Math.max(0, marker.startIndex - 400), marker.startIndex) : before,
        contextAfter: after,
        draftTail: isTail ? draftTail.slice(0, 1800) : undefined,
      };
    });

    const snippetPrompt = buildSnippetPrompt(
      {
        genre: campaign.genre,
        customGenre: campaign.customGenre,
        tone: campaign.tone,
        difficulty: campaign.difficulty,
        worldDescription: campaign.worldDescription,
      },
      chars.map((c) => ({
        name: c.name,
        role: c.role,
        stats: c.stats,
        inventory: c.inventory,
      })),
      snippetContext
    );

    const snippetResponse = await narrate({
      primary: llmConfig, fallback: fallbackConfig,
      messages: [{ role: "user", content: snippetPrompt }],
      options: SNIPPET_OPTIONS, signal,
    });

    const snippets = parseSnippets(snippetResponse);
    finalText = substituteMarkers(narratorDraft, markers, snippets, { rewriteTail: true });
  }

  // Strip malformed MECHANIC markers
  finalText = stripMechanicMarkers(finalText);
  finalText = cleanGibberish(finalText);
  finalText = finalText.replace(/(\S[^\n]{24,}?)(\s+)\1/g, "$1");
  finalText = deduplicateContent(finalText);
  // The narrator pastes the player's own action back in, first person and
  // all ("You keep your cutter between us and step..."). Their dialogue stays.
  finalText = dropEchoedSentences(finalText, message.replace(/"[^"]*"|“[^”]*”/g, " "));

  if (!finalText.trim()) {
    finalText = cleanGibberish(stripMechanicMarkers(narratorDraft));
  }

  // Parse STATE_UPDATE
  const lateState = parseStateUpdate(finalText);
  // The outcome-aware ending may carry its own update; it beats the pre-roll draft's.
  const stateUpdate = lateState.stateUpdate ?? draftState.stateUpdate;
  finalText = stripControlEcho(lateState.cleanedContent);

  if (!finalText.trim()) {
    const fallbacks: Record<string, string> = {
      fantasy: "*A hush falls over the scene, broken only by the distant creak of old timber and the wind whispering between the stones.*",
      "sci-fi": "*Static hisses over the comms. Readouts flicker. Something waits on the other side of the next decision.*",
      horror: "*The silence stretches. Somewhere close, something shifts — or maybe it was always there. The air feels wrong.*",
      "post-apocalyptic": "*The wind kicks up dust and the faint smell of rust. Nothing moves. The world holds its breath.*",
    };
    finalText = fallbacks[campaign.genre] ?? "*A beat of silence — the moment hangs, unresolved, waiting on what you do next.*";
  }

  const damageResolutions = resolutions.filter((r) => markers[r.index]?.type === "damage");
  return {
    finalText,
    mechanics,
    stateUpdate: stateUpdate ?? null,
    damage: damageResolutions.length > 0 ? { resolutions: damageResolutions, markers, narratorDraft } : null,
  };
}
