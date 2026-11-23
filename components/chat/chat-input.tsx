"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Send, ImageIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onIllustrate?: (characterId?: string | null) => void;
  illustrating?: boolean;
  characters?: { id: string; name: string }[];
  /** Puts text back in the box (a failed turn); a new nonce re-applies the same text. */
  restore?: { text: string; nonce: number };
  /** Cancels the turn in flight. */
  onStop?: () => void;
}

export const ChatInput = memo(function ChatInput({
  onSend,
  disabled = false,
  placeholder = "What do you do?",
  onIllustrate,
  illustrating,
  characters,
  restore,
  onStop,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const appliedRestoreRef = useRef<number | null>(null);
  const [showCharDropdown, setShowCharDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isMultiChar = !!characters && characters.length >= 2;

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 22;
    const maxRows = 4;
    const maxHeight = lineHeight * maxRows + 16;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (restore && appliedRestoreRef.current !== restore.nonce) {
      appliedRestoreRef.current = restore.nonce;
      setValue(restore.text);
    }
  }, [restore]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="sticky bottom-0 z-10 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur-sm px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          className={cn(
            "flex-1 resize-none rounded-md border border-zinc-700/60 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100",
            "placeholder:text-zinc-600 focus:border-amber-700/50 focus:outline-none focus:ring-1 focus:ring-amber-800/30",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "scrollbar-thin scrollbar-thumb-zinc-700"
          )}
          aria-label="Message input"
        />
        {onIllustrate && !isMultiChar && (
          <button
            type="button"
            onClick={() => onIllustrate()}
            disabled={disabled || illustrating}
            className={cn(
              "p-2 rounded-lg transition-colors",
              illustrating
                ? "text-amber-500 animate-pulse"
                : "text-zinc-500 hover:text-amber-400 hover:bg-zinc-800"
            )}
            title="Illustrate last scene"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        )}
        {onIllustrate && isMultiChar && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCharDropdown((v) => !v)}
              disabled={disabled || illustrating}
              className={cn(
                "flex items-center gap-0.5 p-2 rounded-lg transition-colors",
                illustrating
                  ? "text-amber-500 animate-pulse"
                  : "text-zinc-500 hover:text-amber-400 hover:bg-zinc-800"
              )}
              title="Illustrate last scene"
            >
              <ImageIcon className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {showCharDropdown && (
              <div className="absolute bottom-full mb-1 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg py-1 min-w-[180px] z-10">
                {characters!.map((char) => (
                  <button
                    key={char.id}
                    onClick={() => { onIllustrate(char.id); setShowCharDropdown(false); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    {char.name}
                  </button>
                ))}
                <div className="border-t border-zinc-700 my-0.5" />
                <button
                  onClick={() => { onIllustrate(null); setShowCharDropdown(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-700 transition-colors"
                >
                  Scene (no focus)
                </button>
              </div>
            )}
          </div>
        )}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            "shrink-0 flex items-center justify-center rounded-md h-10 w-10",
            "transition-colors",
            canSend
              ? "bg-amber-700 text-zinc-100 hover:bg-amber-600"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          )}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {disabled && (
        <p className="mt-1 flex items-center gap-2 text-[11px] text-zinc-600 italic">
          The narrator is writing…
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="not-italic text-[10px] text-red-600 hover:text-red-400"
            >
              Stop
            </button>
          )}
        </p>
      )}
    </div>
  );
});
