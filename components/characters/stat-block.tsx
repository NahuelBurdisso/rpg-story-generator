"use client";

import { maxHpValue } from "@/lib/stats";

interface StatBlockProps {
  stats: Record<string, number>;
  statDefinitions: string[];
  compact?: boolean;
}

function statColor(value: number): string {
  if (value >= 18) return "text-amber-400";
  if (value >= 14) return "text-emerald-400";
  if (value >= 10) return "text-zinc-200";
  if (value >= 6) return "text-orange-400";
  return "text-red-400";
}

function barWidth(value: number, maxValue: number): string {
  const pct = Math.min(Math.max((value / maxValue) * 100, 5), 100);
  return `${pct}%`;
}

function barColor(value: number): string {
  if (value >= 18) return "bg-amber-600/60";
  if (value >= 14) return "bg-emerald-700/60";
  if (value >= 10) return "bg-zinc-600/60";
  if (value >= 6) return "bg-orange-700/60";
  return "bg-red-800/60";
}

export default function StatBlock({ stats, statDefinitions, compact }: StatBlockProps) {
  const orderedStats = statDefinitions.filter((s) => s in stats);
  // Also show any stats not in definitions
  const extraStats = Object.keys(stats).filter((s) => !statDefinitions.includes(s));
  const allStats = [...orderedStats, ...extraStats];

  if (allStats.length === 0) {
    return <p className="text-xs text-zinc-600">No stats defined.</p>;
  }

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {allStats.map((name) => (
          <div key={name} className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 truncate mr-2">{name}</span>
            <span className={statColor(stats[name])}>{stats[name]}</span>
          </div>
        ))}
      </div>
    );
  }

  // Detect max value for bar scaling: use the highest value across all stats, min 20
  const allValues = allStats.map((s) => stats[s]);
  const detectedMax = Math.max(20, ...allValues);

  // Special HP handling: use MaxHP as scale and health-specific colors
  const maxHp = maxHpValue(stats);
  const isHpStat = (name: string) => name === "HP" || name === "hp";
  function hpColor(current: number, max: number): { text: string; bar: string } {
    const pct = max > 0 ? current / max : 1;
    if (pct <= 0) return { text: "text-red-500", bar: "bg-red-700/80" };
    if (pct <= 0.25) return { text: "text-red-400", bar: "bg-red-600/70" };
    if (pct <= 0.5) return { text: "text-orange-400", bar: "bg-orange-600/60" };
    if (pct <= 0.75) return { text: "text-yellow-400", bar: "bg-yellow-600/50" };
    return { text: "text-emerald-400", bar: "bg-emerald-600/60" };
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {allStats.map((name) => {
        const val = stats[name];
        const isHp = isHpStat(name);
        const hpMax = isHp && maxHp != null ? maxHp : detectedMax;
        const colors = isHp && maxHp != null ? hpColor(val, maxHp) : null;
        return (
          <div key={name} className="space-y-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-500 truncate">{name}</span>
              <span className={`text-sm font-mono font-medium ${colors?.text ?? statColor(val)}`}>
                {isHp && maxHp != null ? `${val}/${maxHp}` : val}
              </span>
            </div>
            <div className={`${isHp ? "h-1.5" : "h-1"} w-full rounded-full bg-zinc-800 overflow-hidden`}>
              <div
                className={`h-full rounded-full transition-all ${colors?.bar ?? barColor(val)}`}
                style={{ width: barWidth(val, hpMax) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
