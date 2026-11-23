import { describe, it, expect } from "vitest";
import { lastAssistantContents, nextSummaryWindow, historyLimit, isDue } from "@/server/pipeline/utils";

const m = (role: string, content: string) => ({ role, content });

describe("lastAssistantContents", () => {
  it("returns the newest n assistant messages, oldest first", () => {
    const msgs = [m("assistant", "a1"), m("user", "u1"), m("assistant", "a2"), m("assistant", "a3"), m("user", "u2"), m("assistant", "a4")];
    expect(lastAssistantContents(msgs, 3)).toEqual(["a2", "a3", "a4"]);
  });
});

describe("nextSummaryWindow", () => {
  it("waits until enough new messages pile up", () => {
    expect(nextSummaryWindow(9, 0)).toBeNull();
  });
  it("never skips messages when the backlog exceeds one batch", () => {
    expect(nextSummaryWindow(45, 0)).toEqual({ start: 0, end: 20 });
    expect(nextSummaryWindow(45, 20)).toEqual({ start: 20, end: 40 });
    expect(nextSummaryWindow(45, 40)).toBeNull();
  });
});

describe("historyLimit", () => {
  it("uses the setting, clamped to a sane range", () => {
    expect(historyLimit(undefined)).toBe(14);
    expect(historyLimit(20)).toBe(20);
    expect(historyLimit(1)).toBe(4);
    expect(historyLimit(200)).toBe(40);
  });
});

describe("isDue", () => {
  it("fires every N turns counting from the last run", () => {
    expect(isDue(7, undefined, 8)).toBe(false);
    expect(isDue(8, undefined, 8)).toBe(true);
    expect(isDue(15, 8, 8)).toBe(false);
    expect(isDue(16, 8, 8)).toBe(true);
  });
});
