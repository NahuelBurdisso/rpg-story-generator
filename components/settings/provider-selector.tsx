"use client";

import type { LLMProvider } from "@/types";
import { cn } from "@/lib/utils";
import { Server, Cloud, Brain } from "lucide-react";

interface ProviderSelectorProps {
  current: LLMProvider;
  onChange: (provider: LLMProvider) => void;
}

const PROVIDERS: Array<{
  value: LLMProvider;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    value: "ollama",
    label: "Ollama",
    description: "Local models, no API key needed",
    icon: Server,
  },
  {
    value: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4, GPT-3.5",
    icon: Cloud,
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Claude Sonnet, Haiku, Opus",
    icon: Brain,
  },
];

export function ProviderSelector({ current, onChange }: ProviderSelectorProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
        LLM Provider
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map(({ value, label, description, icon: Icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              className={cn(
                "flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                selected
                  ? "border-amber-700/50 bg-amber-950/20 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
              )}
              role="radio"
              aria-checked={selected}
            >
              <Icon
                className={cn(
                  "h-5 w-5 mt-0.5 shrink-0",
                  selected ? "text-amber-500" : "text-zinc-600"
                )}
              />
              <div className="min-w-0">
                <span className="text-sm font-medium block">{label}</span>
                <span className="text-[11px] text-zinc-600 leading-snug block mt-0.5">
                  {description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
