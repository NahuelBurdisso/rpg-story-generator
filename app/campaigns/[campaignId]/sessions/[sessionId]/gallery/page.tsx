"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { ImageGallery } from "@/components/gallery/image-gallery";
import { ArrowLeft, ImageOff, RefreshCw } from "lucide-react";

export default function SessionGalleryPage({
  params,
}: {
  params: Promise<{ campaignId: string; sessionId: string }>;
}) {
  const { campaignId, sessionId } = use(params);

  const { data: campaign } = trpc.campaigns.get.useQuery({ id: campaignId });
  const { data: session } = trpc.sessions.get.useQuery({ id: sessionId });
  const {
    data: images,
    isLoading,
    refetch,
    isFetching,
  } = trpc.images.listBySessionWithContext.useQuery({ sessionId });

  const isActive = session?.status === "active";

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/campaigns/${campaignId}/sessions/${sessionId}`}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to session
          </Link>
          <h1 className="text-lg font-bold tracking-tight">
            {campaign?.name ? `${campaign.name} — ` : ""}Gallery{session ? ` — ${session.title}` : ""}
          </h1>
        </div>
        {isActive && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="aspect-video bg-zinc-800 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : !images || images.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-lg py-16 text-center">
          <ImageOff className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No illustrations generated for this session yet.</p>
        </div>
      ) : (
        <ImageGallery images={images} />
      )}
    </PageContainer>
  );
}
