import { db } from "../db";
import { sessions, messages } from "../db/schema";
import { eq } from "drizzle-orm";
import type { MessageMetadata, NpcAgendaLite } from "@/types";
import { classifyInput } from "./classifier";
import { classifyScene, getSceneOptions } from "./sceneClassifier";
import { selectRelevantNPCs } from "./npcSelection";
import { buildNarratorPrompt } from "./promptBuilder";
import { cleanGibberish, classifyError, LLMAbortedError, type LLMOptions } from "../llm/providers";
import { parseStateUpdate } from "./stateParser";
import { runDirector, stripControlEcho } from "./director";
import { narrate } from "./narrate";
import { retrieveMemories } from "./memory/store";
import { tryAcquireSessionLock, releaseSessionLock, startLockKeepAlive } from "./sessionLock";
import { enqueueBackground, waitForBackground, turnStateKey, sessionAuxKey } from "./backgroundQueue";
import { commitTurn } from "./turnCommit";
import { loadTurnContext } from "./turn/context";
import { promptCampaign, promptCharacters, buildSceneSummary } from "./turn/prompt";
import { retryShortDraft, resolveTurnMechanics } from "./turn/mechanics";
import { runStateJob, markActingNpc } from "./turn/stateJob";
import { updateContextSummary, maybeGenerateTitle } from "./turn/auxTasks";

const NARRATOR_OPTIONS: LLMOptions = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.92,
  topK: 40,
  // Higher values penalise common function words ("the", "of", "and") too hard
  // and push the model into foreign-script / mangled tokens.
  repeatPenalty: 1.1,
  repeatLastN: 64,
};

