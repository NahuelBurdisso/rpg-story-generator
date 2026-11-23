"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useCopiedFlag } from "@/hooks/use-copied-flag";
import { PromptEditor } from "@/components/images/prompt-editor";
import { LightboxContext } from "./lightbox-context";
import { TRIGGER_LABELS } from "@/lib/constants";
import { trpc } from "@/lib/trpc";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { cn, timeAgo } from "@/lib/utils";
import {
  X, ChevronLeft, ChevronRight, RefreshCw, ChevronDown, ChevronUp,
  ImageOff, Pencil, Copy, Check,
} from "lucide-react";
import type { GalleryImage } from "@/types";

interface ImageLightboxProps {
  images: GalleryImage[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

export function ImageLightbox({ images, currentIndex, onNavigate, onClose }: ImageLightboxProps) {
  const image = images[currentIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editPositive, setEditPositive] = useState("");
  const [editNegative, setEditNegative] = useState("");
  const [copied, copy] = useCopiedFlag();

  const utils = trpc.useUtils();
  const regenerate = trpc.images.regenerate.useMutation({
    onSuccess: () => {
      void utils.images.listBySessionWithContext.invalidate();
      void utils.images.listByCampaignGrouped.invalidate();
      onClose();
    },
  });

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(currentIndex - 1);
  }, [hasPrev, currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(currentIndex + 1);
  }, [hasNext, currentIndex, onNavigate]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goPrev, goNext]);

  useFocusTrap(containerRef, currentIndex);

  const handleRegenerate = () => {
    if (editMode && (editPositive || editNegative)) {
      regenerate.mutate({
        imageId: image.id,
        customPositive: editPositive || undefined,
        customNegative: editNegative || undefined,
      });
    } else {
      regenerate.mutate({ imageId: image.id });
    }
  };

  const handleEditToggle = () => {
    if (!editMode) {
      setEditPositive(image.sdPrompt);
      setEditNegative(image.sdNegativePrompt);
    }
    setEditMode(!editMode);
  };

  const handleCopyPrompt = () => void copy(image.sdPrompt);

  const snap = image.contextSnapshot;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm outline-none"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-zinc-900/80 p-2 text-zinc-400 hover:text-zinc-200 transition-colors"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {hasPrev && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-zinc-900/80 p-2 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {hasNext && (
        <button
          onClick={goNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-zinc-900/80 p-2 text-zinc-400 hover:text-zinc-200 transition-colors lg:right-[42%]"
          aria-label="Next image"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      <div className="flex flex-col lg:flex-row w-full h-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-4 max-h-[50vh] lg:max-h-full overflow-auto">
          {image.filePath ? (
            <img
              src={`/api/images/${image.filePath}`}
              alt={snap?.situation ?? "Scene illustration"}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          ) : (
            <div className="flex items-center justify-center w-64 h-48 bg-zinc-900 rounded-lg">
              <ImageOff className="h-12 w-12 text-zinc-700" />
            </div>
          )}
        </div>

        <div className="w-full lg:w-[40%] lg:max-w-[480px] border-t lg:border-t-0 lg:border-l border-zinc-800/60 bg-zinc-950 overflow-y-auto p-5 space-y-5">
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Narrative</h3>
            <div className="prose-narrator text-sm text-zinc-300 max-h-48 overflow-y-auto">
              <MarkdownRenderer content={image.narrativeText} />
            </div>
          </section>

          <LightboxContext snap={snap} />

          <section>
            <button
              onClick={() => setPromptOpen(!promptOpen)}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-400 transition-colors"
            >
              SD Prompt {promptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {promptOpen && (
              <div className="mt-2 space-y-2">
                {editMode ? (
                  <div className="flex flex-col gap-2">
                    <PromptEditor
                      positive={editPositive}
                      negative={editNegative}
                      onPositiveChange={setEditPositive}
                      onNegativeChange={setEditNegative}
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-zinc-400 font-mono bg-zinc-900/50 rounded p-2 break-all">
                      {image.sdPrompt}
                    </p>
                    <p className="text-[10px] text-zinc-600 font-mono bg-zinc-900/50 rounded p-2 break-all">
                      <span className="text-zinc-700">neg: </span>{image.sdNegativePrompt}
                    </p>
                  </>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleEditToggle}
                    className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <Pencil className="h-2.5 w-2.5" /> {editMode ? "Cancel edit" : "Edit prompt"}
                  </button>
                  {!editMode && (
                    <button
                      onClick={handleCopyPrompt}
                      className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {copied ? <Check className="h-2.5 w-2.5 text-green-400" /> : <Copy className="h-2.5 w-2.5" />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Details</h3>
            <div className="flex flex-wrap gap-2 text-[10px] text-zinc-500">
              <span className="rounded-full bg-zinc-800 px-2 py-0.5">
                {TRIGGER_LABELS[image.triggerType] ?? image.triggerType}
              </span>
              <span>{image.width} x {image.height}</span>
              {image.generationTimeMs && (
                <span>{(image.generationTimeMs / 1000).toFixed(1)}s</span>
              )}
              {image.seed && (
                <span className="font-mono">seed: {image.seed}</span>
              )}
              <span>{timeAgo(image.createdAt)}</span>
            </div>
          </section>

          <section className="pt-2 border-t border-zinc-800/60">
            <button
              onClick={handleRegenerate}
              disabled={regenerate.isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                "border border-zinc-700 text-zinc-300",
                "hover:bg-zinc-800 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <RefreshCw className={cn("h-3 w-3", regenerate.isPending && "animate-spin")} />
              {editMode ? "Regenerate with edits" : "Regenerate"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
