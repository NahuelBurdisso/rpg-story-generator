import { describe, it, expect } from "vitest";
import { messages } from "@/server/db/schema";
import { messagesRouter } from "@/server/routers/messages";
import { createTestDb, seedSession } from "../../helpers/testDb";

describe("messages.listBySession keyset pagination", () => {
  it("walks every message exactly once when a page boundary falls inside one millisecond", async () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    const rows = [
      { id: "m1", createdAt: 1000 }, { id: "m2", createdAt: 2000 },
      { id: "m3a", createdAt: 3000 }, { id: "m3b", createdAt: 3000 }, { id: "m4", createdAt: 4000 },
    ];
    for (const r of rows) db.insert(messages).values({ ...r, sessionId: session.id, role: "user", content: r.id }).run();

    const caller = messagesRouter.createCaller({ db });
    const seen: string[] = [];
    let cursor: { createdAt: number; id: string } | undefined;
    let pages = 0;
    do {
      const page = await caller.listBySession({ sessionId: session.id, limit: 2, cursor });
      seen.unshift(...page.messages.map((m) => m.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(["m1", "m2", "m3a", "m3b", "m4"]);
    db.$client.close();
  });

  it("returns the newest page in chronological order without a cursor", async () => {
    const db = createTestDb();
    const { session } = seedSession(db);
    for (const [id, createdAt] of [["a", 1], ["b", 2], ["c", 3]] as const) {
      db.insert(messages).values({ id, createdAt, sessionId: session.id, role: "user", content: id }).run();
    }
    const caller = messagesRouter.createCaller({ db });
    const page = await caller.listBySession({ sessionId: session.id, limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual(["b", "c"]);
    expect(page.nextCursor).toEqual({ createdAt: 2, id: "b" });
    const all = await caller.listBySession({ sessionId: session.id });
    expect(all.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(all.nextCursor).toBeUndefined();
    db.$client.close();
  });
});
