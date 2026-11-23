"use client";

import { Users, Eye, EyeOff, Clock, MessageSquare, Scroll } from "lucide-react";
import type { NPCMemoryDoc } from "@/types";
import { DispositionBar } from "./disposition-bar";

export function RelationshipsSection({ relationships }: { relationships: NPCMemoryDoc["relationships"] }) {
  return (
    <section className="p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        <Users className="h-3 w-3" />
        Relationships
      </h3>
      <div className="space-y-2.5">
        {relationships.map((rel, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr] gap-3 items-center">
            <div>
              <span className="text-sm font-medium">{rel.target}</span>
              {rel.lastInteraction && (
                <p className="text-xs text-muted-foreground truncate">
                  {rel.lastInteraction}
                </p>
              )}
            </div>
            <DispositionBar value={rel.disposition} />
          </div>
        ))}
      </div>
    </section>
  );
}

interface SecretsSectionProps {
  secrets: string[];
  revealedInfo: string[] | null | undefined;
  visible: boolean;
  onToggle: () => void;
}

export function SecretsSection({ secrets, revealedInfo, visible, onToggle }: SecretsSectionProps) {
  return (
    <section className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Eye className="h-3 w-3" />
          Secrets ({secrets.length})
        </h3>
        <button
          onClick={onToggle}
          className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          {visible ? (
            <>
              <EyeOff className="h-3 w-3" />
              Hide
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" />
              Reveal
            </>
          )}
        </button>
      </div>
      <ul className="space-y-1.5">
        {secrets.map((secret, i) => (
          <li key={i} className="text-sm">
            {visible ? (
              <span className="text-zinc-300">{secret}</span>
            ) : (
              <span className="inline-block text-transparent bg-zinc-700 rounded select-none cursor-default text-xs px-1">
                {secret.replace(/./g, "█")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {revealedInfo && revealedInfo.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-1.5 font-medium">Revealed to player:</p>
          <ul className="space-y-1">
            {revealedInfo.map((info, i) => (
              <li key={i} className="text-xs text-zinc-400">
                • {info}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function MemoryLogSection({ memoryLog }: { memoryLog: NPCMemoryDoc["memoryLog"] }) {
  return (
    <section className="p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        <Clock className="h-3 w-3" />
        Memory Log
      </h3>
      <ol className="relative border-l border-zinc-700 ml-2 space-y-4">
        {memoryLog.map((entry, i) => (
          <li key={i} className="ml-4">
            <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-zinc-600 bg-zinc-800" />
            <p className="text-sm text-zinc-300 leading-relaxed">{entry.summary}</p>
            {entry.emotionalShift && (
              <p className="text-xs text-amber-400/80 mt-0.5 italic">
                {entry.emotionalShift}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DeepHistorySection({ deepHistory }: { deepHistory: string }) {
  return (
    <section className="p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        <Scroll className="h-3 w-3" />
        Deep History
      </h3>
      <p className="text-sm text-zinc-400 leading-relaxed">{deepHistory}</p>
    </section>
  );
}

export function SpeechSection({ speechPattern, vocabulary }: { speechPattern: string | null; vocabulary: string | null }) {
  return (
    <section className="p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        <MessageSquare className="h-3 w-3" />
        Speech
      </h3>
      <div className="space-y-2">
        {speechPattern && (
          <div>
            <span className="text-xs text-muted-foreground">Pattern: </span>
            <span className="text-sm text-zinc-300">{speechPattern}</span>
          </div>
        )}
        {vocabulary && (
          <div>
            <span className="text-xs text-muted-foreground">Vocabulary: </span>
            <span className="text-sm text-zinc-300">{vocabulary}</span>
          </div>
        )}
      </div>
    </section>
  );
}
