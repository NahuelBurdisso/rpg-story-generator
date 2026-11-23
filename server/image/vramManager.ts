import { exec } from "child_process";
import { promisify } from "util";
import { tryHoldGpu, releaseGpu, isGpuHeld } from "../llm/gpuGate";

const execAsync = promisify(exec);

export interface VramLease {
  release(): Promise<void>;
}

interface AcquireOptions {
  skipVramCheck?: boolean;
}

/**
 * Take the GPU for an image generation: hold the gate (so Ollama calls wait),
 * unload whatever models Ollama has loaded, and wait for VRAM to free up.
 * Returns null if another generation holds it or VRAM never frees.
 */
export async function acquireForImageGen(ollamaBaseUrl: string, options?: AcquireOptions): Promise<VramLease | null> {
  const token = tryHoldGpu();
  if (!token) return null;
  const lease: VramLease = { release: async () => { releaseGpu(token); } };
  try {
    if (!options?.skipVramCheck && await checkVRAMOnce(10_000)) return lease;
    await unloadOllamaModels(ollamaBaseUrl);
    if (options?.skipVramCheck) return lease;
    if (await waitForVRAM(10_000, 30_000)) return lease;
    await lease.release();
    return null;
  } catch (err) {
    await lease.release();
    throw err;
  }
}

export function isImageGenActive(): boolean {
  return isGpuHeld();
}

/** Unload every model Ollama reports as loaded (not just the user's selected one). */
async function unloadOllamaModels(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const { models } = (await res.json()) as { models?: { name: string }[] };
    await Promise.all((models ?? []).map((m) =>
      fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => console.warn("[vram] unload failed for", m.name, err))));
  } catch {
    // Ollama not running — nothing is holding VRAM
  }
}

/** Single non-blocking VRAM check. Returns true if free VRAM >= threshold. */
async function checkVRAMOnce(thresholdMB: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits",
      { timeout: 5000 }
    );
    const [used, total] = stdout.trim().split(",").map(s => parseInt(s.trim(), 10));
    return (total - used) >= thresholdMB;
  } catch {
    return true; // nvidia-smi not available — assume free
  }
}

/** Poll VRAM until free >= threshold or timeout. Non-blocking between polls. */
async function waitForVRAM(thresholdMB: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkVRAMOnce(thresholdMB)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
