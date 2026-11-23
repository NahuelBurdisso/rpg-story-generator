"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface InventoryListProps {
  items: string[];
  editable?: boolean;
  onChange?: (items: string[]) => void;
}

export default function InventoryList({ items, editable, onChange }: InventoryListProps) {
  const [newItem, setNewItem] = useState("");

  function handleAdd() {
    const trimmed = newItem.trim();
    if (trimmed && onChange) {
      onChange([...items, trimmed]);
      setNewItem("");
    }
  }

  function handleRemove(index: number) {
    if (onChange) {
      onChange(items.filter((_, i) => i !== index));
    }
  }

  if (!editable && items.length === 0) {
    return <p className="text-xs text-zinc-600 italic">Empty inventory.</p>;
  }

  return (
    <div>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-sm",
                editable ? "bg-zinc-800/60" : "text-zinc-400"
              )}
            >
              <span className="text-zinc-600 text-xs select-none">&#8226;</span>
              <span className="flex-1 text-zinc-300 truncate">{item}</span>
              {editable && (
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  className="shrink-0 text-zinc-600 hover:text-red-400 text-xs transition-colors"
                  aria-label={`Remove ${item}`}
                >
                  x
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-600 italic mb-2">No items yet.</p>
      )}

      {editable && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Add item..."
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newItem.trim()}
            className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-30"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
