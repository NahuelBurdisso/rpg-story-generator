/** Cold-start floor assertions for runDirector. */
import { describe, it, expect } from "vitest";
import { runDirector, coldStartState } from "@/server/pipeline/director";

describe("runDirector — cold-start floor", () => {
  it("returns gmInitiative === '' on a fresh cold-start state", () => {
    const decision = runDirector(coldStartState());
    expect(decision.gmInitiative).toBe("");
  });

  it("returns a string wordBudget", () => {
    const decision = runDirector(coldStartState());
    expect(typeof decision.wordBudget).toBe("string");
    expect(decision.wordBudget.length).toBeGreaterThan(0);
  });

  it("returns intent === 'develop' with no active threads", () => {
    const decision = runDirector(coldStartState());
    expect(decision.intent).toBe("develop");
  });
});
