"use client";

import { labelClass } from "@/components/ui/form-styles";

interface StatsEditorProps {
  stats: Record<string, number>;
  statDefinitions: string[];
  onChange: (stats: Record<string, number>) => void;
}

const clamp = (n: number) => Math.max(1, Math.min(30, n));

export function StatsEditor({ stats, statDefinitions, onChange }: StatsEditorProps) {
  function handleStatChange(statName: string, delta: number) {
    onChange({ ...stats, [statName]: clamp((stats[statName] ?? 10) + delta) });
  }

  function handleStatDirect(statName: string, value: string) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      onChange({ ...stats, [statName]: clamp(num) });
    }
  }

  return (
    <div>
      <span className={labelClass}>Stats</span>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[...statDefinitions, ...Object.keys(stats).filter((s) => !statDefinitions.includes(s))].map((statName) => (
          <div
            key={statName}
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1.5"
          >
            <span className="flex-1 text-xs text-muted-foreground truncate">{statName}</span>
            <button
              type="button"
              onClick={() => handleStatChange(statName, -1)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors"
              aria-label={`Decrease ${statName}`}
            >
              -
            </button>
            <input
              type="number"
              value={stats[statName] ?? 10}
              onChange={(e) => handleStatDirect(statName, e.target.value)}
              className="w-9 rounded border border-input bg-background text-center text-sm py-0.5 focus:outline-none focus:border-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={1}
              max={30}
            />
            <button
              type="button"
              onClick={() => handleStatChange(statName, 1)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors"
              aria-label={`Increase ${statName}`}
            >
              +
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
