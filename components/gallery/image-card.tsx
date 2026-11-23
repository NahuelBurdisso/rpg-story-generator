"use client";

import { cn, timeAgo } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import type { GalleryImage } from "@/types";
import { TRIGGER_SHORT_LABELS } from "@/lib/constants";

interface ImageCardProps {
  image: GalleryImage;
  onClick: () => void;
}

export function ImageCard({ image, onClick }: ImageCardProps) {
  const location = image.contextSnapshot?.location;
  const aspectRatio = image.width && image.height ? image.width / image.height : 16 / 9;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-lg border border-zinc-800/60",
        "bg-zinc-900 hover:border-zinc-700 transition-colors text-left"
      )}
    >
      <div style={{ aspectRatio }} className="relative w-full overflow-hidden bg-zinc-950">
        {image.filePath ? (
          <img
            src={`/api/images/${image.filePath}`}
            alt={image.contextSnapshot?.situation ?? "Scene illustration"}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff className="h-8 w-8 text-zinc-700" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="absolute top-2 left-2 rounded-full bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            {TRIGGER_SHORT_LABELS[image.triggerType] ?? image.triggerType}
          </span>
          {location && (
            <span className="absolute bottom-2 left-2 right-2 text-xs text-zinc-300 truncate">
              {location}
            </span>
          )}
        </div>
      </div>

      <div className="px-2.5 py-1.5">
        <span className="text-[10px] text-zinc-500">{timeAgo(image.createdAt)}</span>
      </div>
    </button>
  );
}
