"use client";

import Link from "next/link";
import { Plus, ScrollText, Play, Clock } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { SESSION_STATUS_LABELS } from "@/lib/constants";
import type { Session } from "@/types";

interface SessionsSectionProps {
  campaignId: string;
  sessions: Array<Pick<Session, "id" | "title" | "status" | "startedAt">> | undefined;
  isLoading: boolean;
  onNewSession: () => void;
  isCreating: boolean;
  /** Message of the failed create mutation, shown under the header. */
  createError?: string;
}

export function SessionsSection({
  campaignId,
  sessions,
  isLoading,
  onNewSession,
  isCreating,
  createError,
}: SessionsSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
            Sessions
          </h2>
        </div>
        <button
          onClick={onNewSession}
          disabled={isCreating}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-colors"
          )}
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {createError && (
        <p role="alert" className="mb-3 text-xs text-destructive">{createError}</p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 bg-muted animate-pulse rounded-md"
            />
          ))}
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-8 text-center">
          <ScrollText className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground mb-3">
            No sessions yet
          </p>
          <button
            onClick={onNewSession}
            disabled={isCreating}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md",
              "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]",
              "hover:opacity-90 transition-opacity",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Play className="h-3 w-3" />
            Start First Session
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/campaigns/${campaignId}/sessions/${session.id}`}
              className={cn(
                "block p-3 border border-border/50 rounded-md",
                "hover:border-border hover:bg-accent/30 transition-colors",
                "group"
              )}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-sm">
                  {session.title}
                </span>
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    session.status === "active"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {SESSION_STATUS_LABELS[session.status]}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{timeAgo(session.startedAt)}</span>
                {session.status === "active" && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[hsl(var(--genre-accent))] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-3 w-3" />
                    Resume
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
