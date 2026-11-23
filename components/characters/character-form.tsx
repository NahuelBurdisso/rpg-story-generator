"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Appearance } from "@/types";
import { ReferencePortrait } from "@/components/characters/reference-portrait";
import { AppearanceFields } from "@/components/characters/appearance-fields";
import { StatsEditor } from "@/components/characters/stats-editor";
import { StringListEditor } from "@/components/ui/string-list-editor";
import { inputClass, labelClass } from "@/components/ui/form-styles";

export type AppearanceTraits = Appearance;

export interface CharacterFormData {
  name: string;
  role: string;
  backstory: string;
  appearance?: AppearanceTraits | null;
  stats: Record<string, number>;
  inventory: string[];
  statusNotes?: string;
}

interface CharacterFormProps {
  statDefinitions: string[];
  campaignId: string;
  characterId?: string;
  initialData?: CharacterFormData;
  onSubmit: (data: CharacterFormData) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  submitLabel?: string;
  /** Mutation error from the page; shown above the actions. */
  error?: string;
}

export function CharacterForm({
  statDefinitions,
  campaignId,
  characterId,
  initialData,
  onSubmit,
  onDelete,
  submitLabel,
  error,
}: CharacterFormProps) {
  const isEdit = !!initialData;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(initialData?.name ?? "");
  const [role, setRole] = useState(initialData?.role ?? "");
  const [backstory, setBackstory] = useState(initialData?.backstory ?? "");
  const [statusNotes, setStatusNotes] = useState(initialData?.statusNotes ?? "");
  const [appearance, setAppearance] = useState<AppearanceTraits>(initialData?.appearance ?? {});

  const initialStats: Record<string, number> = {};
  // Start with existing stats (preserves HP/MaxHP and any custom stats)
  if (initialData?.stats) {
    Object.assign(initialStats, initialData.stats);
  }
  // Ensure all stat definitions have a value
  for (const stat of statDefinitions) {
    if (initialStats[stat] === undefined) initialStats[stat] = 10;
  }
  // For new characters, add HP/MaxHP if not in stat definitions
  if (!initialData && !statDefinitions.includes("HP")) {
    initialStats.HP = 20;
    initialStats.MaxHP = 20;
  }
  const [stats, setStats] = useState<Record<string, number>>(initialStats);

  const [inventory, setInventory] = useState<string[]>(initialData?.inventory ?? []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        name,
        role,
        backstory,
        appearance: Object.values(appearance).some(Boolean) ? appearance : null,
        stats,
        inventory,
        statusNotes: statusNotes || undefined,
      });
    } catch {
      // the page renders the mutation error
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } catch {
      // the page renders the mutation error
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name + Role */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.5fr_1fr]">
        <div>
          <label htmlFor="char-name" className={labelClass}>Name</label>
          <input
            id="char-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aelindra Stormweaver"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="char-role" className={labelClass}>Role / Class</label>
          <input
            id="char-role"
            type="text"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Battle Mage"
            className={inputClass}
          />
        </div>
      </div>

      {/* Backstory */}
      <div>
        <label htmlFor="backstory" className={labelClass}>Backstory</label>
        <textarea
          id="backstory"
          required
          rows={4}
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          placeholder="Write your character's backstory. The AI will reference this during gameplay."
          className={cn(inputClass, "resize-y")}
        />
      </div>

      {/* Appearance */}
      <AppearanceFields value={appearance} onChange={setAppearance} />

      {/* Reference Portrait (edit mode only) */}
      {isEdit && name && (
        <ReferencePortrait campaignId={campaignId} characterName={name} characterId={characterId} />
      )}

      {/* Stats */}
      <StatsEditor stats={stats} statDefinitions={statDefinitions} onChange={setStats} />

      {/* Inventory */}
      <div>
        <span className={labelClass}>Inventory</span>
        <StringListEditor items={inventory} onChange={setInventory} placeholder="Add item..." allowDuplicates />
      </div>

      {/* Status Notes */}
      <div>
        <label htmlFor="status-notes" className={labelClass}>
          Status Notes <span className="font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <input
          id="status-notes"
          type="text"
          value={statusNotes}
          onChange={(e) => setStatusNotes(e.target.value)}
          placeholder="Poisoned, injured, etc."
          className={inputClass}
        />
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {isEdit && onDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={isDeleting}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
                "border border-destructive/30 text-destructive",
                "hover:bg-destructive/10 transition-colors",
                "disabled:opacity-50"
              )}
            >
              <Trash2 className="h-3 w-3" />
              {isDeleting ? "Deleting..." : "Delete Character"}
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !name.trim() || !role.trim() || !backstory.trim()}
          className={cn(
            "px-5 py-2 text-sm font-medium rounded-md transition-colors",
            "bg-[hsl(var(--genre-accent))] text-[hsl(var(--primary-foreground))]",
            "hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {isSubmitting
            ? "Saving..."
            : submitLabel ?? (isEdit ? "Save Changes" : "Create Character")}
        </button>
      </div>
    </form>
    <ConfirmDialog
      open={confirmDelete}
      title="Delete character?"
      description={`Delete ${name.trim() || "this character"}? This permanently deletes the character and cannot be undone.`}
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      pending={isDeleting}
      onConfirm={async () => {
        await handleDelete();
        setConfirmDelete(false);
      }}
      onCancel={() => setConfirmDelete(false)}
    />
    </>
  );
}
