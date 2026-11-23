import { describe, it, expect } from "vitest";
import { userSettingsRouter } from "@/server/routers/userSettings";
import { userSettings } from "@/server/db/schema";
import { createTestDb } from "../../helpers/testDb";

function setup() {
  const db = createTestDb();
  return { db, caller: userSettingsRouter.createCaller({ db }) };
}

describe("userSettings router", () => {
  it("creates the default row on first get, without any key fields", async () => {
    const { db, caller } = setup();
    const s = await caller.get();
    expect(s).toMatchObject({ provider: "ollama", maxContextMessages: 20, hasOpenaiKey: false, hasAnthropicKey: false });
    expect(s).not.toHaveProperty("openaiApiKey");
    expect(s).not.toHaveProperty("anthropicApiKey");
    db.$client.close();
  });

  it("flips the has*Key flags on update and never returns the keys, but stores them", async () => {
    const { db, caller } = setup();
    const updated = await caller.update({ openaiApiKey: "sk-secret-openai" });
    expect(updated).toMatchObject({ hasOpenaiKey: true, hasAnthropicKey: false });
    expect(JSON.stringify(updated)).not.toContain("sk-secret");

    const afterGet = await caller.get();
    expect(afterGet).toMatchObject({ hasOpenaiKey: true, hasAnthropicKey: false });
    expect(JSON.stringify(afterGet)).not.toContain("sk-secret");

    const both = await caller.update({ anthropicApiKey: "sk-ant-secret" });
    expect(both).toMatchObject({ hasOpenaiKey: true, hasAnthropicKey: true });
    expect(JSON.stringify(await caller.get())).not.toContain("secret");

    const row = db.select().from(userSettings).get();
    expect(row).toMatchObject({ openaiApiKey: "sk-secret-openai", anthropicApiKey: "sk-ant-secret" });
    db.$client.close();
  });

  it("updates provider, model and context size", async () => {
    const { db, caller } = setup();
    const updated = await caller.update({ provider: "anthropic", selectedModel: "claude-sonnet-4-5", maxContextMessages: 30 });
    expect(updated).toMatchObject({ provider: "anthropic", selectedModel: "claude-sonnet-4-5", maxContextMessages: 30 });
    expect(await caller.get()).toMatchObject({ provider: "anthropic", maxContextMessages: 30 });
    db.$client.close();
  });

  it("rejects an unknown provider, a bad URL and an out-of-range context size", async () => {
    const { db, caller } = setup();
    // @ts-expect-error not an LLM provider
    await expect(caller.update({ provider: "gemini" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.update({ ollamaBaseUrl: "not a url" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.update({ maxContextMessages: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.update({ maxContextMessages: 201 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.get()).toMatchObject({ provider: "ollama", maxContextMessages: 20 });
    db.$client.close();
  });
});
