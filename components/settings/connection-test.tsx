"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { LLMProvider } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plug, Check, X, Loader2 } from "lucide-react";

interface ConnectionTestProps {
  provider: LLMProvider;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

type TestStatus = "idle" | "testing" | "success" | "error";

export function ConnectionTest({ provider, baseUrl: _baseUrl, apiKey: _apiKey, model }: ConnectionTestProps) {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const listModels = trpc.userSettings.listModels.useQuery(
    { provider },
    { enabled: false }
  );

  async function handleTest() {
    setStatus("testing");
    setErrorMsg(null);
    try {
      await listModels.refetch();
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleTest}
        disabled={status === "testing"}
        className={cn(
          "gap-2 border-zinc-700/60 bg-zinc-900 text-zinc-300 hover:bg-zinc-800",
          status === "success" && "border-emerald-800/50 text-emerald-400",
          status === "error" && "border-red-800/50 text-red-400"
        )}
      >
        {status === "testing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "success" ? (
          <Check className="h-3.5 w-3.5" />
        ) : status === "error" ? (
          <X className="h-3.5 w-3.5" />
        ) : (
          <Plug className="h-3.5 w-3.5" />
        )}
        {status === "testing"
          ? "Testing..."
          : status === "success"
            ? "Connected"
            : status === "error"
              ? "Failed"
              : "Test Connection"}
      </Button>
      {status === "success" && (
        <p className="text-[11px] text-emerald-500">
          Successfully connected to {provider}
          {model ? ` (${model})` : ""}.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p className="text-[11px] text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