export async function runPipeline(params: {
  sessionId: string;
  message: string;
  metadata?: MessageMetadata;
  onToken: (token: string) => void;
  /** The attempt that was streaming failed: the client must discard what it showed so far. */
  onReset?: () => void;
  signal?: AbortSignal;
  /** The turn is saved: `messageId` is the assistant message's row, so the client can swap its streamed text for it. */
  onComplete: (finalText: string, messageId: string) => void;
  onError: (error: string, details?: { restoreInput?: string }) => void;
}) {
  const { sessionId, message, metadata, onToken, onReset, signal, onComplete, onError } = params;

  if (!tryAcquireSessionLock(db, sessionId)) {
    const exists = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).get();
    onError(
      exists ? "This session is already processing a turn — wait for it to finish." : "Session not found",
      { restoreInput: message }
    );
    return;
  }
  // Re-stamp the lock every minute until the turn ends: the wait below plus
  // LLM retries/fallbacks can outlast the stale window, and a stolen lock
  // means two turns racing on the same storyState.
  const stopKeepAlive = startLockKeepAlive(db, sessionId);

  let userMessageId: string | undefined;
  let turnCommitted = false;
  let providerName = "unknown";

  try {
    // The previous turn's extraction must land before we read storyState/seeds.
    await waitForBackground(turnStateKey(sessionId));

    if (signal?.aborted) throw new LLMAbortedError();

    // Store user message
    userMessageId = db.insert(messages).values({ sessionId, role: "user", content: message, metadata })
      .returning({ id: messages.id }).get().id;

    // Load context
    const {
      session, campaign, chars, allNPCs, llmConfig, fallbackConfig,
      storyState0, sceneState0, consequenceSeeds0, campaignStory0,
      recentMessages, lastAssistantMessages,
    } = await loadTurnContext(db, sessionId, (name) => { providerName = name; });

    const complexity = classifyInput(message);
    const sceneType = classifyScene(message, sceneState0);
    const narratorOptions = getSceneOptions(sceneType);

    // ─── TRIVIAL PATH ────────────────────────────────────────────────────────────
    if (complexity === "trivial") {
      const trivialStoryState = storyState0;
      const trivialDecision = runDirector(trivialStoryState);

      const sceneSummary = buildSceneSummary(recentMessages, "trivial");

      const trivialPrompt = buildNarratorPrompt(
        {
          campaign: promptCampaign(campaign),
          characters: promptCharacters(chars),
          npcs: [],
          director: trivialDecision,
          sceneSummary,
          contextSummary: session.contextSummary ?? undefined,
          sceneState: sceneState0,
        },
        message
      );

      let fullResponse = await narrate({
        primary: llmConfig, fallback: fallbackConfig,
        messages: [{ role: "system", content: trivialPrompt }, { role: "user", content: message }],
        options: NARRATOR_OPTIONS, onToken, onReset, signal,
      });

      fullResponse = cleanGibberish(fullResponse);
      const { cleanedContent: cleanedContentRaw, stateUpdate } = parseStateUpdate(fullResponse);
      const cleanedContent = stripControlEcho(cleanedContentRaw);

      const trivialNextState: typeof trivialStoryState = {
        ...trivialStoryState,
        turn: trivialStoryState.turn + 1,
        lastIntent: trivialDecision.intent,
        lastSpotlightId: trivialDecision.spotlight?.id,
        ...(trivialDecision.gmInitiative !== ""
          ? { lastGmInitiativeTurn: trivialStoryState.turn }
          : {}),
      };
      if (signal?.aborted) throw new LLMAbortedError();
      const trivialMessageId = commitTurn(db, {
        sessionId, campaignId: session.campaignId, content: cleanedContent, mechanics: [], chars,
        stateUpdate: stateUpdate ?? null, damage: null, storyState: trivialNextState,
      });
      turnCommitted = true;
      onComplete(cleanedContent, trivialMessageId);
      return;
    }

    // ─── STANDARD PATH ───────────────────────────────────────────────────────────
    const relevantNPCs = selectRelevantNPCs(message, lastAssistantMessages, allNPCs, 3, sceneState0);
    const storyState = storyState0;
    const npcAgendas: NpcAgendaLite[] = relevantNPCs.map((n) => ({
      id: n.id,
      name: n.name,
      agenda: n.agenda,
      agendaThreadId: n.agendaThreadId,
      lastActedTurn: n.lastActedTurn,
      speechPattern: n.speechPattern,
    }));
    const decision = runDirector(
      storyState,
      npcAgendas,
      consequenceSeeds0.map((s) => ({
        echo: s.echo,
        messagesUntilEcho: s.messagesUntilEcho,
        threadId: s.threadId,
      }))
    );
    const sceneSummary = buildSceneSummary(recentMessages, "standard");

    // Attach episodic memories to each relevant NPC
    const memSceneText = [message, ...lastAssistantMessages].join(" ");
    const npcsWithMemories = await Promise.all(
      relevantNPCs.map(async (n) => ({
        ...n,
        memories: await retrieveMemories({ npcId: n.id, currentTurn: storyState.turn, sceneText: memSceneText, k: 3 }),
      }))
    );

    const narratorPrompt = buildNarratorPrompt(
      {
        campaign: promptCampaign(campaign),
        characters: promptCharacters(chars),
        npcs: npcsWithMemories,
        director: decision,
        sceneSummary,
        contextSummary: session.contextSummary ?? undefined,
        sceneType,
        sceneState: sceneState0,
      },
      message
    );

    // Step 1: Narrator (streaming) — with retry-before-fallback.
    // Streaming stops at the first mechanic marker: the prose after it was
    // written before the roll and gets rewritten once the outcome is known.
    let narratorDraft = await narrate({
      primary: llmConfig, fallback: fallbackConfig,
      messages: [{ role: "system", content: narratorPrompt }, { role: "user", content: message }],
      options: narratorOptions, onToken, onReset, signal,
    });
    narratorDraft = await retryShortDraft({ narratorDraft, narratorPrompt, message, llmConfig, narratorOptions, signal });

    // Steps 1.5–2: dice, snippet rewrite, cleanup, STATE_UPDATE.
    const { finalText, mechanics, stateUpdate, damage } = await resolveTurnMechanics({
      narratorDraft, message, campaign, chars, llmConfig, fallbackConfig, onToken, signal,
    });

    if (signal?.aborted) throw new LLMAbortedError();
    const assistantMessageId = commitTurn(db, {
      sessionId,
      campaignId: session.campaignId,
      content: finalText,
      mechanics,
      chars,
      stateUpdate,
      damage,
    });
    turnCommitted = true;

    onComplete(finalText, assistantMessageId);

    // Auto-generate session title (fire-and-forget)
    maybeGenerateTitle(sessionId, finalText, llmConfig).catch((err) => console.error("[title]", err));

    // Persist director decision handoff fields
    const nextTurn = storyState.turn + 1;
    storyState.lastIntent = decision.intent;
    storyState.lastSpotlightId = decision.spotlight?.id;
    if (decision.gmInitiative !== "") {
      storyState.lastGmInitiativeTurn = storyState.turn;
    }

    // Acting-NPC bookkeeping
    markActingNpc(db, decision, allNPCs, storyState.turn);

    // Step 3: extraction → one state commit. Queued per session: the next
    // turn waits for it instead of racing it on storyState/seeds.
    const currentThreads = storyState.threads.map((t) => ({ id: t.id, label: t.label, status: t.status }));
    const sceneNpcRefs = relevantNPCs.map((n) => ({ id: n.id, name: n.name }));
    // enqueueBackground never rejects (it logs failures as [background:<key>]), so `void` is safe here.
    void enqueueBackground(turnStateKey(sessionId), () => runStateJob({
      db, sessionId, campaignId: session.campaignId, campaign, llmConfig, currentThreads, sceneNpcRefs, allNPCs,
      message, finalText, storyState, nextTurn, assistantMessageId, consequenceSeeds0, campaignStory0, decision,
    }));

    void enqueueBackground(sessionAuxKey(sessionId), () => updateContextSummary(sessionId, llmConfig));

    // Scene images are player-triggered only (images.illustrate); turns never
    // start a generation on their own.
  } catch (error: unknown) {
    // Nothing of a failed or abandoned turn may stay behind: the next attempt would see a dangling player message.
    if (!turnCommitted && userMessageId) {
      try {
        db.delete(messages).where(eq(messages.id, userMessageId)).run();
      } catch (err) {
        console.error("[pipeline] orphan cleanup failed", err);
      }
    }
    if (error instanceof LLMAbortedError || signal?.aborted) return; // client is gone
    const { errorMessage } = classifyError(error, providerName);
    onError(errorMessage, { restoreInput: turnCommitted ? undefined : message });
  } finally {
    stopKeepAlive();
    releaseSessionLock(db, sessionId);
  }
}
