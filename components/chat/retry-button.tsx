"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RetryButtonProps {
  onRetry: () => void;
}

export function RetryButton({ onRetry }: RetryButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      className="mt-2 h-7 gap-1.5 border-red-800/50 bg-red-950/30 text-red-300 hover:bg-red-900/40 hover:text-red-200 text-xs"
    >
      <RotateCcw className="h-3 w-3" />
      Retry
    </Button>
  );
}
