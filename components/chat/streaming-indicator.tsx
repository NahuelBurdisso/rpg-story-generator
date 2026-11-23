"use client";

import { cn } from "@/lib/utils";

export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-800/30">
      {/* Quill/writing animation */}
      <div className="flex items-center gap-1.5">
        <svg
          className="h-3.5 w-3.5 text-amber-500/70"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path
            d="M2 14 L12 4 L14 2 L12 4 L2 14 Z"
            className="opacity-70"
            style={{
              strokeDasharray: 24,
              animation: "quillWrite 1.5s ease-in-out infinite",
            }}
          />
        </svg>
        <span className="text-[10px] text-zinc-600 italic tracking-wide">
          The narrator is writing
        </span>
      </div>
      <span
        className="inline-flex items-center gap-0.5 ml-auto"
        aria-label="Narrator is responding"
      >
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className={cn(
              "inline-block h-1 w-1 rounded-full",
              "bg-amber-400/60"
            )}
            style={{ animation: `pulse 1.4s ease-in-out ${delay}s infinite` }}
          />
        ))}
      </span>
    </div>
  );
}
