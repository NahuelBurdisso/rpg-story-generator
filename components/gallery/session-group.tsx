"use client";

import { useState } from "react";
import Link from "next/link";
import { ImageCard } from "./image-card";
import { ImageLightbox } from "./image-lightbox";
import type { CampaignGalleryImage } from "@/types";

interface SessionGroupProps {
  sessionId: string;
  sessionTitle: string;
  campaignId: string;
  images: CampaignGalleryImage[];
}

export function SessionGroup({ sessionId, sessionTitle, campaignId, images }: SessionGroupProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const showViewAll = images.length > 6;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/campaigns/${campaignId}/sessions/${sessionId}`}
            className="text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            {sessionTitle}
          </Link>
          <span className="text-[10px] text-zinc-600 ml-2">
            {images.length} image{images.length !== 1 ? "s" : ""}
          </span>
        </div>
        {showViewAll && (
          <Link
            href={`/campaigns/${campaignId}/sessions/${sessionId}/gallery`}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            View all
          </Link>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700">
        {images.map((image, idx) => (
          <div key={image.id} className="shrink-0 w-[250px]">
            <ImageCard image={image} onClick={() => setSelectedIndex(idx)} />
          </div>
        ))}
      </div>

      {selectedIndex !== null && (
        <ImageLightbox
          images={images}
          currentIndex={selectedIndex}
          onNavigate={setSelectedIndex}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </section>
  );
}
