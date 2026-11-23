"use client";

import { useState } from "react";
import { type Genre, type Tone, type Difficulty, type QuickAction } from "@/types";
import type { CampaignFormData } from "@/lib/campaign-input";
import { GENRE_OPTIONS, TONE_OPTIONS, DIFFICULTY_OPTIONS, STAT_PRESETS, QUICK_ACTION_PRESETS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StringListEditor } from "@/components/ui/string-list-editor";
import { inputClass, labelClass, selectClass } from "@/components/ui/form-styles";
import { QuickActionsEditor } from "@/components/campaigns/quick-actions-editor";
import { ImageSettingsFields } from "@/components/campaigns/image-settings-fields";

export type { CampaignFormData } from "@/lib/campaign-input";

interface CampaignFormProps {
  initialData?: CampaignFormData;
  onSubmit: (data: CampaignFormData) => void | Promise<void>;
  submitLabel?: string;
  /** Mutation error from the page; shown above the submit button. */
  error?: string;
}

export function CampaignForm({ initialData, onSubmit, submitLabel, error }: CampaignFormProps) {
  const isEdit = !!initialData;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState(initialData?.name ?? "");
  const [genre, setGenre] = useState<Genre>(initialData?.genre ?? "fantasy");
  const [customGenre, setCustomGenre] = useState(initialData?.customGenre ?? "");
  const [tone, setTone] = useState<Tone>(initialData?.tone ?? "serious");
  const [difficulty, setDifficulty] = useState<Difficulty>(initialData?.difficulty ?? "normal");
  const [worldDescription, setWorldDescription] = useState(initialData?.worldDescription ?? "");
  const [customRules, setCustomRules] = useState(initialData?.customRules ?? "");
  const [statDefinitions, setStatDefinitions] = useState<string[]>(
    initialData?.statDefinitions ?? STAT_PRESETS["fantasy"]
  );
  const [quickActions, setQuickActions] = useState<QuickAction[]>(
    initialData?.quickActions ?? QUICK_ACTION_PRESETS["fantasy"]
  );
  const [plotHooks, setPlotHooks] = useState<string[]>(initialData?.plotHooks ?? []);
  const [imageEnabled, setImageEnabled] = useState(initialData?.imageEnabled ?? false);
  const [imageStyle, setImageStyle] = useState(initialData?.imageStyle ?? "painterly-fantasy");

  const [pendingGenre, setPendingGenre] = useState<Genre | null>(null);
  function applyPresets(g: Genre) {
    setStatDefinitions([...STAT_PRESETS[g]]);
    setQuickActions([...QUICK_ACTION_PRESETS[g]]);
  }
  function handleGenreChange(g: Genre) {
    setGenre(g);
    if (isEdit) setPendingGenre(g); // ask before replacing what the user already edited
    else applyPresets(g);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        name,
        genre,
        customGenre: genre === "custom" ? customGenre : undefined,
        tone,
        difficulty,
        worldDescription,
        customRules: customRules || undefined,
        statDefinitions,
        quickActions,
        plotHooks,
        imageEnabled,
        imageStyle,
      });
    } catch {
      // the page renders mutation.error
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div>
        <label htmlFor="campaign-name" className={labelClass}>Campaign Name</label>
        <input
          id="campaign-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Lost Kingdom of Eldara"
          className={inputClass}
        />
      </div>

      {/* Genre + Tone + Difficulty row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="genre" className={labelClass}>Genre</label>
          <select
            id="genre"
            value={genre}
            onChange={(e) => handleGenreChange(e.target.value as Genre)}
            className={selectClass}
          >
            {GENRE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="tone" className={labelClass}>Tone</label>
          <select
            id="tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className={selectClass}
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="difficulty" className={labelClass}>Difficulty</label>
          <select
            id="difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className={selectClass}
          >
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Custom Genre */}
      {genre === "custom" && (
        <div>
          <label htmlFor="custom-genre" className={labelClass}>Custom Genre Name</label>
          <input
            id="custom-genre"
            type="text"
            value={customGenre}
            onChange={(e) => setCustomGenre(e.target.value)}
            placeholder="Steampunk, Cyberpunk, etc."
            className={inputClass}
          />
        </div>
      )}

      {/* World Description */}
      <div>
        <label htmlFor="world-desc" className={labelClass}>World Description</label>
        <textarea
          id="world-desc"
          required
          rows={5}
          value={worldDescription}
          onChange={(e) => setWorldDescription(e.target.value)}
          placeholder="Describe the world your campaign takes place in. The AI narrator will use this as context."
          className={cn(inputClass, "resize-y")}
        />
      </div>

      {/* Custom Rules */}
      <div>
        <label htmlFor="custom-rules" className={labelClass}>
          Custom Rules <span className="font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          id="custom-rules"
          rows={3}
          value={customRules}
          onChange={(e) => setCustomRules(e.target.value)}
          placeholder="Any special rules for combat, magic, etc."
          className={cn(inputClass, "resize-y")}
        />
      </div>

      {/* Image Generation */}
      <ImageSettingsFields
        enabled={imageEnabled}
        style={imageStyle}
        onEnabledChange={setImageEnabled}
        onStyleChange={setImageStyle}
      />

      {/* Stat Definitions */}
      <div>
        <span className={labelClass}>Stat Definitions</span>
        <StringListEditor items={statDefinitions} onChange={setStatDefinitions} placeholder="Add stat..." />
      </div>

      {/* Plot Hooks */}
      <div>
        <span className={labelClass}>
          Plot Hooks{" "}
          <span className="font-normal text-muted-foreground/60">(Story threads the AI will weave into the narrative)</span>
        </span>
        <StringListEditor
          items={plotHooks}
          onChange={setPlotHooks}
          placeholder="e.g. 'A shadowy figure stalks the player' or 'An ancient evil awakens beneath the city'"
        />
      </div>

      {/* Quick Actions */}
      <QuickActionsEditor actions={quickActions} onChange={setQuickActions} />

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isSubmitting || !name.trim() || !worldDescription.trim()}
          className={cn(
            "px-5 py-2 text-sm font-medium rounded-md transition-colors",
            "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]",
            "hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {isSubmitting
            ? "Saving..."
            : submitLabel ?? (isEdit ? "Save Changes" : "Create Campaign")}
        </button>
      </div>
    </form>
    <ConfirmDialog
      open={pendingGenre !== null}
      title="Load genre presets?"
      description="Replace the stats and quick actions with the presets for this genre."
      confirmLabel="Load presets"
      cancelLabel="Keep current"
      destructive={false}
      onConfirm={() => {
        if (pendingGenre) applyPresets(pendingGenre);
        setPendingGenre(null);
      }}
      onCancel={() => setPendingGenre(null)}
    />
    </>
  );
}
