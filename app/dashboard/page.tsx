"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { Plus, Scroll, Swords } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { GENRE_OPTIONS, TONE_OPTIONS, DIFFICULTY_OPTIONS, GENRE_CLASS } from "@/lib/constants";

export default function DashboardPage() {
  const { data: campaigns, isLoading: campaignsLoading } = trpc.campaigns.list.useQuery();

  return (
    <PageContainer>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {campaignsLoading
              ? "Loading..."
              : !campaigns || campaigns.length === 0
                ? "No campaigns yet. Create one to begin your adventure."
                : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className={cn(
            "inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md",
            "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]",
            "hover:opacity-90 transition-opacity"
          )}
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {campaignsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-md bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-16 flex flex-col items-center">
          <Scroll className="h-10 w-10 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground text-sm mb-4">
            Your story awaits. Create your first campaign.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/campaigns/new"
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md",
                "border border-border text-foreground",
                "hover:bg-accent transition-colors"
              )}
            >
              <Plus className="h-4 w-4" />
              Create Campaign
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className={cn(
                "block border border-border/60 rounded-md p-4",
                "hover:border-border hover:bg-accent/30 transition-colors",
                "group"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 mb-1">
                    <h2 className="font-semibold text-foreground truncate">
                      {campaign.name}
                    </h2>
                    <span
                      className={cn(
                        "genre-badge shrink-0",
                        GENRE_CLASS[campaign.genre]
                      )}
                    >
                      {campaign.genre === "custom" && campaign.customGenre
                        ? campaign.customGenre
                        : GENRE_OPTIONS.find((g) => g.value === campaign.genre)?.label ?? campaign.genre}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {campaign.worldDescription}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  <span>{TONE_OPTIONS.find((t) => t.value === campaign.tone)?.label ?? campaign.tone}</span>
                  <span className="w-px h-3 bg-border" />
                  <span>{DIFFICULTY_OPTIONS.find((d) => d.value === campaign.difficulty)?.label ?? campaign.difficulty}</span>
                  {campaign.lastPlayedAt && (
                    <>
                      <span className="w-px h-3 bg-border" />
                      <span>{timeAgo(campaign.lastPlayedAt)}</span>
                    </>
                  )}
                  <Swords className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-[hsl(var(--genre-accent))] transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
