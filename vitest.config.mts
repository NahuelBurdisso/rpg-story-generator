import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Unit tests must never open data/rpg.db. PLAY_LOOP e2e scripts opt out.
    env: process.env.PLAY_LOOP ? {} : { DB_PATH: ":memory:" },
    // Default environment is node; tests/components/*.test.tsx opt into jsdom
    // with a `// @vitest-environment jsdom` docblock (environmentMatchGlobs is
    // deprecated). scripts/*.test.mts are live-model e2e: only collected with
    // PLAY_LOOP=1 (see CLAUDE.md, "Test layout").
    include: [
      "tests/**/*.test.{ts,tsx}",
      ...(process.env.PLAY_LOOP ? ["scripts/*.test.mts"] : []),
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
