"use client";

import { useEffect, useRef, useState } from "react";
import type { SendResult } from "./use-chat";

/** How long to wait before the single retry of an opener that hit a lock/409 (the previous request is still winding down). */
const CONFLICT_RETRY_MS = 2000;

// Only the "still busy / just started" conflicts can clear up on their own; "has ended" or "create a character" cannot.
const isConflict = (res: SendResult): boolean =>
  !res.ok && !res.aborted && /already (started|processing)/i.test(res.error ?? "");

/** Starts a brand-new session once: the server writes the opening scene. */
export function useSessionOpener(opts: {
  sessionId: string;
  /** History loaded and empty, session active, at least one character, not sending. */
  ready: boolean;
  sendOpener: (sessionId: string) => Promise<SendResult>;
}) {
  const { sessionId, ready, sendOpener } = opts;
  const triggeredRef = useRef(false);
  const conflictRetriedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready || triggeredRef.current) return;
    triggeredRef.current = true;
    void sendOpener(sessionId).then((res) => {
      // A dev StrictMode remount (or leaving the page) aborts before anything commits: re-arm.
      // Only a non-user abort retries, so Stop is respected and an error can't loop.
      if (res.aborted && !res.stoppedByUser) {
        triggeredRef.current = false;
        setRetry((n) => n + 1);
      } else if (isConflict(res) && !conflictRetriedRef.current) {
        // The aborted first request may still hold the turn lock: try once more shortly. `ready` is rechecked by the
        // effect, so nothing is sent if the history showed up meanwhile.
        conflictRetriedRef.current = true;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          triggeredRef.current = false;
          setRetry((n) => n + 1);
        }, CONFLICT_RETRY_MS);
      }
    });
  }, [ready, sessionId, sendOpener, retry]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );
}
