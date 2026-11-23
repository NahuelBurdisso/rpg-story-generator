"use client";

import { useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { mergePages } from "@/lib/messages";

export const MESSAGE_PAGE_SIZE = 30;

/**
 * A session's history as an infinite query (newest page first). On invalidation every loaded page is refetched and
 * re-chained from the newest one, so a turn never opens a gap between pages: the oldest loaded messages slide out
 * above the window instead, and "Load older" brings them back with a fresh cursor.
 */
export function useSessionMessages(sessionId: string) {
  const query = trpc.messages.listBySession.useInfiniteQuery(
    { sessionId, limit: MESSAGE_PAGE_SIZE },
    {
      getNextPageParam: (last) => last.nextCursor,
      // Refocusing the tab would refetch every loaded page; turns and illustrations invalidate explicitly.
      refetchOnWindowFocus: false,
    }
  );
  const messages = useMemo(() => mergePages(query.data?.pages), [query.data]);
  const { fetchNextPage } = query;
  // cancelRefetch: false: a "Load older" click must not cancel the refetch a finished turn started.
  const loadOlder = useCallback(() => void fetchNextPage({ cancelRefetch: false }), [fetchNextPage]);
  return {
    messages,
    loaded: query.data !== undefined,
    hasOlder: query.hasNextPage,
    loadOlder,
    isLoadingOlder: query.isFetchingNextPage,
  };
}

export type SessionMessages = ReturnType<typeof useSessionMessages>;
