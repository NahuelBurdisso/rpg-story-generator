"use client";

import { type ReactNode, use } from "react";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/layout/app-header";
import { CampaignNav } from "@/components/layout/campaign-nav";
import { cn } from "@/lib/utils";
import { GENRE_CLASS } from "@/lib/constants";
import Link from "next/link";

function CampaignNavSkeleton() {
  return (
    <div className="border-b border-border/40 bg-background">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      </div>
    </div>
  );
}

function CampaignNotFound() {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <h2 className="text-lg font-semibold text-zinc-200 mb-2">Campaign not found</h2>
          <p className="text-sm text-zinc-500 mb-4">This campaign may have been deleted or the link is invalid.</p>
          <Link href="/dashboard" className="text-sm text-blue-400 hover:text-blue-300 underline">
            Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function CampaignLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const { data: campaign, error: campaignError } = trpc.campaigns.get.useQuery({ id: campaignId });

  if (campaignError) return <CampaignNotFound />;

  // The pages render (and start their own queries) while the campaign loads, so everything goes out in one batch.
  return (
    <div className={cn("flex flex-col min-h-screen", campaign && GENRE_CLASS[campaign.genre])}>
      <AppHeader />
      {campaign ? <CampaignNav campaignId={campaignId} campaignName={campaign.name} /> : <CampaignNavSkeleton />}
      <main className="flex-1">{children}</main>
    </div>
  );
}
