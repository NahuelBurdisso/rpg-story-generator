"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useChat, type SendMetadata } from "@/hooks/use-chat";
import type { SessionMessages } from "@/hooks/use-session-messages";
import { useSessionOpener } from "@/hooks/use-session-opener";
import type { Campaign, Character, DiceRoll, Message, QuickAction, Session } from "@/types";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { QuickActions } from "./quick-actions";
import { DiceRoller } from "./dice-roller";
import { ChatToolbar } from "./chat-toolbar";
import { ChatBanners } from "./chat-banners";
import { CharacterPanel } from "./character-panel";
import { formatDiceResult } from "@/lib/dice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ILLUSTRATE_NOTES = {
  already_generating: "An illustration is already being generated.",
  no_content: "Nothing to illustrate yet.",
  unavailable: "Image generation is unavailable right now (is ComfyUI running?).",
} as const;

interface ChatContainerProps {
  session: Session;
  campaign: Campaign;
  characters: Character[];
  /** The history query, started by the page in the same render as the rest. */
  history: SessionMessages;
}

export function ChatContainer({ session, campaign, characters, history }: ChatContainerProps) {
  const sessionId = session.id;
  const router = useRouter();
  const [pendingDice, setPendingDice] = useState<DiceRoll | null>(null);
  const [diceOpen, setDiceOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const hasCharacters = characters.length > 0;

  const characterLinks = useMemo(
    () => characters.map((c) => ({ name: c.name, id: c.id, campaignId: c.campaignId })),
    [characters]
  );
  const characterNames = useMemo(() => characters.map((c) => c.name), [characters]);
  const characterOptions = useMemo(() => characters.map((c) => ({ id: c.id, name: c.name })), [characters]);

  const utils = trpc.useUtils();

  const { sendMessage, sendOpener, stop, isSending, streamingText, committedMessageId, error: chatError, clearError } =
    useChat(campaign.id);
  const [restore, setRestore] = useState<{ text: string; nonce: number }>();

  const [illustrateNote, setIllustrateNote] = useState<string | null>(null);
  const illustrate = trpc.images.illustrate.useMutation({
    onSuccess: (res) => {
      if (res.status === "started") {
        setIllustrateNote(null);
        // The server answers once the "generating" row and the message's imageId exist.
        void utils.messages.listBySession.invalidate({ sessionId });
      } else {
        setIllustrateNote(ILLUSTRATE_NOTES[res.status]);
      }
    },
    onError: (err) => setIllustrateNote(`Could not start the illustration: ${err.message}`),
  });

  const endSession = trpc.sessions.endSession.useMutation({
    onSuccess: () => {
      setConfirmEnd(false);
      void utils.sessions.get.invalidate({ id: sessionId });
      void utils.sessions.listByCampaign.invalidate({ campaignId: session.campaignId });
      router.push(`/campaigns/${session.campaignId}`);
    },
    // The error shows in the banner below (e.g. "a turn is still in progress"); close the dialog.
    onError: () => setConfirmEnd(false),
  });

  const bannerError = chatError ?? endSession.error?.message ?? null;
  // `session` comes from the page's sessions.get query; use-chat invalidates it when a turn ends (done, error, abort)
  // or is rejected, so processingStartedAt never stays stale.
  const isCompleted = session.status === "completed";
  const isProcessing = !!session.processingStartedAt;
  const isDisabled = isSending || isProcessing || isCompleted;

  const { mutate: endSessionMutate } = endSession;
  const handleEndSession = useCallback(() => {
    endSessionMutate({ sessionId });
  }, [endSessionMutate, sessionId]);

  const closeConfirm = useCallback(() => setConfirmEnd(false), []);

  // A brand-new session (no messages yet) asks the server for its opening scene.
  useSessionOpener({
    sessionId,
    sendOpener,
    ready: history.loaded && history.messages.length === 0 && !isSending && !isCompleted && hasCharacters,
  });

  // Once the saved message is in the list, the streamed text steps aside in the same render: no blank frame, no
  // duplicate.
  const committedShown = !!committedMessageId && history.messages.some((m) => m.id === committedMessageId);

  const handleSend = useCallback(
    async (text: string) => {
      let content = text;
      let metadata: SendMetadata | undefined;
      const dice = pendingDice;

      if (pendingDice) {
        content = `${text}\n\n${formatDiceResult(pendingDice.dice, pendingDice.result)}`;
        metadata = { diceRoll: { dice: pendingDice.dice, result: pendingDice.result } };
        setPendingDice(null);
      }

      const res = await sendMessage(sessionId, content, metadata);
      // The turn left nothing on the server: give the player their text (and roll) back.
      if (!res.ok && res.restoreInput !== undefined) {
        setRestore({ text, nonce: Date.now() });
        if (dice) setPendingDice(dice);
      }
    },
    [sendMessage, sessionId, pendingDice]
  );

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      // handleSend reports failures through the chat state (error banner / restored input) and never rejects.
      void handleSend(action.prompt);
    },
    [handleSend]
  );

  const handleDiceRoll = useCallback((roll: DiceRoll) => {
    setPendingDice(roll);
  }, []);

  const toggleDice = useCallback(() => setDiceOpen((v) => !v), []);

  const { mutate: illustrateMutate } = illustrate;
  const handleIllustrate = useCallback(
    (characterId?: string | null) => illustrateMutate({ sessionId, characterId: characterId ?? undefined }),
    [illustrateMutate, sessionId]
  );

  // Read through a ref so the callback stays stable and the memoized message list doesn't re-render per turn.
  const messagesRef = useRef(history.messages);
  useEffect(() => {
    messagesRef.current = history.messages;
  });
  const handleRetry = useCallback(
    async (errorMsg: Message) => {
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === errorMsg.id);
      if (idx <= 0) return;

      const prevUserMsg = [...list]
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");

      if (prevUserMsg) {
        await sendMessage(
          sessionId,
          prevUserMsg.content,
          prevUserMsg.metadata ?? undefined
        );
      }
    },
    [sendMessage, sessionId]
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full">
      {/* Chat column */}
      <div className="flex flex-1 flex-col min-w-0 relative">
        <ChatToolbar
          campaignName={campaign.name}
          imageEnabled={!!campaign.imageEnabled}
          galleryHref={`/campaigns/${session.campaignId}/sessions/${sessionId}/gallery`}
          isCompleted={isCompleted}
          endDisabled={endSession.isPending || isSending || isProcessing}
          onEndSession={() => setConfirmEnd(true)}
          characterNames={characterNames}
          onOpenDrawer={() => setDrawerOpen(true)}
        />

        <ConfirmDialog
          open={confirmEnd}
          title="End this session?"
          description="A summary will be generated from recent messages. This cannot be undone."
          confirmLabel="End Session"
          pendingLabel="Ending..."
          pending={endSession.isPending}
          onConfirm={handleEndSession}
          onCancel={closeConfirm}
        />

        <ChatBanners
          isCompleted={isCompleted}
          error={bannerError}
          onDismissError={() => {
            clearError();
            endSession.reset();
          }}
          illustrateNote={illustrateNote}
          onDismissNote={() => setIllustrateNote(null)}
          pendingDice={pendingDice}
          onClearDice={() => setPendingDice(null)}
        />

        {/* Message list */}
        <MessageList
          messages={history.messages}
          streamingText={committedShown ? "" : streamingText}
          streamingSettled={!!committedMessageId || !isSending}
          settledMessageId={committedShown ? committedMessageId : null}
          loadMore={history.loadOlder}
          isLoadingMore={history.isLoadingOlder}
          canLoadMore={history.hasOlder}
          onRetry={handleRetry}
          characterLinks={characterLinks}
          isPreparing={isSending || isProcessing}
        />

        {/* Quick actions — hidden when session is completed */}
        {!isCompleted && (
          <QuickActions actions={campaign.quickActions} onAction={handleQuickAction} disabled={isDisabled} />
        )}

        {/* Dice roller — hidden when session is completed */}
        {!isCompleted && (
          <DiceRoller
            onRoll={handleDiceRoll}
            isOpen={diceOpen}
            onToggle={toggleDice}
          />
        )}

        {/* Chat input / session ended state */}
        {isCompleted ? (
          <div className="flex items-center justify-center border-t border-zinc-800/60 bg-zinc-950 px-4 py-4">
            <p className="text-xs text-zinc-600">Session ended — no further messages can be sent.</p>
          </div>
        ) : (
          <ChatInput
            onSend={handleSend}
            onIllustrate={handleIllustrate}
            illustrating={illustrate.isPending}
            disabled={isDisabled}
            restore={restore}
            onStop={isSending ? stop : undefined}
            characters={characterOptions}
            placeholder={
              pendingDice
                ? `Rolled ${pendingDice.dice}: ${pendingDice.result} - will be included with your next message`
                : "What do you do?"
            }
          />
        )}
      </div>

      <CharacterPanel
        characters={characters}
        campaign={campaign}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
    </div>
  );
}
