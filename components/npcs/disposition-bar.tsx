"use client";

import { cn } from "@/lib/utils";

export function DispositionBar({ value }: { value: number }) {
  const clamped = Math.max(-100, Math.min(100, value));
  const isNegative = clamped < 0;
  const isNeutral = clamped >= -20 && clamped <= 20;

  const barColor = isNeutral
    ? "bg-yellow-500"
    : isNegative
    ? "bg-red-500"
    : "bg-emerald-500";

  const labelColor = isNeutral
    ? "text-yellow-400"
    : isNegative
    ? "text-red-400"
    : "text-emerald-400";

  // Width: map -100..+100 → 0..100% centered at 50%
  const fillWidth = Math.abs(clamped);
  const fillLeft = clamped < 0; // bar grows leftward from center

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Track */}
      <div className="relative flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
        {/* Center marker */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-500 z-10" />
        {/* Fill */}
        <div
          className={cn("absolute inset-y-0 rounded-full transition-all", barColor)}
          style={{
            width: `${fillWidth / 2}%`,
            left: fillLeft ? `${50 - fillWidth / 2}%` : "50%",
          }}
        />
      </div>
      <span className={cn("text-xs font-mono w-9 text-right shrink-0", labelColor)}>
        {clamped > 0 ? `+${clamped}` : clamped}
      </span>
    </div>
  );
}
