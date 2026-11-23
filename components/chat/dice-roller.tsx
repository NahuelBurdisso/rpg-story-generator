"use client";

import { memo, useState } from "react";
import { Dices, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DICE_TYPE_OPTIONS } from "@/lib/constants";
import { rollDice } from "@/lib/dice";
import type { DiceRoll, DiceType } from "@/types";

interface DiceRollerProps {
  onRoll: (roll: DiceRoll) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const DICE_LABELS: Record<DiceType, { symbol: string; sides: string }> = {
  d4: { symbol: "\u25B3", sides: "4" },
  d6: { symbol: "\u25A0", sides: "6" },
  d8: { symbol: "\u25C6", sides: "8" },
  d10: { symbol: "\u2B23", sides: "10" },
  d12: { symbol: "\u2B21", sides: "12" },
  d20: { symbol: "\u2B22", sides: "20" },
};

export const DiceRoller = memo(function DiceRoller({ onRoll, isOpen, onToggle }: DiceRollerProps) {
  const [lastRoll, setLastRoll] = useState<{ dice: DiceType; result: number } | null>(null);
  const [rolling, setRolling] = useState(false);

  function handleRoll(dice: DiceType) {
    setRolling(true);
    // Brief animation delay
    setTimeout(() => {
      const result = rollDice(dice);
      setLastRoll({ dice, result });
      onRoll({ dice, result });
      setRolling(false);
    }, 200);
  }

  return (
    <div className="border-t border-zinc-800/60">
      <button
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-500",
          "hover:text-zinc-300 transition-colors",
          isOpen && "text-zinc-300"
        )}
        aria-label={isOpen ? "Close dice roller" : "Open dice roller"}
        aria-expanded={isOpen}
      >
        <Dices className="h-3.5 w-3.5" />
        <span>Dice</span>
        {lastRoll && !isOpen && (
          <span className="ml-1 text-amber-400/70 font-mono text-[11px]">
            {lastRoll.dice}={lastRoll.result}
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="ml-auto h-3 w-3" />
        ) : (
          <ChevronUp className="ml-auto h-3 w-3" />
        )}
      </button>

      {isOpen && (
        <div className="flex items-center gap-2 px-3 pb-2">
          {DICE_TYPE_OPTIONS.map((dice) => {
            const label = DICE_LABELS[dice];
            return (
              <button
                key={dice}
                onClick={() => handleRoll(dice)}
                disabled={rolling}
                className={cn(
                  "flex flex-col items-center justify-center rounded-md border",
                  "h-11 w-11 sm:h-12 sm:w-12 transition-all",
                  "border-zinc-700/50 bg-zinc-800/40 text-zinc-400",
                  "hover:border-amber-700/50 hover:bg-zinc-800 hover:text-amber-300",
                  "active:scale-95",
                  rolling && "opacity-50 cursor-wait",
                  lastRoll?.dice === dice && "border-amber-700/60 text-amber-300"
                )}
                aria-label={`Roll ${dice}`}
              >
                <span className="text-sm leading-none">{label.symbol}</span>
                <span className="text-[10px] font-mono mt-0.5 opacity-60">d{label.sides}</span>
              </button>
            );
          })}
          {lastRoll && (
            <div className="ml-2 flex flex-col items-center">
              <span className="text-[10px] text-zinc-600 uppercase">{lastRoll.dice}</span>
              <span className="text-lg font-mono font-bold text-amber-300">{lastRoll.result}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
