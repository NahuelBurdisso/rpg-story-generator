import { openDatabase, type DB } from "@/server/db/open";
import { campaigns, characters, sessions } from "@/server/db/schema";

export function createTestDb(): DB {
  return openDatabase(":memory:");
}

export function seedSession(db: DB) {
  const campaign = db.insert(campaigns)
    .values({ name: "Test", genre: "fantasy", tone: "serious", difficulty: "normal" })
    .returning().get();
  const session = db.insert(sessions).values({ campaignId: campaign.id, title: "S1" }).returning().get();
  return { campaign, session };
}

export function seedCharacter(db: DB, campaignId: string, over: Partial<typeof characters.$inferInsert> = {}) {
  return db.insert(characters)
    .values({ campaignId, name: "Aria", role: "rogue", backstory: "", stats: { HP: 10, MaxHP: 10 }, inventory: [], ...over })
    .returning().get();
}
