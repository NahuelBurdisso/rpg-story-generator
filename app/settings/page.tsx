"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/layout/app-header";
import { PageContainer } from "@/components/layout/page-container";
import { ProviderSelector } from "@/components/settings/provider-selector";
import { ProviderConfigForm } from "@/components/settings/provider-config-form";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { LLMProvider } from "@/types";

export default function SettingsPage() {
  const { data: settings, isLoading: settingsLoading } = trpc.userSettings.get.useQuery();
  const utils = trpc.useUtils();
  const saveSettings = trpc.userSettings.update.useMutation({
    onSuccess: () => utils.userSettings.get.invalidate(),
  });

  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
    }
  }, [settings]);

  async function handleSave(config: {
    provider: LLMProvider;
    ollamaBaseUrl?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    selectedModel?: string;
    maxContextMessages?: number;
  }) {
    setSaveStatus("idle");
    try {
      await saveSettings.mutateAsync({
        provider: config.provider,
        ollamaBaseUrl: config.ollamaBaseUrl,
        openaiApiKey: config.openaiApiKey,
        anthropicApiKey: config.anthropicApiKey,
        selectedModel: config.selectedModel,
        maxContextMessages: config.maxContextMessages,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  }

  const currentConfig = settings
    ? {
        ollamaBaseUrl: settings.ollamaBaseUrl ?? undefined,
        selectedModel: settings.selectedModel ?? undefined,
        maxContextMessages: settings.maxContextMessages ?? undefined,
        hasOpenaiKey: "hasOpenaiKey" in settings ? settings.hasOpenaiKey : false,
        hasAnthropicKey: "hasAnthropicKey" in settings ? settings.hasAnthropicKey : false,
      }
    : {};

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="flex-1">
        <PageContainer className="max-w-2xl">
          <div className="mb-6">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Dashboard
            </Link>
            <h1 className="text-xl font-bold tracking-tight">
              LLM Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure your AI provider for story generation.
            </p>
          </div>

          {settingsLoading ? (
            <div className="space-y-4">
              <div className="h-20 bg-muted animate-pulse rounded-md" />
              <div className="h-40 bg-muted animate-pulse rounded-md" />
            </div>
          ) : (
            <div className="space-y-6">
              <ProviderSelector current={provider} onChange={setProvider} />
              <ProviderConfigForm
                provider={provider}
                currentConfig={currentConfig}
                onSave={handleSave}
              />
              {saveStatus === "saved" && (
                <p className="text-sm text-green-400">Settings saved successfully.</p>
              )}
              {saveStatus === "error" && (
                <p className="text-sm text-red-400">Failed to save settings. Please try again.</p>
              )}
            </div>
          )}
        </PageContainer>
      </main>
    </div>
  );
}
