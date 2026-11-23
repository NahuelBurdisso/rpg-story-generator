"use client";

import { RefreshCw, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopiedFlag } from "@/hooks/use-copied-flag";

interface PromptEditorProps {
  positive: string;
  negative: string;
  onPositiveChange: (value: string) => void;
  onNegativeChange: (value: string) => void;
  /** With `onSubmit`, renders the Cancel / submit row; without it only the two fields are shown. */
  onCancel?: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  pending?: boolean;
}

/**
 * The positive / negative prompt fields (with a Copy button for the positive one) and, optionally, the
 * Cancel / submit actions. Renders a fragment: the caller provides the surrounding flex-col container.
 */
export function PromptEditor({
  positive,
  negative,
  onPositiveChange,
  onNegativeChange,
  onCancel,
  onSubmit,
  submitLabel = "Generate with edits",
  pending = false,
}: PromptEditorProps) {
  const [copied, copy] = useCopiedFlag();

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Positive prompt</label>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void copy(positive);
            }}
            title="Copy prompt to clipboard"
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy
              </>
            )}
          </button>
        </div>
        <textarea
          value={positive}
          onChange={(e) => onPositiveChange(e.target.value)}
          rows={3}
          className="w-full rounded-md bg-zinc-800 border border-zinc-700/50 text-zinc-300 text-[12px] px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Negative prompt</label>
        <textarea
          value={negative}
          onChange={(e) => onNegativeChange(e.target.value)}
          rows={2}
          className="w-full rounded-md bg-zinc-800 border border-zinc-700/50 text-zinc-300 text-[12px] px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
      </div>
      {onSubmit && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="px-3 py-1.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubmit();
            }}
            disabled={pending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium",
              "bg-amber-600/20 border border-amber-500/40 text-amber-400 hover:bg-amber-600/30 hover:text-amber-300",
              "disabled:opacity-50 transition-colors"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", pending && "animate-spin")} />
            {submitLabel}
          </button>
        </div>
      )}
    </>
  );
}
