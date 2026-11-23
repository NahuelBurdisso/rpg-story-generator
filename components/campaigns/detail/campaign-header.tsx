"use client";

import Link from "next/link";
import { Pencil, Trash2, Brain, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENRE_OPTIONS, TONE_OPTIONS, DIFFICULTY_OPTIONS, optionLabel } from "@/lib/constants";
import type { Campaign } from "@/types";

interface CampaignHeaderProps {
  campaign: Pick<Campaign, "id" | "name" | "genre" | "tone" | "difficulty" | "imageEnabled">;
  onDelete: () => void;
}

export function CampaignHeader({ campaign, onDelete }: CampaignHeaderProps) {
  const campaignId = campaign.id;
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          {campaign.name}
        </h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="genre-badge">{optionLabel(GENRE_OPTIONS, campaign.genre)}</span>
          <span>{optionLabel(TONE_OPTIONS, campaign.tone)}</span>
          <span className="w-px h-3 bg-border" />
          <span>{optionLabel(DIFFICULTY_OPTIONS, campaign.difficulty)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/campaigns/${campaignId}/npcs`}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
            "border border-amber-800/40 text-amber-400/80",
            "hover:text-amber-300 hover:bg-amber-900/20 transition-colors"
          )}
        >
          <Brain className="h-3 w-3" />
          NPCs
        </Link>
        {campaign.imageEnabled && (
          <Link
            href={`/campaigns/${campaignId}/gallery`}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
              "border border-violet-800/40 text-violet-400/80",
              "hover:text-violet-300 hover:bg-violet-900/20 transition-colors"
            )}
          >
            <Images className="h-3 w-3" />
            Gallery
          </Link>
        )}
        <Link
          href={`/campaigns/${campaignId}/edit`}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
            "border border-border text-muted-foreground",
            "hover:text-foreground hover:bg-accent transition-colors"
          )}
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Link>
        <button
          onClick={onDelete}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
            "border border-destructive/30 text-destructive",
            "hover:bg-destructive/10 transition-colors"
          )}
          aria-label="Delete campaign"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}
