"use client";

import { useEffect, type RefObject } from "react";

/**
 * Focuses `ref` when mounted (and whenever `resetKey` changes) and keeps Tab / Shift+Tab cycling
 * among the focusable elements inside it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, resetKey?: unknown) {
  useEffect(() => {
    ref.current?.focus();
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const container = ref.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleTab);
    return () => window.removeEventListener("keydown", handleTab);
  }, [ref, resetKey]);
}
