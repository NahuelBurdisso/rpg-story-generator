import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "@/server/db";
import type * as Images from "@/server/routers/images";
import { seedSession } from "../../helpers/testDb";

// server/config resolves RPG_OUTPUT_DIR when it is read: point it at a temp dir so a
// regression can never write under the real output directory.
vi.stubEnv("RPG_OUTPUT_DIR", mkdtempSync(join(tmpdir(), "rpg-refs-")));
vi.stubEnv("COMFYUI_INPUT_DIR", mkdtempSync(join(tmpdir(), "rpg-input-")));
let imagesRouter: typeof Images.imagesRouter;
let MAX_REFERENCE_BYTES: number;
beforeAll(async () => {
  ({ imagesRouter, MAX_REFERENCE_BYTES } = await import("@/server/routers/images"));
});

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("images.uploadReference validation", () => {
  const getCaller = () => imagesRouter.createCaller({ db });

  it("rejects a campaign that does not exist (and never builds a path from it)", async () => {
    await expect(
      getCaller().uploadReference({
        campaignId: "../../etc",
        characterName: "Aria",
        imageBase64: PNG_HEADER.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects data that is not a PNG or JPEG", async () => {
    const { campaign } = seedSession(db);
    await expect(
      getCaller().uploadReference({
        campaignId: campaign.id,
        characterName: "Aria",
        imageBase64: Buffer.from("<svg onload=alert(1)/>").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an image one byte over the cap (handler check, inside the zod margin)", async () => {
    const { campaign } = seedSession(db);
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_REFERENCE_BYTES + 1 - PNG_HEADER.length)]);
    expect(big.length).toBe(MAX_REFERENCE_BYTES + 1);
    await expect(
      getCaller().uploadReference({
        campaignId: campaign.id,
        characterName: "Aria",
        imageBase64: big.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("10 MB") });
  });

  it("rejects a payload far over the cap (zod length limit)", async () => {
    const { campaign } = seedSession(db);
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_REFERENCE_BYTES + 1)]);
    await expect(
      getCaller().uploadReference({
        campaignId: campaign.id,
        characterName: "Aria",
        imageBase64: big.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
