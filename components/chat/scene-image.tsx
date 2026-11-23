"use client";

import { useState } from "react";
import { useImageStatus } from "@/hooks/use-image-status";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RefreshCw, Pencil, Shuffle } from "lucide-react";
import { SceneImageProgress } from "./scene-image-progress";
import { PromptEditor } from "@/components/images/prompt-editor";

interface SceneImageProps {
  imageId: string;
}

export function SceneImage({ imageId }: SceneImageProps) {
  const { data: image, isError: statusFailed } = useImageStatus(imageId);
  const utils = trpc.useUtils();

  const [isLoaded, setIsLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [editPositive, setEditPositive] = useState("");
  const [editNegative, setEditNegative] = useState("");

  const regenerate = trpc.images.regenerate.useMutation({
    // The server rewrites the message's imageId before answering: refetch the list now.
    onSuccess: () => void utils.messages.listBySession.invalidate(),
  });

  const handleRegenerate = (e: React.MouseEvent) => {
    e.stopPropagation();
    regenerate.mutate({ imageId });
  };

  /**
   * "Variation" — keeps the exact same SD prompt but lets ComfyUI pick a new
   * random seed, producing a visual variation without re-running the LLM.
   * Passing customPositive/customNegative bypasses the prompt-writer in the
   * orchestrator and goes straight to ComfyUI with the stored prompt text.
   */
  const handleVariation = (e: React.MouseEvent) => {
    e.stopPropagation();
    regenerate.mutate({
      imageId,
      customPositive: image?.sdPrompt ?? undefined,
      customNegative: image?.sdNegativePrompt ?? undefined,
    });
  };

  const handleGenerateWithEdits = () => {
    regenerate.mutate({
      imageId,
      customPositive: editPositive || undefined,
      customNegative: editNegative || undefined,
    });
    setShowPrompt(false);
  };

  const handleEditPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showPrompt) {
      setEditPositive(image?.sdPrompt ?? "");
      setEditNegative(image?.sdNegativePrompt ?? "");
    }
    setShowPrompt((prev) => !prev);
  };

  // Replaced images are invisible — the message now references the new imageId
  if (image?.status === "replaced") return null;

  // Failed: show a minimal retry UI
  if (image?.status === "failed" || hasError || (statusFailed && !image)) {
    return (
      <div className="mt-2 rounded-lg overflow-hidden">
        <div className="h-14 w-full bg-zinc-800/80 border border-zinc-700/30 rounded-lg flex items-center justify-center gap-3 px-4">
          <span className="text-[11px] text-zinc-500">Generation failed</span>
          <button
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", regenerate.isPending && "animate-spin")} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // The row is gone (deleted): nothing to show
  if (image === null) return null;

  // Generating: progress bar (undefined = first fetch still in flight)
  if (!image || image.status === "generating") {
    return <SceneImageProgress progress={image?.progress ?? 0} phase={image?.progressPhase ?? "preparing"} />;
  }

  // Completed image
  const imageUrl = `/api/images/${image.filePath}`;
  const isPending = regenerate.isPending;

  return (
    <>
      {/* Image + hover overlay */}
      <div
        className="mt-2 rounded-lg overflow-hidden relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        // Mobile: tap anywhere on container toggles overlay (not fullscreen)
        onClick={() => {
          // On touch devices the hover state won't fire, so tapping toggles overlay
          if (!isHovered) {
            setIsHovered(true);
          } else {
            // Only open fullscreen if overlay is already visible
            setIsFullscreen(true);
          }
        }}
      >
        {/* The image itself */}
        <img
          src={imageUrl}
          alt="Scene illustration"
          className={cn(
            "w-full rounded-lg border border-zinc-700/30 transition-opacity duration-700",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          style={{ aspectRatio: `${image.width}/${image.height}` }}
        />
        {!isLoaded && (
          <div className="absolute inset-0 animate-pulse bg-zinc-800 rounded-lg" />
        )}

        {/* Hover overlay — semi-transparent dark, amber-accented buttons */}
        <div
          className={cn(
            "absolute inset-0 rounded-lg transition-opacity duration-200 flex items-end justify-end p-2 gap-2",
            "bg-black/50",
            isLoaded && (isHovered || isPending) ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          // Prevent the container's onClick (fullscreen) from firing when clicking overlay itself
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fullscreen hint — clicking the image area (not buttons) opens fullscreen */}
          <button
            className="absolute inset-0 cursor-zoom-in"
            aria-label="Open fullscreen"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullscreen(true);
            }}
          />

          {/* Edit Prompt button */}
          <button
            onClick={handleEditPrompt}
            disabled={isPending}
            className={cn(
              "relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium",
              "bg-zinc-900/80 border border-zinc-700/50 text-amber-400 hover:text-amber-300 hover:bg-zinc-800/90",
              "disabled:opacity-50 transition-colors"
            )}
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit Prompt
          </button>

          {/* Variation button — same prompt, new seed */}
          <button
            onClick={handleVariation}
            disabled={isPending}
            title="Generate a visual variation using the same prompt but a different seed"
            className={cn(
              "relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium",
              "bg-zinc-900/80 border border-zinc-700/50 text-amber-400 hover:text-amber-300 hover:bg-zinc-800/90",
              "disabled:opacity-50 transition-colors"
            )}
          >
            <Shuffle className={cn("w-3.5 h-3.5", isPending && "animate-spin")} />
            Variation
          </button>

          {/* Regenerate button — re-runs the LLM prompt writer for a fresh take */}
          <button
            onClick={handleRegenerate}
            disabled={isPending}
            title="Rewrite the prompt and regenerate"
            className={cn(
              "relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium",
              "bg-zinc-900/80 border border-zinc-700/50 text-amber-400 hover:text-amber-300 hover:bg-zinc-800/90",
              "disabled:opacity-50 transition-colors"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isPending && "animate-spin")} />
            Regenerate
          </button>
        </div>
      </div>

      {/* Seed display — shown below image when seed is available */}
      {image.seed != null && (
        <div className="mt-1 px-1 flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-600 tabular-nums">
            seed: {image.seed}
          </span>
        </div>
      )}

      {/* Collapsible Edit Prompt section */}
      {showPrompt && (
        <div
          className="mt-1 rounded-lg border border-zinc-700/40 bg-zinc-900/70 p-3 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <PromptEditor
            positive={editPositive}
            negative={editNegative}
            onPositiveChange={setEditPositive}
            onNegativeChange={setEditNegative}
            onCancel={() => setShowPrompt(false)}
            onSubmit={handleGenerateWithEdits}
            submitLabel="Generate with edits"
            pending={isPending}
          />
        </div>
      )}

      {/* Fullscreen lightbox */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setIsFullscreen(false)}
        >
          <img
            src={imageUrl}
            alt="Scene illustration"
            className="max-w-full max-h-full object-contain rounded-lg"
            onError={() => setHasError(true)}
          />
        </div>
      )}
    </>
  );
}
