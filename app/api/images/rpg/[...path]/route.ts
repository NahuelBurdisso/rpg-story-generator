import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { config } from "@/server/config";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  if (relativePath.includes("..") || relativePath.includes("\\")) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = resolve(join(config.outputDir, relativePath));

  if (!filePath.startsWith(resolve(config.outputDir))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
