"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  /** Red confirm button (default). False uses the genre accent. */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Callers pass inline arrows: read the latest handler from a ref so re-renders don't re-run the focus effect.
  const onCancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);
  useEffect(() => {
    onCancelRef.current = onCancel;
    pendingRef.current = pending;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingRef.current) onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={pending ? undefined : onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="relative mx-4 w-full max-w-sm rounded-md border border-border bg-card p-6 shadow-2xl"
      >
        <h3 id={`${id}-title`} className="mb-2 text-sm font-semibold">
          {title}
        </h3>
        <div id={`${id}-desc`} className="mb-6 text-sm text-muted-foreground">
          {description}
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50",
              destructive
                ? "bg-destructive text-destructive-foreground"
                : "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]"
            )}
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
