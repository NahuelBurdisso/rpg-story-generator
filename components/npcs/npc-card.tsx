"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NPCMemoryDoc } from "@/types";
import {
  RelationshipsSection,
  SecretsSection,
  MemoryLogSection,
  DeepHistorySection,
  SpeechSection,
} from "./npc-sections";

export function NpcCard({ npc }: { npc: NPCMemoryDoc }) {
  const [expanded, setExpanded] = useState(false);
  const [secretsVisible, setSecretsVisible] = useState(false);

  const shortPersonality = npc.personality.length > 80
    ? npc.personality.slice(0, 80) + "…"
    : npc.personality;

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-start gap-3 p-4 text-left",
          "hover:bg-accent/20 transition-colors",
          expanded && "bg-accent/10"
        )}
        aria-expanded={expanded}
      >
        <div className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{npc.name}</span>
            {npc.location && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {npc.location}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {expanded ? npc.personality : shortPersonality}
          </p>
        </div>
        <div className="ml-2 shrink-0 text-right">
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {npc.currentState}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/40 bg-zinc-900/30 divide-y divide-border/30">
          {npc.relationships && npc.relationships.length > 0 && (
            <RelationshipsSection relationships={npc.relationships} />
          )}
          {npc.secrets && npc.secrets.length > 0 && (
            <SecretsSection
              secrets={npc.secrets}
              revealedInfo={npc.revealedInfo}
              visible={secretsVisible}
              onToggle={() => setSecretsVisible((v) => !v)}
            />
          )}
          {npc.memoryLog && npc.memoryLog.length > 0 && <MemoryLogSection memoryLog={npc.memoryLog} />}
          {npc.deepHistory && <DeepHistorySection deepHistory={npc.deepHistory} />}
          {(npc.speechPattern || npc.vocabulary) && (
            <SpeechSection speechPattern={npc.speechPattern} vocabulary={npc.vocabulary} />
          )}
        </div>
      )}
    </div>
  );
}
