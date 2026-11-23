/**
 * Normalizers for story-thread fields that come from an LLM (on write) or from
 * a stored blob (on read). They return undefined for anything out of range so
 * the caller picks the fallback that fits its context.
 */
import { THREAD_KINDS, THREAD_STATUSES } from "@/lib/enums";
import type { ThreadKind, ThreadStatus } from "../db/jsonTypes";

/** Kind used when the model invents one: the director treats "goal" as the neutral kind. */
export const DEFAULT_THREAD_KIND: ThreadKind = "goal";

function normalizeEnum<T extends string>(values: readonly T[], v: unknown): T | undefined {
  if (typeof v !== "string") return undefined;
  const norm = v.trim().toLowerCase();
  return values.find((x) => x === norm);
}

export function normalizeThreadKind(v: unknown): ThreadKind | undefined {
  return normalizeEnum(THREAD_KINDS, v);
}

export function normalizeThreadStatus(v: unknown): ThreadStatus | undefined {
  return normalizeEnum(THREAD_STATUSES, v);
}

/** Rounds to an integer and clamps to 1-5; undefined for non-finite or non-numbers. */
export function normalizeThreadWeight(v: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(5, Math.max(1, Math.round(v))) as 1 | 2 | 3 | 4 | 5;
}
