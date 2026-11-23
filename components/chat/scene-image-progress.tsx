"use client";

import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  preparing: "Preparing illustration...",
  loading: "Loading model...",
  sampling: "Generating...",
  decoding: "Decoding image...",
  saving: "Saving...",
  done: "Finalizing...",
};

interface SceneImageProgressProps {
  progress: number;
  phase: string;
}

export function SceneImageProgress({ progress, phase }: SceneImageProgressProps) {
  return (
    <div className="mt-2 rounded-lg overflow-hidden">
      <div className="h-14 w-full bg-zinc-800/80 border border-zinc-700/30 rounded-lg flex flex-col items-center justify-center gap-1.5 px-4">
        <div className="flex items-center gap-2 w-full">
          <div className="flex-1 h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700 ease-out",
                phase === "sampling" ? "bg-amber-500/90" : "bg-amber-600/60"
              )}
              style={{ width: `${Math.max(progress, phase === "loading" ? 5 : 0)}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-500 tabular-nums w-8 text-right">
            {progress > 0 ? `${progress}%` : ""}
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">
          {PHASE_LABEL[phase] ?? "Generating..."}
        </span>
      </div>
    </div>
  );
}
