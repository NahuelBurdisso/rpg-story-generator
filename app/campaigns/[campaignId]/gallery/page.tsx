"use client";

import { use, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { SessionGroup } from "@/components/gallery/session-group";
import { ImageOff } from "lucide-react";

export default function CampaignGalleryPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);

  const { data: images, isLoading } = trpc.images.listByCampaignGrouped.useQuery({ campaignId });

  const groups = useMemo(() => {
    if (!images) return [];
    type Row = (typeof images)[number];
    const map = new Map<string, Row[]>();
    for (const img of images) {
      const list = map.get(img.sessionId) ?? [];
      list.push(img);
      map.set(img.sessionId, list);
    }
    return Array.from(map.entries()).map(([sessionId, imgs]) => ({
      sessionId,
      sessionTitle: imgs[0].sessionTitle,
      images: imgs,
    }));
  }, [images]);

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-lg font-bold tracking-tight">Gallery</h1>
        <p className="text-xs text-zinc-500 mt-1">All illustrations across sessions</p>
      </div>

      {isLoading ? (
        <div className="space-y-8">
          {[1, 2].map((i) => (
            <div key={i}>
              <div className="h-4 w-40 bg-zinc-800 animate-pulse rounded mb-3" />
              <div className="flex gap-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="w-[250px] aspect-video bg-zinc-800 animate-pulse rounded-lg shrink-0" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-lg py-16 text-center">
          <ImageOff className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No illustrations generated in this campaign yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <SessionGroup
              key={g.sessionId}
              sessionId={g.sessionId}
              sessionTitle={g.sessionTitle}
              campaignId={campaignId}
              images={g.images}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
