"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

interface JournalSectionProps {
  journal: string | null | undefined;
}

export function JournalSection({ journal }: JournalSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mt-8">
      <div
        className={cn(
          "border rounded-md",
          "border-amber-800/20 bg-amber-950/10"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-amber-800/20">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-amber-500/70" />
            <h2 className="font-semibold text-sm uppercase tracking-wider text-amber-400/70">
              Campaign Journal
            </h2>
          </div>
          {journal && journal.length > 500 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md",
                "text-amber-400/60 hover:text-amber-300/80 hover:bg-amber-900/20",
                "transition-colors"
              )}
              aria-label={expanded ? "Collapse journal" : "Expand journal"}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Expand
                </>
              )}
            </button>
          )}
        </div>

        <div className="px-4 py-4">
          {!journal ? (
            <p className="text-sm text-amber-400/40 italic">
              No journal entries yet. Play a session to begin chronicling your adventure.
            </p>
          ) : (
            <div
              className={cn(
                "text-amber-100/80 overflow-hidden transition-all duration-300",
                journal.length > 500 && !expanded
                  ? "max-h-48 relative"
                  : "max-h-none"
              )}
            >
              <MarkdownRenderer content={journal} />
              {journal.length > 500 && !expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[hsl(var(--card)/0.8)] via-[hsl(var(--card)/0.4)] to-transparent pointer-events-none" />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
