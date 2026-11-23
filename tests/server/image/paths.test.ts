import { describe, it, expect } from "vitest";
import { sanitizeName, assertSafeSegment, imageKind } from "@/server/image/paths";

describe("paths", () => {
  it("sanitizes character names to file-safe slugs", () => {
    expect(sanitizeName("Sera Vance!")).toBe("sera_vance_");
  });
  it("rejects path segments that could escape the output dir", () => {
    for (const bad of ["../x", "a/b", "a\\b", "", ".", "..", "x\0y"]) expect(() => assertSafeSegment(bad)).toThrow();
    expect(assertSafeSegment("3f2c9a1e-0000-4000-8000-000000000000")).toBe("3f2c9a1e-0000-4000-8000-000000000000");
  });
  it("recognizes PNG and JPEG by magic bytes only", () => {
    expect(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(imageKind(Buffer.from("<svg/>"))).toBeNull();
  });
});
