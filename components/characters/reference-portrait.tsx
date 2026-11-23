"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Upload, ImageIcon, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReferencePortraitProps {
  campaignId: string;
  characterName: string;
  characterId?: string;
}

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing...",
  generating: "Generating image...",
  loading: "Loading model...",
  sampling: "Generating image...",
  decoding: "Decoding...",
  refining: "Refining face...",
  saving: "Saving...",
  done: "Done",
  error: "Error",
};

export function ReferencePortrait({
  campaignId,
  characterName,
  characterId,
}: ReferencePortraitProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const [isPolling, setIsPolling] = useState(false);

  const { data: ref } = trpc.images.getReference.useQuery(
    { campaignId, characterName },
    { enabled: !!campaignId && !!characterName }
  );

  const upload = trpc.images.uploadReference.useMutation({
    onSuccess: () =>
      utils.images.getReference.invalidate({ campaignId, characterName }),
  });

  const generate = trpc.images.generatePortrait.useMutation({
    onSuccess: () => {
      setIsPolling(true);
    },
  });

  const { data: statusData } = trpc.images.portraitStatus.useQuery(
    { characterId: characterId! },
    {
      enabled: !!characterId && isPolling,
      refetchInterval: isPolling ? 2000 : false,
    }
  );

  // Stop polling when generation completes or fails
  useEffect(() => {
    if (!statusData || !isPolling) return;

    if (
      statusData.status === "completed" ||
      statusData.status === "failed"
    ) {
      setIsPolling(false);
      if (statusData.status === "completed") {
        // Cache invalidation is fire-and-forget: a failed refetch is reported by the query itself.
        void utils.images.getReference.invalidate({ campaignId, characterName });
        void utils.characters.listByCampaign.invalidate({ campaignId });
        if (characterId) void utils.characters.get.invalidate({ id: characterId });
      }
    }
  }, [statusData, isPolling, utils, campaignId, characterName, characterId]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        upload.mutate({ campaignId, characterName, imageBase64: base64 });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [campaignId, characterName, upload]
  );

  function handleGenerate() {
    if (!characterId) return;
    generate.mutate({ characterId });
  }

  const hasPortrait = ref?.exists && ref.url;
  const isBusy = upload.isPending || generate.isPending || isPolling;
  const progressPercent = statusData?.progress ?? 0;
  const phaseKey = statusData?.phase ?? "";
  const phaseLabel = PHASE_LABELS[phaseKey] || phaseKey || "Processing...";

  return (
    <div>
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">
        Reference Portrait{" "}
        <span className="font-normal text-muted-foreground/60">
          (for visual consistency across scene illustrations)
        </span>
      </span>

      <div className="flex items-start gap-4 mt-1.5">
        {/* Preview — larger */}
        <div
          className={cn(
            "flex-shrink-0 w-[160px] h-[160px] rounded-md overflow-hidden",
            "border border-border/50 bg-card",
            "flex items-center justify-center relative"
          )}
        >
          {hasPortrait ? (
            <img
              src={ref.url}
              alt={`${characterName} reference`}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
          )}

          {/* Generation overlay */}
          {isPolling && (
            <div className="absolute inset-0 bg-zinc-950/80 flex flex-col items-center justify-center gap-2 px-3">
              <Loader2 className="h-5 w-5 text-[hsl(var(--genre-accent))] animate-spin" />
              <span className="text-[10px] text-zinc-400 text-center leading-tight">
                {phaseLabel}
              </span>
              {/* Progress bar */}
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--genre-accent))] transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${Math.max(progressPercent, 5)}%` }}
                />
              </div>
              <span className="text-[9px] text-zinc-600">
                {Math.round(progressPercent)}%
              </span>
            </div>
          )}
        </div>

        {/* Actions column */}
        <div className="flex flex-col gap-2 pt-1">
          {/* AI generation button */}
          {characterId && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
                "border transition-colors",
                "border-[hsl(var(--genre-accent))]/40 text-[hsl(var(--genre-accent))]",
                "hover:bg-[hsl(var(--genre-accent))]/10",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {generate.isPending || isPolling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {generate.isPending
                ? "Starting..."
                : isPolling
                  ? "Generating..."
                  : hasPortrait
                    ? "Regenerate with AI"
                    : "Generate with AI"}
            </button>
          )}

          {/* Upload button */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isBusy}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
              "border transition-colors",
              "border-zinc-700/60 text-zinc-400",
              "hover:bg-zinc-800/60 hover:text-zinc-300",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Upload className="h-3 w-3" />
            {upload.isPending
              ? "Uploading..."
              : hasPortrait
              ? "Replace Image"
              : "Upload Image"}
          </button>

          {/* Error feedback */}
          {(generate.isError || statusData?.status === "failed") && (
            <p className="text-[10px] text-red-400/80 leading-tight max-w-[180px]">
              {statusData?.error ?? "Generation failed. Please try again."}
            </p>
          )}

          {/* Hint text */}
          {!isBusy && !generate.isError && (
            <p className="text-[10px] text-muted-foreground/50 leading-tight max-w-[180px]">
              {hasPortrait
                ? "You can regenerate or replace the portrait."
                : characterId
                  ? "Generate a portrait with AI or upload an image."
                  : "Save the character first to generate with AI."}
            </p>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
