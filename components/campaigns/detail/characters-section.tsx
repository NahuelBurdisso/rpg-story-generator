"use client";

import Link from "next/link";
import { Plus, Users, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Character } from "@/types";

interface CharactersSectionProps {
  campaignId: string;
  characters: Array<Pick<Character, "id" | "name" | "role" | "stats">> | undefined;
  isLoading: boolean;
}

export function CharactersSection({ campaignId, characters, isLoading }: CharactersSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
            Characters
          </h2>
        </div>
        <Link
          href={`/campaigns/${campaignId}/characters/new`}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "transition-colors"
          )}
        >
          <Plus className="h-3 w-3" />
          Add
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 bg-muted animate-pulse rounded-md"
            />
          ))}
        </div>
      ) : !characters || characters.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-8 text-center">
          <Shield className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground mb-3">
            No characters yet
          </p>
          <Link
            href={`/campaigns/${campaignId}/characters/new`}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
              "border border-border text-foreground",
              "hover:bg-accent transition-colors"
            )}
          >
            <Plus className="h-3 w-3" />
            Create Character
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {characters.map((char) => (
            <Link
              key={char.id}
              href={`/campaigns/${campaignId}/characters/${char.id}`}
              className={cn(
                "block p-3 border border-border/50 rounded-md",
                "hover:border-border hover:bg-accent/30 transition-colors"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">
                    {char.name}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {char.role}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {Object.entries(char.stats)
                    .slice(0, 3)
                    .map(([k, v]) => `${k.slice(0, 3)} ${v}`)
                    .join(" / ")}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
