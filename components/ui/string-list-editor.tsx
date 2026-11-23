"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { inputClass } from "./form-styles";

interface StringListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  /** Inventory may hold two of the same item; stats and plot hooks may not. */
  allowDuplicates?: boolean;
}

export function StringListEditor({ items, onChange, placeholder, allowDuplicates = false }: StringListEditorProps) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || (!allowDuplicates && items.includes(value))) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div>
      {items.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span key={`${item}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs">
              {item}
              <button type="button" aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive">x</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input type="text" value={draft} placeholder={placeholder} className={cn(inputClass, "flex-1")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          className="rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-30">
          Add
        </button>
      </div>
    </div>
  );
}
