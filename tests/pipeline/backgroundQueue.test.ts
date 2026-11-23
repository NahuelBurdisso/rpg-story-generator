import { describe, it, expect, vi } from "vitest";
import { enqueueBackground, waitForBackground } from "@/server/pipeline/backgroundQueue";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("backgroundQueue", () => {
  it("runs jobs on one key in submission order, one at a time", async () => {
    const log: string[] = [];
    void enqueueBackground("k1", async () => { log.push("a:start"); await tick(); log.push("a:end"); });
    void enqueueBackground("k1", async () => { log.push("b:start"); log.push("b:end"); });
    await waitForBackground("k1");
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("keeps going after a failing job and logs it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: string[] = [];
    void enqueueBackground("k2", async () => { throw new Error("boom"); });
    void enqueueBackground("k2", async () => { ran.push("next"); });
    await waitForBackground("k2");
    expect(ran).toEqual(["next"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("resolves immediately for an idle key", async () => {
    await expect(waitForBackground("idle")).resolves.toBeUndefined();
  });

  it("does not make one key wait for another", async () => {
    let release!: () => void;
    void enqueueBackground("slow", () => new Promise<void>((r) => { release = r; }));
    let fastDone = false;
    void enqueueBackground("fast", async () => { fastDone = true; });
    await waitForBackground("fast");
    expect(fastDone).toBe(true);
    release();
    await waitForBackground("slow");
  });
});
