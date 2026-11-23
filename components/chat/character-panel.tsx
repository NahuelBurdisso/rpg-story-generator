"use client";

import { PanelRightOpen } from "lucide-react";
import CharacterSheet from "@/components/characters/character-sheet";
import CharacterDrawer from "@/components/characters/character-drawer";
import type { Campaign, Character } from "@/types";

interface CharacterPanelProps {
  characters: Character[];
  campaign: Campaign;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

/** Desktop sidebar (or its empty placeholder) plus the mobile / tablet drawer. */
export function CharacterPanel({ characters, campaign, drawerOpen, onCloseDrawer }: CharacterPanelProps) {
  const hasCharacters = characters.length > 0;
  return (
    <>
      {/* Desktop sidebar - character sheet */}
      {hasCharacters && (
        <div className="hidden lg:flex lg:w-[35%] lg:max-w-[380px] lg:min-w-[280px]">
          <CharacterSheet characters={characters} campaign={campaign} />
        </div>
      )}

      {/* Desktop sidebar placeholder when no character */}
      {!hasCharacters && (
        <div className="hidden lg:flex lg:items-center lg:justify-center lg:w-[280px] border-l border-zinc-800/60 bg-zinc-950">
          <div className="text-center px-4">
            <PanelRightOpen className="h-6 w-6 mx-auto text-zinc-700 mb-2" />
            <p className="text-xs text-zinc-600">No character created for this campaign yet.</p>
          </div>
        </div>
      )}

      {/* Mobile / tablet drawer */}
      {hasCharacters && (
        <CharacterDrawer
          characters={characters}
          campaign={campaign}
          isOpen={drawerOpen}
          onClose={onCloseDrawer}
        />
      )}
    </>
  );
}
