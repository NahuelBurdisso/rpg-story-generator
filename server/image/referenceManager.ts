import { readFile, writeFile, mkdir, stat, copyFile } from "fs/promises";
import { join } from "path";
import { sanitizeName, assertSafeSegment } from "./paths";
import { config } from "../config";

function getRefDir(campaignId: string): string {
  return join(config.outputDir, assertSafeSegment(campaignId), "refs");
}

/**
 * Get the reference image for a character, staged into ComfyUI's input directory.
 * Returns the filename (not full path) that ComfyUI's LoadImage node can use.
 * Skips copy if the staged file already exists with the same size.
 */
export async function getCharacterRef(campaignId: string, characterName: string): Promise<string | null> {
  const refPath = join(getRefDir(campaignId), `${sanitizeName(characterName)}.png`);

  let refStat;
  try {
    refStat = await stat(refPath);
  } catch {
    return null;
  }

  const inputFilename = `ref_${sanitizeName(campaignId).slice(0, 8)}_${sanitizeName(characterName)}.png`;
  const inputPath = join(config.comfyuiInputDir, inputFilename);

  // Skip copy if staged file already exists with same size
  try {
    const inputStat = await stat(inputPath);
    if (inputStat.size === refStat.size) {
      return inputFilename;
    }
  } catch {
    // Doesn't exist yet — proceed with copy
  }

  try {
    await mkdir(config.comfyuiInputDir, { recursive: true });
    await copyFile(refPath, inputPath);
  } catch {
    return null;
  }

  return inputFilename;
}

/**
 * Save a generated image as the reference for a character.
 */
export async function saveCharacterRef(
  campaignId: string,
  characterName: string,
  imageData: Buffer
): Promise<string> {
  const dir = getRefDir(campaignId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sanitizeName(characterName)}.png`);
  await writeFile(path, imageData);
  return path;
}

/**
 * Auto-create character reference from a generated scene image (first image only).
 */
export async function ensureCharacterRef(
  campaignId: string,
  characterName: string,
  generatedImagePath: string
): Promise<void> {
  const refPath = join(getRefDir(campaignId), `${sanitizeName(characterName)}.png`);
  try {
    await stat(refPath);
    return; // already has reference
  } catch {
    // Doesn't exist — create it
  }

  try {
    const fullPath = join(config.outputDir, generatedImagePath);
    const imageData = await readFile(fullPath);
    await saveCharacterRef(campaignId, characterName, imageData);
  } catch {
    // Best effort
  }
}
