"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { NarrativeRenderer } from "./narrative-renderer";
import { StreamingIndicator } from "./streaming-indicator";
import { DiceResult } from "./dice-result";
import { RetryButton } from "./retry-button";
import { SceneImage } from "./scene-image";
import type { Message, MechanicRoll } from "@/types";
import type { CharacterLink } from "@/lib/character-links";
import { stripRollSuffix } from "@/lib/dice";
import { AlertTriangle, ScrollText } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  onRetry?: (message: Message) => void;
  characterLinks?: CharacterLink[];
  /** Play the entry animation when the bubble mounts (read once, at mount). */
  animate?: boolean;
}

const NO_LINKS: CharacterLink[] = [];

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const OUTCOME_ICON: Record<MechanicRoll["outcome"], string> = {
  success: "🎲",
  failure: "🎲",
  neutral: "🎲",
  critical: "⚡",
  fumble: "💀",
};

const OUTCOME_STYLE: Record<MechanicRoll["outcome"], string> = {
  success: "text-emerald-400/80",
  failure: "text-red-400/80",
  neutral: "text-zinc-400",
  critical: "text-amber-300",
  fumble: "text-red-500",
};

export const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
  characterLinks = NO_LINKS,
  animate = true,
}: MessageBubbleProps) {
  // Frozen at mount: a later prop change must not add the animation class to a bubble already on screen.
  const [animateIn] = useState(animate);
  const diceRoll = message.metadata?.diceRoll;
  const mechanics = message.metadata?.mechanics;
  const rawText = message.streamingText ?? message.content;
  // The roll is also appended to the user's text for the narrator; the card shows it.
  const displayText = diceRoll ? stripRollSuffix(rawText) : rawText;
  const isError = message.metadata?.error;

  // System message
  if (message.role === "system") {
    return (
      <div className={cn("flex justify-center py-1.5", animateIn && "animate-narrative-in")}>
        <div className="max-w-md rounded bg-zinc-800/30 px-3 py-1.5 text-center">
          <p className="text-[11px] text-zinc-600 leading-relaxed">{displayText}</p>
          <time className="text-[10px] text-zinc-700 mt-0.5 block">
            {formatTime(message.createdAt)}
          </time>
        </div>
      </div>
    );
  }

  // User message
  if (message.role === "user") {
    return (
      <div className={cn("flex justify-end py-1", animateIn && "animate-user-slide")}>
        <div className="max-w-[75%] sm:max-w-[60%]">
          <div className="rounded-lg rounded-br-sm bg-indigo-800/50 border border-indigo-700/30 px-3 py-2">
            <MarkdownRenderer content={displayText} />
            {diceRoll && (
              <div className="mt-1.5">
                <DiceResult diceRoll={diceRoll} />
              </div>
            )}
          </div>
          <time className="block text-right text-[10px] text-zinc-700 mt-0.5 pr-1">
            {formatTime(message.createdAt)}
          </time>
        </div>
      </div>
    );
  }

  // Error message from assistant
  if (isError) {
    return (
      <div className={cn("flex justify-start py-1", animateIn && "animate-narrator-slide")}>
        <div className="max-w-[85%] sm:max-w-[70%]">
          <div className="rounded-lg rounded-bl-sm border border-red-800/40 bg-red-950/30 px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-red-300 mb-0.5">
                  Something went wrong
                </p>
                <p className="text-xs text-red-400/80 leading-relaxed">
                  {message.metadata?.errorMessage ?? displayText}
                </p>
                {message.metadata?.errorType && (
                  <span className="inline-block mt-1 text-[10px] font-mono text-red-600 bg-red-950/50 rounded px-1 py-0.5">
                    {message.metadata.errorType}
                  </span>
                )}
              </div>
            </div>
            {onRetry && <RetryButton onRetry={() => onRetry(message)} />}
          </div>
          <time className="block text-[10px] text-zinc-700 mt-0.5 pl-1">
            {formatTime(message.createdAt)}
          </time>
        </div>
      </div>
    );
  }

  // Assistant / narrator message
  return (
    <div className={cn("flex justify-start py-1.5", animateIn && "animate-narrator-slide")}>
      <div className="max-w-[90%] sm:max-w-[78%]">
        {/* Narrator identity label */}
        <div className="flex items-center gap-1.5 mb-1 pl-1">
          <ScrollText className="h-3 w-3 text-amber-600/60" />
          <span className="text-[10px] font-medium tracking-wide uppercase text-amber-600/50">
            Narrator
          </span>
        </div>

        <div
          className={cn(
            "rounded-lg rounded-bl-sm border border-zinc-700/20 bg-zinc-900/80 px-4 py-3",
            "border-l-[3px] border-l-[hsl(var(--genre-accent)/0.5)]",
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
          )}
        >
          <div className="font-serif prose-narrator">
            <NarrativeRenderer content={displayText} isStreaming={message.isStreaming ?? undefined} characterLinks={characterLinks} />
          </div>
          {message.isStreaming && <StreamingIndicator />}
          {!message.isStreaming && mechanics && mechanics.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800/50 space-y-0.5">
              {mechanics.map((m, i) => (
                <p key={i} className={cn("text-xs italic", OUTCOME_STYLE[m.outcome])}>
                  {OUTCOME_ICON[m.outcome]} {m.text}
                </p>
              ))}
            </div>
          )}
          {diceRoll && (
            <div className="mt-2 pt-2 border-t border-zinc-800/50">
              <DiceResult diceRoll={diceRoll} />
            </div>
          )}
          {message.metadata?.imageId && (
            <div className="mt-2">
              <SceneImage imageId={message.metadata.imageId} />
            </div>
          )}
        </div>
        <time className="block text-[10px] text-zinc-700 mt-0.5 pl-1">
          {formatTime(message.createdAt)}
        </time>
      </div>
    </div>
  );
});
