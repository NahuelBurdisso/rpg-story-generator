"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { NpcCard } from "@/components/npcs/npc-card";

export default function NpcsPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);

  const { data: npcs, isLoading } = trpc.npcMemory.getByCampaign.useQuery({ campaignId });
  const { data: campaign } = trpc.campaigns.get.useQuery({ id: campaignId });

  if (isLoading) {
    return (
      <PageContainer>
        <div className="space-y-3">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-4 w-64 bg-muted animate-pulse rounded" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-md" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">NPC Memory</h1>
          <p className="text-sm text-muted-foreground">
            {campaign ? `${campaign.name} — ` : ""}
            {npcs && npcs.length > 0
              ? `${npcs.length} NPC${npcs.length === 1 ? "" : "s"} remembered by the narrator`
              : "No NPCs remembered yet"}
          </p>
        </div>
        <Link
          href={`/campaigns/${campaignId}`}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md shrink-0",
            "border border-border text-muted-foreground",
            "hover:text-foreground hover:bg-accent transition-colors"
          )}
        >
          <ChevronRight className="h-3 w-3 rotate-180" />
          Campaign
        </Link>
      </div>

      {/* NPC list */}
      {!npcs || npcs.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-16 text-center">
          <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            No NPCs remembered yet
          </p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            As you play, the narrator will automatically build memories for NPCs you interact with.
            They will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {npcs.map((npc) => (
            <NpcCard key={npc.id} npc={npc} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
