"use client";

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type { LLMProvider } from "@/types";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface ModelSelectorProps {
  provider: LLMProvider;
  models: string[];
  selected: string;
  onChange: (model: string) => void;
  baseUrl?: string;
  apiKey?: string;
  onModelsLoaded?: (models: string[]) => void;
}

export function ModelSelector({
  provider,
  models,
  selected,
  onChange,
  baseUrl: _baseUrl,
  apiKey: _apiKey,
  onModelsLoaded,
}: ModelSelectorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listModels = trpc.userSettings.listModels.useQuery(
    { provider },
    { enabled: false }
  );

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listModels.refetch();
      if (result.data) {
        onModelsLoaded?.(result.data.models);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setLoading(false);
    }
  }, [listModels, onModelsLoaded]);

  // Auto-load the model list when the selector mounts or the provider
  // changes, so the dropdown is populated (and freshly pulled models
  // appear) without requiring a manual refresh click.
  useEffect(() => {
    void handleRefresh(); // errors are caught inside and shown via setError
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Always show the currently-selected model, even if the list hasn't
  // loaded yet or doesn't include it, so the active model is never hidden.
  const displayModels =
    selected && !models.includes(selected) ? [selected, ...models] : models;

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500">Model</label>
      <div className="flex gap-2">
        <Select
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          disabled={displayModels.length === 0}
          className="flex-1 bg-zinc-900 border-zinc-700/60 text-zinc-200 text-sm"
        >
          {displayModels.length === 0 && (
            <option value="">
              {loading ? "Loading models..." : "No models loaded"}
            </option>
          )}
          {displayModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={loading}
          className={cn(
            "shrink-0 border-zinc-700/60 bg-zinc-900 hover:bg-zinc-800",
            loading && "animate-spin"
          )}
          aria-label="Refresh model list"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && (
        <p className="text-[11px] text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
