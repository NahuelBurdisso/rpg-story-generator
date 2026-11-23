"use client";

import { MapPin, Clock, Users } from "lucide-react";
import type { ContextSnapshot } from "@/types";

/** The "Scene" panel: what the image's `contextSnapshot` captured when it was generated. */
export function LightboxContext({ snap }: { snap: ContextSnapshot | null | undefined }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Scene</h3>
      {snap ? (
        <div className="space-y-2 text-sm">
          {snap.location && (
            <div className="flex items-center gap-2 text-zinc-400">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{snap.location}</span>
            </div>
          )}
          {snap.timeOfDay && (
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>{snap.timeOfDay}</span>
            </div>
          )}
          {snap.activeNPCs.length > 0 && (
            <div className="flex items-center gap-2 text-zinc-400">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {snap.activeNPCs.map((name) => (
                  <span key={name} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {snap.situation && (
            <p className="text-xs text-zinc-500 mt-1">{snap.situation}</p>
          )}
          {snap.characterName && (
            <p className="text-xs text-zinc-500">
              Focus: {snap.characterName}{snap.characterStatus ? ` — ${snap.characterStatus}` : ""}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-600 italic">Context not captured for this image</p>
      )}
    </section>
  );
}
