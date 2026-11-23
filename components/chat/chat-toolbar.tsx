"use client";

import Link from "next/link";
import { User, LogOut, Images } from "lucide-react";

interface ChatToolbarProps {
  campaignName: string;
  /** Show the gallery link (campaign has image generation on). */
  imageEnabled: boolean;
  galleryHref: string;
  isCompleted: boolean;
  /** True while ending is not allowed (ending, streaming or a turn in flight). */
  endDisabled: boolean;
  onEndSession: () => void;
  /** Characters of the campaign; the mobile bar shows the sheet toggle when there are any. */
  characterNames: string[];
  onOpenDrawer: () => void;
}

/** Mobile header, desktop gallery bar and desktop End Session bar. */
export function ChatToolbar({
  campaignName,
  imageEnabled,
  galleryHref,
  isCompleted,
  endDisabled,
  onEndSession,
  characterNames,
  onOpenDrawer,
}: ChatToolbarProps) {
  const hasCharacters = characterNames.length > 0;
  return (
    <>
      {/* Mobile header with character toggle */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2 lg:hidden">
        <h2 className="text-sm font-medium text-zinc-300 truncate">
          {campaignName}
        </h2>
        <div className="flex items-center gap-2">
          {!isCompleted && (
            <button
              onClick={onEndSession}
              disabled={endDisabled}
              className="flex items-center gap-1.5 rounded-md border border-red-900/50 bg-red-950/30 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 hover:border-red-800/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="End session"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
          {imageEnabled && (
            <Link
              href={galleryHref}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              aria-label="Image gallery"
            >
              <Images className="h-3.5 w-3.5" />
            </Link>
          )}
          {hasCharacters && (
            <button
              onClick={onOpenDrawer}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              aria-label="Open character sheet"
            >
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {characterNames.length === 1 ? characterNames[0] : `Party (${characterNames.length})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Desktop Gallery bar */}
      {imageEnabled && (
        <div className="hidden lg:flex items-center border-b border-zinc-800/60 px-4 py-2">
          <Link
            href={galleryHref}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <Images className="h-3.5 w-3.5" />
            <span>Gallery</span>
          </Link>
        </div>
      )}

      {/* Desktop End Session bar */}
      {!isCompleted && (
        <div className="hidden lg:flex items-center justify-end border-b border-zinc-800/60 px-4 py-2">
          <button
            onClick={onEndSession}
            disabled={endDisabled}
            className="flex items-center gap-1.5 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:border-red-800/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>End Session</span>
          </button>
        </div>
      )}
    </>
  );
}
