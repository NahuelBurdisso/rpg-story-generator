"use client";

import { useState } from "react";
import { ImageCard } from "./image-card";
import { ImageLightbox } from "./image-lightbox";
import type { GalleryImage } from "@/types";

interface ImageGalleryProps {
  images: GalleryImage[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {images.map((image, idx) => (
          <ImageCard key={image.id} image={image} onClick={() => setSelectedIndex(idx)} />
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
    </>
  );
}
