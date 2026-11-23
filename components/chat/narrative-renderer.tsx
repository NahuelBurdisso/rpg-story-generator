"use client";

import { useMemo } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { narrationForDisplay, stripMechanicMarkersLoose } from "@/lib/narrative";
import { injectCharacterLinks, type CharacterLink } from "@/lib/character-links";

interface NarrativeRendererProps {
  content: string;
  isStreaming?: boolean;
  characterLinks?: CharacterLink[];
}

const NO_LINKS: CharacterLink[] = [];

export function NarrativeRenderer({ content, isStreaming, characterLinks = NO_LINKS }: NarrativeRendererProps) {
  const linked = useMemo(() => {
    // The server never streams markers (streamBeforeMarker); the loose strip is a cheap guard.
    const clean = isStreaming ? stripMechanicMarkersLoose(content) : narrationForDisplay(content);
    return characterLinks.length > 0 ? injectCharacterLinks(clean, characterLinks) : clean;
  }, [content, isStreaming, characterLinks]);

  return (
    <div className="narrative-drop-cap">
      <MarkdownRenderer content={linked} isNarrator />
    </div>
  );
}
