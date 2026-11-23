"use client";

import type { DiceRoll } from "@/types";

interface ChatBannersProps {
  isCompleted: boolean;
  /** Stream / end-session error. */
  error: string | null;
  onDismissError: () => void;
  /** Non-error notice from Illustrate (already generating, unavailable, ...). */
  illustrateNote: string | null;
  onDismissNote: () => void;
  pendingDice: DiceRoll | null;
  onClearDice: () => void;
}

/** Session-ended, error, illustration and pending-dice strips above the message list. */
export function ChatBanners({
  isCompleted,
  error,
  onDismissError,
  illustrateNote,
  onDismissNote,
  pendingDice,
  onClearDice,
}: ChatBannersProps) {
  return (
    <>
      {/* Session ended banner */}
      {isCompleted && (
        <div className="flex items-center justify-center gap-2 border-b border-zinc-800/60 bg-zinc-900/60 px-4 py-2.5">
          <span className="text-xs text-zinc-500">This session has ended.</span>
        </div>
      )}

      {/* Stream error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950/30 border-b border-red-800/30 px-3 py-2">
          <span className="text-xs text-red-400 flex-1">{error}</span>
          <button
            onClick={onDismissError}
            className="text-[10px] text-red-600 hover:text-red-400 shrink-0"
          >
            dismiss
          </button>
        </div>
      )}

      {illustrateNote && (
        <div className="flex items-center gap-2 bg-amber-950/20 border-b border-amber-800/20 px-3 py-2">
          <span role="status" className="text-xs text-amber-400 flex-1">{illustrateNote}</span>
          <button
            onClick={onDismissNote}
            className="text-[10px] text-amber-600 hover:text-amber-400 shrink-0"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Pending dice indicator */}
      {pendingDice && (
        <div className="flex items-center gap-2 bg-amber-950/20 border-b border-amber-800/20 px-3 py-1.5">
          <span className="text-xs text-amber-400">
            Rolled {pendingDice.dice}: <strong>{pendingDice.result}</strong> — will be included with your next message
          </span>
          <button
            onClick={onClearDice}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 ml-auto"
          >
            clear
          </button>
        </div>
      )}
    </>
  );
}
