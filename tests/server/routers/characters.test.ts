import { describe, it, expect } from "vitest";
import { charactersRouter } from "@/server/routers/characters";
import { createTestDb, seedSession } from "../../helpers/testDb";

const base = { name: "Aria", role: "rogue", backstory: "Orphan of the docks", stats: { HP: 10, MaxHP: 10 }, inventory: ["dagger"] };

function setup() {
  const db = createTestDb();
  const { campaign } = seedSession(db);
  return { db, campaign, caller: charactersRouter.createCaller({ db }) };
}

describe("characters router", () => {
  it("creates, gets and lists characters of a campaign", async () => {
    const { db, campaign, caller } = setup();
    const created = await caller.create({ ...base, campaignId: campaign.id, appearance: { hairColor: "black" } });
    expect(created).toMatchObject({ name: "Aria", stats: { HP: 10, MaxHP: 10 }, inventory: ["dagger"], appearance: { hairColor: "black" } });

    expect(await caller.get({ id: created.id })).toMatchObject({ id: created.id });
    expect((await caller.listByCampaign({ campaignId: campaign.id })).map((c) => c.id)).toEqual([created.id]);
    expect(await caller.listByCampaign({ campaignId: "other" })).toEqual([]);
    db.$client.close();
  });

  it("rejects invalid input (empty name, non-numeric stat)", async () => {
    const { db, campaign, caller } = setup();
    await expect(caller.create({ ...base, campaignId: campaign.id, name: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      // @ts-expect-error stats must be numbers
      caller.create({ ...base, campaignId: campaign.id, stats: { HP: "ten" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.listByCampaign({ campaignId: campaign.id })).toEqual([]);
    db.$client.close();
  });

  it("updates only the given fields", async () => {
    const { db, campaign, caller } = setup();
    const created = await caller.create({ ...base, campaignId: campaign.id });
    const updated = await caller.update({ id: created.id, role: "ranger", inventory: ["bow", "rope"] });
    expect(updated).toMatchObject({ name: "Aria", role: "ranger", inventory: ["bow", "rope"], backstory: base.backstory });
    db.$client.close();
  });

  it("deletes a character", async () => {
    const { db, campaign, caller } = setup();
    const created = await caller.create({ ...base, campaignId: campaign.id });
    expect(await caller.delete({ id: created.id })).toEqual({ success: true });
    await expect(caller.get({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.$client.close();
  });

  it("throws NOT_FOUND for get/update/delete of a missing character", async () => {
    const { db, caller } = setup();
    await expect(caller.get({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.update({ id: "nope", name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.delete({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.$client.close();
  });
});
