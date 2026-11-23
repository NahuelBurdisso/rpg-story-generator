import { describe, it, expect } from "vitest";
import { campaignsRouter } from "@/server/routers/campaigns";
import { createTestDb, seedCharacter, seedSession } from "../../helpers/testDb";

const valid = { name: "Ashfall", genre: "fantasy", tone: "dark", difficulty: "hard" } as const;

function setup() {
  const db = createTestDb();
  return { db, caller: campaignsRouter.createCaller({ db }) };
}

describe("campaigns router", () => {
  it("creates with defaults, then gets and lists it", async () => {
    const { db, caller } = setup();
    const created = await caller.create({ ...valid, imageStyle: "anime-rpg" });
    expect(created).toMatchObject({ name: "Ashfall", genre: "fantasy", worldDescription: "", imageEnabled: false });
    expect(created.statDefinitions).toEqual([]);

    expect(await caller.get({ id: created.id })).toMatchObject({ id: created.id, imageStyle: "anime-rpg" });
    expect((await caller.list()).map((c) => c.id)).toEqual([created.id]);
    db.$client.close();
  });

  it("lists the most recently played campaign first", async () => {
    const { db, caller } = setup();
    const a = await caller.create({ ...valid, name: "A" });
    const b = await caller.create({ ...valid, name: "B" });
    await caller.update({ id: a.id, lastPlayedAt: (b.lastPlayedAt ?? 0) + 1000 });
    expect((await caller.list()).map((c) => c.name)).toEqual(["A", "B"]);
    db.$client.close();
  });

  it("rejects values outside the zod enums and empty names", async () => {
    const { db, caller } = setup();
    // @ts-expect-error genre is not one of GENRES
    await expect(caller.create({ ...valid, genre: "western" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error tone is not one of TONES
    await expect(caller.create({ ...valid, tone: "grim" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error imageStyle is not one of IMAGE_STYLES
    await expect(caller.create({ ...valid, imageStyle: "anime" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.create({ ...valid, name: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error difficulty is not one of DIFFICULTIES
    await expect(caller.update({ id: "x", difficulty: "brutal" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.list()).toEqual([]);
    db.$client.close();
  });

  it("updates only the given fields", async () => {
    const { db, caller } = setup();
    const created = await caller.create(valid);
    const updated = await caller.update({ id: created.id, name: "Renamed", plotHooks: ["a stolen crown"] });
    expect(updated).toMatchObject({ name: "Renamed", genre: "fantasy", tone: "dark", plotHooks: ["a stolen crown"] });
    db.$client.close();
  });

  it("deletes a campaign and cascades to its characters and sessions", async () => {
    const { db, caller } = setup();
    const { campaign } = seedSession(db);
    seedCharacter(db, campaign.id);
    expect(await caller.delete({ id: campaign.id })).toEqual({ success: true });
    await expect(caller.get({ id: campaign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.$client.prepare("SELECT count(*) AS n FROM characters").get()).toEqual({ n: 0 });
    expect(db.$client.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    db.$client.close();
  });

  it("throws NOT_FOUND for get/update/delete of a missing campaign", async () => {
    const { db, caller } = setup();
    await expect(caller.get({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.update({ id: "nope", name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.delete({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.$client.close();
  });
});
