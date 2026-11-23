"use client";

import type { DiceRoll } from "@/types";
import { cn } from "@/lib/utils";

interface DiceResultProps {
  diceRoll: DiceRoll;
}

function diceIcon(dice: string): string {
  const map: Record<string, string> = {
    d4: "\u25B3",
    d6: "\u25A0",
    d8: "\u25C6",
    d10: "\u2B23",
    d12: "\u2B21",
    d20: "\u2B22",
  };
  return map[dice] ?? "\u25CF";
}

function isHighRoll(dice: string, result: number): boolean {
  const sides = parseInt(dice.replace("d", ""), 10);
  return !isNaN(sides) && result >= sides * 0.8;
}

function isLowRoll(result: number): boolean {
  return result === 1;
}

export function DiceResult({ diceRoll }: DiceResultProps) {
  const high = isHighRoll(diceRoll.dice, diceRoll.result);
  const low = isLowRoll(diceRoll.result);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono font-semibold border",
        high
          ? "bg-amber-900/40 border-amber-600/40 text-amber-300"
          : low
            ? "bg-red-900/40 border-red-700/40 text-red-300"
            : "bg-zinc-800/60 border-zinc-700/40 text-zinc-300"
      )}
    >
      <span className="text-[10px] opacity-70">{diceIcon(diceRoll.dice)}</span>
      <span className="uppercase text-[10px] text-zinc-500">{diceRoll.dice}</span>
      <span className={cn(high ? "text-amber-200" : low ? "text-red-200" : "text-zinc-100")}>
        {diceRoll.result}
      </span>
    </span>
  );
}
