"use client";

import { useState } from "react";
import type { QuickAction } from "@/types";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "@/components/ui/form-styles";

interface QuickActionsEditorProps {
  actions: QuickAction[];
  onChange: (actions: QuickAction[]) => void;
}

export function QuickActionsEditor({ actions, onChange }: QuickActionsEditorProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  function handleAdd() {
    const label = newLabel.trim();
    const prompt = newPrompt.trim();
    if (label && prompt) {
      onChange([...actions, { label, prompt }]);
      setNewLabel("");
      setNewPrompt("");
    }
  }

  function handleRemove(index: number) {
    onChange(actions.filter((_, i) => i !== index));
  }

  return (
    <div>
      <span className={labelClass}>Quick Actions</span>
      {actions.length > 0 && (
        <div className="mt-1 space-y-1">
          {actions.map((action, i) => (
            <div
              key={`${action.label}-${i}`}
              className="flex items-start gap-2 rounded-md border border-border/50 bg-card px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{action.label}</span>
                <p className="text-xs text-muted-foreground truncate">{action.prompt}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive text-xs transition-colors"
                aria-label={`Remove ${action.label} action`}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label"
          className={inputClass}
        />
        <input
          type="text"
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          placeholder="Prompt text"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleAdd}
          className={cn(
            "px-3 py-2 text-sm rounded-md",
            "border border-border text-foreground",
            "hover:bg-accent transition-colors"
          )}
        >
          Add
        </button>
      </div>
    </div>
  );
}
