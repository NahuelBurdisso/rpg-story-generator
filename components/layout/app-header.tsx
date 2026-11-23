"use client";

import Link from "next/link";
import { Settings, Sun, Moon, Swords } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity"
        >
          <Swords className="h-5 w-5 text-[hsl(var(--genre-accent))]" />
          <span className="font-semibold tracking-tight text-sm">
            RPG Story Generator
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            className={cn(
              "inline-flex items-center justify-center h-8 w-8 rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
              "transition-colors"
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>

          <button
            onClick={toggleTheme}
            className={cn(
              "inline-flex items-center justify-center h-8 w-8 rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
              "transition-colors"
            )}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
