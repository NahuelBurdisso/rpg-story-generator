"use client";

import type { ImageStyle } from "@/types";
import { IMAGE_STYLES } from "@/lib/enums";
import { IMAGE_STYLE_LABELS } from "@/lib/constants";

interface ImageSettingsFieldsProps {
  enabled: boolean;
  style: ImageStyle;
  onEnabledChange: (enabled: boolean) => void;
  onStyleChange: (style: ImageStyle) => void;
}

export function ImageSettingsFields({
  enabled,
  style,
  onEnabledChange,
  onStyleChange,
}: ImageSettingsFieldsProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-300">Image Generation</h3>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500"
        />
        <span className="text-sm text-zinc-400">
          Enable scene illustrations{" "}
          <span className="text-zinc-600">(only when you press Illustrate)</span>
        </span>
      </label>

      {enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Art Style</label>
            <select
              value={style}
              onChange={(e) => onStyleChange(e.target.value as ImageStyle)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            >
              {IMAGE_STYLES.map((s) => (
                <option key={s} value={s}>{IMAGE_STYLE_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
