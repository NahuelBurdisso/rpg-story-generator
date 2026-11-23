"use client";

import { memo, useState } from "react";
import type { Character, Campaign } from "@/types";
import StatBlock from "./stat-block";
import InventoryList from "./inventory-list";
import { cn } from "@/lib/utils";
import { User, Scroll } from "lucide-react";

interface CharacterSheetProps {
  character?: Character;
  characters?: Character[];
  campaign: Campaign;
  className?: string;
}

function SingleCharacterPanel({ character, campaign }: { character: Character; campaign: Campaign }) {
  return (
    <>
      {/* Portrait — prominent, full width */}
      {character.portraitUrl ? (
        <div className="relative w-full aspect-[3/4] overflow-hidden">
          <img
            src={character.portraitUrl}
            alt={`Portrait of ${character.name}`}
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay for name legibility */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-zinc-950 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
            <h3 className="text-sm font-semibold text-zinc-100 truncate drop-shadow-md">
              {character.name}
            </h3>
            <p className="text-xs text-zinc-400 drop-shadow-md">{character.role}</p>
          </div>
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] bg-zinc-900/60 flex flex-col items-center justify-center gap-2 border-b border-zinc-800/50">
          <User className="h-10 w-10 text-zinc-800" />
          <span className="text-[10px] text-zinc-700">No portrait</span>
          {/* Name below placeholder */}
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">
              {character.name}
            </h3>
            <p className="text-xs text-zinc-500">{character.role}</p>
          </div>
        </div>
      )}

      {/* Status notes */}
      {character.statusNotes && (
        <div className="px-4 pt-2 pb-1">
          <p className="text-xs text-amber-400/70 italic leading-relaxed">
            {character.statusNotes}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-3 border-b border-zinc-800/50">
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-600 mb-2">Stats</h4>
        <StatBlock
          stats={character.stats}
          statDefinitions={campaign.statDefinitions}
          compact
        />
      </div>

      {/* Inventory */}
      <div className="px-4 py-3 border-b border-zinc-800/50 flex-1">
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-600 mb-2">
          Inventory
          {character.inventory.length > 0 && (
            <span className="ml-1 text-zinc-700">({character.inventory.length})</span>
          )}
        </h4>
        <InventoryList items={character.inventory} />
      </div>

      {/* Backstory */}
      {character.backstory && (
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Scroll className="h-3 w-3 text-zinc-600" />
            <h4 className="text-[11px] uppercase tracking-wider text-zinc-600">Backstory</h4>
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed line-clamp-6">
            {character.backstory}
          </p>
        </div>
      )}
    </>
  );
}

function CharacterSheet({ character, characters, campaign, className }: CharacterSheetProps) {
  // Normalise to an array — support both single and multi-character callers
  const chars: Character[] = characters && characters.length > 0
    ? characters
    : character
    ? [character]
    : [];

  const [activeIndex, setActiveIndex] = useState(0);
  const activeChar = chars[activeIndex] ?? null;

  return (
    <div
      className={cn(
        "flex flex-col h-full overflow-y-auto bg-zinc-950 border-l border-zinc-800/60",
        className
      )}
    >
      {/* Tabs — only shown when there are multiple characters */}
      {chars.length > 1 && (
        <div className="flex border-b border-zinc-800/50 overflow-x-auto">
          {chars.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "flex-1 min-w-0 px-3 py-2 text-[11px] font-medium truncate transition-colors",
                i === activeIndex
                  ? "text-zinc-100 border-b-2 border-amber-500 bg-zinc-900/60"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30"
              )}
              title={c.name}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {activeChar ? (
        <SingleCharacterPanel character={activeChar} campaign={campaign} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-zinc-600">No characters.</p>
        </div>
      )}
    </div>
  );
}

export default memo(CharacterSheet);
