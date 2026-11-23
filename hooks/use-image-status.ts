"use client";

import { trpc } from "@/lib/trpc";

/** Poll interval while a scene image is rendering. */
export const IMAGE_POLL_MS = 2000;

export function useImageStatus(imageId: string | undefined) {
  return trpc.images.status.useQuery(
    { imageId: imageId ?? "" },
    {
      enabled: !!imageId,
      // Re-evaluated after every fetch: polls only while the row says "generating".
      refetchInterval: (query) => (query.state.data?.status === "generating" ? IMAGE_POLL_MS : false),
    }
  );
}
