import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const SERVER_SPECIFIER = String.raw`["'](?:@\/server\/|(?:\.\.\/)+server\/)`;
// A runtime import/re-export of server code. `import type` is erased at compile time and allowed.
// Note: this regex also flags `import { type X } from "@/server/…"` (inline type modifier),
// so use `import type { X }` for type-only imports of server code.
const STATIC_IMPORT = new RegExp(String.raw`^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+${SERVER_SPECIFIER}`, "m");
// `import "@/server/…"` (side-effect import: it runs the module in the client bundle).
const SIDE_EFFECT_IMPORT = new RegExp(String.raw`^\s*import\s+${SERVER_SPECIFIER}`, "m");
// `import("@/server/…")` (dynamic import: it still ends up in the client bundle).
const DYNAMIC_IMPORT = new RegExp(String.raw`\bimport\s*\(\s*${SERVER_SPECIFIER}`);

function importsServerAtRuntime(source: string): boolean {
  return STATIC_IMPORT.test(source) || SIDE_EFFECT_IMPORT.test(source) || DYNAMIC_IMPORT.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("client bundle boundary", () => {
  it("client code imports nothing from server/ at runtime (route handlers excepted)", () => {
    const offenders = ["app", "components", "hooks", "lib", "types"]
      .flatMap((d) => sourceFiles(join(ROOT, d)))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => !f.startsWith("app/api/"))
      .filter((f) => importsServerAtRuntime(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the detector flags runtime imports and ignores type-only ones", () => {
    expect(importsServerAtRuntime(`import { db } from "@/server/db/open";`)).toBe(true);
    expect(importsServerAtRuntime(`import x from "../server/config";`)).toBe(true);
    expect(importsServerAtRuntime(`export { y } from "@/server/pipeline/json";`)).toBe(true);
    expect(importsServerAtRuntime(`import "@/server/db/open";`)).toBe(true);
    expect(importsServerAtRuntime(`const m = await import("@/server/db/open");`)).toBe(true);
    expect(importsServerAtRuntime(`import type { A } from "@/server/db/schema";`)).toBe(false);
    expect(importsServerAtRuntime(`export type { A } from "@/server/db/jsonTypes";`)).toBe(false);
    expect(importsServerAtRuntime(`import { a } from "@/lib/utils";`)).toBe(false);
  });
});
