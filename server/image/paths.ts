/** File-safe slug for character names (refs/<slug>.png). */
export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
}

/** Accept only a single plain path segment (ids are UUIDs); throws otherwise. */
export function assertSafeSegment(segment: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error(`Unsafe path segment: ${JSON.stringify(segment)}`);
  return segment;
}

export function imageKind(buf: Buffer): "png" | "jpeg" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}
