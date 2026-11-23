"use client";

import { useState, useEffect } from "react";
import type { LLMProvider } from "@/types";
import { DEFAULT_OLLAMA_URL, DEFAULT_MAX_CONTEXT_MESSAGES } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "./model-selector";
import { ConnectionTest } from "./connection-test";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Save, ShieldCheck } from "lucide-react";

interface ProviderConfig {
  ollamaBaseUrl?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  selectedModel?: string;
  maxContextMessages?: number;
  hasOpenaiKey?: boolean;
  hasAnthropicKey?: boolean;
}

interface ProviderConfigFormProps {
  provider: LLMProvider;
  currentConfig: ProviderConfig;
  onSave: (config: {
    provider: LLMProvider;
    ollamaBaseUrl?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    selectedModel?: string;
    maxContextMessages?: number;
  }) => void;
}

const DEFAULT_MODELS: Record<LLMProvider, string[]> = {
  ollama: [],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
};

export function ProviderConfigForm({
  provider,
  currentConfig,
  onSave,
}: ProviderConfigFormProps) {
  const [baseUrl, setBaseUrl] = useState(
    currentConfig.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL
  );
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(
    currentConfig.selectedModel ?? ""
  );
  const [maxContext, setMaxContext] = useState(
    currentConfig.maxContextMessages ?? DEFAULT_MAX_CONTEXT_MESSAGES
  );
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS[provider]);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setModels(DEFAULT_MODELS[provider]);
    if (provider === "ollama") {
      setBaseUrl(currentConfig.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL);
    }
    setSelectedModel(currentConfig.selectedModel ?? "");
  }, [provider, currentConfig]);

  async function handleSave() {
    setSaving(true);
    try {
      const config: Parameters<typeof onSave>[0] = {
        provider,
        selectedModel: selectedModel || undefined,
        maxContextMessages: maxContext,
      };

      if (provider === "ollama") {
        config.ollamaBaseUrl = baseUrl;
      } else if (provider === "openai" && openaiKey) {
        config.openaiApiKey = openaiKey;
      } else if (provider === "anthropic" && anthropicKey) {
        config.anthropicApiKey = anthropicKey;
      }

      onSave(config);
    } finally {
      setSaving(false);
    }
  }

  function handleModelsLoaded(loaded: string[]) {
    setModels(loaded);
    if (loaded.length > 0 && !loaded.includes(selectedModel)) {
      setSelectedModel(loaded[0]);
    }
  }

  return (
    <div className="space-y-5">
      {/* Provider-specific fields */}
      {provider === "ollama" && (
        <div className="space-y-1.5">
          <Label htmlFor="ollama-url" className="text-xs text-zinc-500">
            Base URL
          </Label>
          <Input
            id="ollama-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_OLLAMA_URL}
            className="bg-zinc-900 border-zinc-700/60 text-zinc-200 text-sm"
          />
          <p className="text-[10px] text-zinc-600">
            Default: {DEFAULT_OLLAMA_URL}
          </p>
        </div>
      )}

      {provider === "openai" && (
        <div className="space-y-1.5">
          <Label htmlFor="openai-key" className="text-xs text-zinc-500">
            API Key
          </Label>
          <div className="relative">
            <Input
              id="openai-key"
              type={showOpenaiKey ? "text" : "password"}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={currentConfig.hasOpenaiKey ? "Key saved (enter new to replace)" : "sk-..."}
              className="bg-zinc-900 border-zinc-700/60 text-zinc-200 text-sm pr-9"
            />
            <button
              type="button"
              onClick={() => setShowOpenaiKey(!showOpenaiKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              aria-label={showOpenaiKey ? "Hide API key" : "Show API key"}
            >
              {showOpenaiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {currentConfig.hasOpenaiKey && (
            <p className="flex items-center gap-1 text-[10px] text-emerald-600">
              <ShieldCheck className="h-3 w-3" />
              API key saved
            </p>
          )}
        </div>
      )}

      {provider === "anthropic" && (
        <div className="space-y-1.5">
          <Label htmlFor="anthropic-key" className="text-xs text-zinc-500">
            API Key
          </Label>
          <div className="relative">
            <Input
              id="anthropic-key"
              type={showAnthropicKey ? "text" : "password"}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={currentConfig.hasAnthropicKey ? "Key saved (enter new to replace)" : "sk-ant-..."}
              className="bg-zinc-900 border-zinc-700/60 text-zinc-200 text-sm pr-9"
            />
            <button
              type="button"
              onClick={() => setShowAnthropicKey(!showAnthropicKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              aria-label={showAnthropicKey ? "Hide API key" : "Show API key"}
            >
              {showAnthropicKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {currentConfig.hasAnthropicKey && (
            <p className="flex items-center gap-1 text-[10px] text-emerald-600">
              <ShieldCheck className="h-3 w-3" />
              API key saved
            </p>
          )}
        </div>
      )}

      {/* Model selector */}
      <ModelSelector
        provider={provider}
        models={models}
        selected={selectedModel}
        onChange={setSelectedModel}
        baseUrl={provider === "ollama" ? baseUrl : undefined}
        apiKey={
          provider === "openai"
            ? openaiKey || undefined
            : provider === "anthropic"
              ? anthropicKey || undefined
              : undefined
        }
        onModelsLoaded={handleModelsLoaded}
      />

      {/* Max context messages */}
      <div className="space-y-1.5">
        <Label htmlFor="max-context" className="text-xs text-zinc-500">
          Max Context Messages
        </Label>
        <Input
          id="max-context"
          type="number"
          min={5}
          max={100}
          value={maxContext}
          onChange={(e) => setMaxContext(parseInt(e.target.value, 10) || DEFAULT_MAX_CONTEXT_MESSAGES)}
          className="bg-zinc-900 border-zinc-700/60 text-zinc-200 text-sm w-24"
        />
        <p className="text-[10px] text-zinc-600">
          Number of recent messages included in LLM context. Higher uses more tokens.
        </p>
      </div>

      {/* Connection test */}
      <ConnectionTest
        provider={provider}
        baseUrl={provider === "ollama" ? baseUrl : undefined}
        apiKey={
          provider === "openai"
            ? openaiKey || undefined
            : provider === "anthropic"
              ? anthropicKey || undefined
              : undefined
        }
        model={selectedModel || undefined}
      />

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving}
        className={cn(
          "gap-2 bg-amber-700 text-zinc-100 hover:bg-amber-600",
          saving && "opacity-60"
        )}
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
