"use client";

import { memo } from "react";
import type { QuickAction } from "@/types";
import { cn } from "@/lib/utils";
import {
  Sword,
  Search,
  MessageCircle,
  Sparkles,
  Moon,
  Crosshair,
  Scan,
  Terminal,
  Handshake,
  Cpu,
  EyeOff,
  Footprints,
  ShieldAlert,
  Package,
  Tent,
  Shield,
  Zap,
  Ear,
  Skull,
  ArrowRight,
} from "lucide-react";

interface QuickActionsProps {
  actions: QuickAction[];
  onAction: (action: QuickAction) => void;
  disabled?: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  // English
  Attack: Sword,
  Investigate: Search,
  Talk: MessageCircle,
  "Cast Spell": Sparkles,
  Rest: Moon,
  Shoot: Crosshair,
  Scan: Scan,
  Hack: Terminal,
  Negotiate: Handshake,
  "Use Tech": Cpu,
  Hide: EyeOff,
  Run: Footprints,
  Barricade: ShieldAlert,
  Search: Search,
  Fight: Sword,
  Scavenge: Package,
  Trade: Handshake,
  Sneak: EyeOff,
  Camp: Tent,
  Defend: Shield,
  Listen: Ear,
  Intimidate: Skull,
  Evade: ArrowRight,
  // Spanish
  Atacar: Sword,
  Investigar: Search,
  Hablar: MessageCircle,
  Hechizo: Sparkles,
  Descansar: Moon,
  Disparar: Crosshair,
  Escanear: Scan,
  Hackear: Terminal,
  Negociar: Handshake,
  "Usar Tech": Cpu,
  Esconderme: EyeOff,
  Huir: Footprints,
  Barricada: ShieldAlert,
  Buscar: Search,
  Pelear: Sword,
  Saquear: Package,
  Comerciar: Handshake,
  Sigilo: EyeOff,
  Acampar: Tent,
  Defender: Shield,
  Escuchar: Ear,
  Intimidar: Skull,
  Evadir: ArrowRight,
};

function getIcon(label: string) {
  const Icon = ICON_MAP[label];
  return Icon ? <Icon className="h-3 w-3" /> : <Zap className="h-3 w-3" />;
}

export const QuickActions = memo(function QuickActions({ actions, onAction, disabled }: QuickActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5 sm:px-4 scrollbar-none">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action)}
          disabled={disabled}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-md border border-zinc-700/50",
            "bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-400",
            "hover:border-amber-800/40 hover:text-amber-300 hover:bg-zinc-800/80",
            "transition-colors whitespace-nowrap",
            disabled && "opacity-40 pointer-events-none"
          )}
        >
          {getIcon(action.label)}
          {action.label}
        </button>
      ))}
    </div>
  );
});
