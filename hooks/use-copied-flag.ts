"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RESET_MS = 1500;

/**
 * `const [copied, copy] = useCopiedFlag(); copy(text)` writes `text` to the clipboard and keeps `copied`
 * true for 1.5 s. The timer is UI feedback only, not a guess about server state.
 */
export function useCopiedFlag(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard unavailable or denied: no "Copied" flash
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_MS);
  }, []);

  return [copied, copy];
}
