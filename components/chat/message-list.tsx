"use client";

import { memo, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { MessageBubble } from "./message-bubble";
import { Skeleton } from "@/components/ui/skeleton";
import type { Message } from "@/types";
import type { CharacterLink } from "@/lib/character-links";
import { isHiddenOpener } from "@/lib/messages";
import { cn } from "@/lib/utils";

interface MessageListProps {
  /** Saved messages only, chronological. */
  messages: Message[];
  /** The narration streaming in right now ("" = none). */
  streamingText?: string;
  /** The turn behind `streamingText` has finished: the text stands in for the saved message, without the indicator. */
  streamingSettled?: boolean;
  /** The saved message that just replaced the streamed text: it appears without the entry animation. */
  settledMessageId?: string | null;
  loadMore: () => void;
  isLoadingMore: boolean;
  canLoadMore: boolean;
  onRetry?: (message: Message) => void;
  characterLinks?: CharacterLink[];
  /** A turn (e.g. the auto-generated opening) is running but no text has arrived yet. */
  isPreparing?: boolean;
}

const NO_LINKS: CharacterLink[] = [];

/** The saved history. Memoized: a streamed token re-renders only the streaming bubble, not these. */
const PersistedMessages = memo(function PersistedMessages({
  messages,
  onRetry,
  characterLinks,
  settledMessageId,
}: {
  messages: Message[];
  onRetry?: (message: Message) => void;
  characterLinks: CharacterLink[];
  settledMessageId?: string | null;
}) {
  return (
    <>
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          characterLinks={characterLinks}
          onRetry={m.metadata?.error ? onRetry : undefined}
          animate={m.id !== settledMessageId}
        />
      ))}
    </>
  );
});

export function MessageList({
  messages,
  streamingText = "",
  streamingSettled = false,
  settledMessageId,
  loadMore,
  isLoadingMore,
  canLoadMore,
  onRetry,
  characterLinks = NO_LINKS,
  isPreparing = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Follow new content only while the player is at (or near) the bottom. */
  const stickRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  const visible = useMemo(() => messages.filter((m) => !isHiddenOpener(m)), [messages]);

  const streamingMessage = useMemo(
    () =>
      streamingText
        ? ({
            id: "streaming",
            sessionId: "",
            role: "assistant",
            content: streamingText,
            streamingText: null,
            isStreaming: !streamingSettled,
            metadata: null,
            createdAt: Date.now(),
          } as Message)
        : null,
    [streamingText, streamingSettled]
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distFromBottom <= 80;
  }, []);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  // A new saved message: one smooth scroll (instant on the first paint of the list).
  const lastId = messages[messages.length - 1]?.id;
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!scrollRef.current) return; // still on the empty state
    scrollToBottom(didInitialScroll.current);
    didInitialScroll.current = true;
  }, [lastId, scrollToBottom]);

  // Streaming: instant, at most once per frame.
  useEffect(() => {
    if (!streamingText || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      scrollToBottom(false);
    });
  }, [streamingText, scrollToBottom]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    []
  );

  // Loading older messages prepends them: keep the viewport on what the player was reading. The position is set
  // absolutely (not +=) so it is right whether or not the browser's own scroll anchoring already moved it.
  const prependRef = useRef<{ top: number; height: number } | null>(null);
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const before = prependRef.current;
    if (!el || !before || isLoadingMore) return;
    el.scrollTop = before.top + (el.scrollHeight - before.height);
    prependRef.current = null;
  }, [firstId, isLoadingMore]);
  const handleLoadMore = useCallback(() => {
    const el = scrollRef.current;
    prependRef.current = el ? { top: el.scrollTop, height: el.scrollHeight } : null;
    loadMore();
  }, [loadMore]);

  if (visible.length === 0 && !streamingMessage) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-xs animate-narrative-in">
          <div className="scene-divider mb-4">
            <span className="text-[10px] tracking-[0.3em] font-serif opacity-60">&#x2726;&#x2726;&#x2726;</span>
          </div>
          {isPreparing ? (
            <p className="text-sm text-zinc-500 font-serif italic leading-relaxed animate-pulse">
              The narrator is setting the scene…
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-500 font-serif italic leading-relaxed">
                A blank page lies before you, waiting for the first words of your tale.
              </p>
              <p className="text-xs text-zinc-600 mt-3">
                Type a message or use a quick action to begin your adventure.
              </p>
            </>
          )}
          <div className="scene-divider mt-4">
            <span className="text-[10px] tracking-[0.3em] font-serif opacity-60">&#x2726;&#x2726;&#x2726;</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-2 sm:px-3"
    >
      {/* Load more sentinel */}
      {canLoadMore && (
        <div className="py-3 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className={cn(
              "text-xs text-zinc-600 hover:text-zinc-400 transition-colors",
              isLoadingMore && "opacity-50 cursor-wait"
            )}
          >
            {isLoadingMore ? "Loading..." : "Load older messages"}
          </button>
        </div>
      )}

      {isLoadingMore && (
        <div className="space-y-2 py-2">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-8 w-1/2 ml-auto" />
        </div>
      )}

      {/* Saved messages (session-start trigger hidden), then the streaming bubble in the same flow */}
      <div className="py-2 space-y-0.5">
        <PersistedMessages
          messages={visible}
          onRetry={onRetry}
          characterLinks={characterLinks}
          settledMessageId={settledMessageId}
        />
        {streamingMessage && <MessageBubble message={streamingMessage} characterLinks={characterLinks} />}
      </div>
    </div>
  );
}
