import { readFileSync } from "fs";
import { join } from "path";
import WebSocket from "ws";
import type { EventEmitter } from "events";
import { writeFile, mkdir } from "fs/promises";
import type { GenerateParams } from "./types";
import { config } from "../config";

const GENERATION_TIMEOUT = 120_000;
/** Upscale model for the hires-fix pixel pass (file in D:/ai-models/upscale) */
const DEFAULT_UPSCALE_MODEL = process.env.RPG_UPSCALE_MODEL ?? "RealESRGAN_x4plus.pth";

function roundTo8(n: number): number {
  return Math.round(n / 8) * 8;
}

/**
 * Remove tEXt/iTXt/zTXt chunks from a PNG. ComfyUI embeds the full prompt and workflow
 * there, so a shared image would otherwise carry its prompt.
 */
export function stripPngTextChunks(buffer: Buffer): Buffer {
  const SIGNATURE = buffer.subarray(0, 8);
  if (buffer.length < 8 || SIGNATURE.toString("hex") !== "89504e470d0a1a0a") return buffer;

  const kept: Buffer[] = [SIGNATURE];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return buffer; // malformed — leave untouched
    if (type !== "tEXt" && type !== "iTXt" && type !== "zTXt") {
      kept.push(buffer.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(kept);
}

export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
}
export type Workflow = Record<string, WorkflowNode>;

let baseWorkflow: Workflow | null = null;
const WORKFLOW_PATH = join(process.cwd(), "server/image/workflows/sdxl-scene.json");

function loadBaseWorkflow(): Workflow {
  if (!baseWorkflow) {
    // Sync read on first call only (cold start). After that, cached.
    baseWorkflow = JSON.parse(readFileSync(WORKFLOW_PATH, "utf-8"));
  }
  return JSON.parse(JSON.stringify(baseWorkflow));
}

export function buildWorkflow(params: GenerateParams): Workflow {
  const workflow = loadBaseWorkflow();
  workflow["1"].inputs.ckpt_name = params.checkpoint;

  // Track which node provides the model and clip to downstream nodes
  let modelSource: [string, number] = ["1", 0];
  let clipSource: [string, number] = ["1", 1];

  if (params.lora) {
    workflow["8"] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelSource,
        clip: clipSource,
        lora_name: params.lora.name,
        strength_model: params.lora.strength,
        strength_clip: params.lora.strength,
      },
    };
    modelSource = ["8", 0];
    clipSource = ["8", 1];
  }

  // IP-Adapter for character consistency
  if (params.referenceImagePath) {
    const weight = params.ipaWeight ?? 0.5;

    // Load reference image
    workflow["10"] = {
      class_type: "LoadImage",
      inputs: { image: params.referenceImagePath },
    };

    // Unified loader handles CLIP vision + IP-Adapter model automatically
    workflow["11"] = {
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        model: modelSource,
        preset: "PLUS (high strength)",
      },
    };

    // Apply IP-Adapter with linear weight for character-focused consistency.
    // "linear" preserves character features without bleeding reference background/style.
    // end_at 0.75 stops IPA influence before final detail refinement steps.
    workflow["12"] = {
      class_type: "IPAdapterAdvanced",
      inputs: {
        ipadapter: ["11", 1],
        clip_vision: ["11", 2],
        image: ["10", 0],
        model: ["11", 0],
        weight,
        weight_type: "linear",
        start_at: 0.0,
        end_at: 0.75,
        combine_embeds: "concat",
      },
    };

    modelSource = ["12", 0];
  }

  // CLIP skip — must happen before CLIP text encode nodes consume clipSource
  if (params.clipSkip && params.clipSkip > 1) {
    workflow["15"] = {
      class_type: "CLIPSetLastLayer",
      inputs: {
        clip: clipSource,
        stop_at_clip_layer: -(params.clipSkip),
      },
    };
    clipSource = ["15", 0];
  }

  // Wire everything to current model/clip source
  workflow["2"].inputs.clip = clipSource;
  workflow["3"].inputs.clip = clipSource;
  workflow["5"].inputs.model = modelSource;

  workflow["2"].inputs.text = params.positive;
  workflow["3"].inputs.text = params.negative;
  workflow["4"].inputs.width = params.width;
  workflow["4"].inputs.height = params.height;
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);
  workflow["5"].inputs.seed = seed;
  workflow["5"].inputs.cfg = params.cfg ?? 6.5;
  workflow["5"].inputs.steps = params.steps ?? 35;
  workflow["5"].inputs.sampler_name = params.sampler ?? "dpmpp_2m";
  workflow["5"].inputs.scheduler = params.scheduler ?? "karras";

  // Separate VAE — when provided, load it and wire VAEDecode away from checkpoint output
  if (params.vae) {
    workflow["9"] = {
      class_type: "VAELoader",
      inputs: { vae_name: params.vae },
    };
    workflow["6"].inputs.vae = ["9", 0];
  }

  // img2img — encode init image into latent space and use it instead of EmptyLatentImage
  if (params.initImagePath) {
    const vaeSource: [string, number] = params.vae ? ["9", 0] : ["1", 2];

    workflow["25"] = {
      class_type: "LoadImage",
      inputs: { image: params.initImagePath },
    };

    // Resize/crop the init image to the target frame — otherwise the latent inherits the
    // previous image's size and the computed width/height (orientation) are silently ignored.
    workflow["27"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["25", 0],
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "center",
      },
    };

    workflow["26"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["27", 0],
        vae: vaeSource,
      },
    };

    // Wire KSampler to use the encoded init image instead of EmptyLatentImage
    workflow["5"].inputs.latent_image = ["26", 0];
    workflow["5"].inputs.denoise = params.initDenoise ?? 0.6;
  }

  // Hires fix — pixel-space upscale + second KSampler pass for sharper detail.
  // Latent nearest-exact upscaling needs denoise >= ~0.5 to hide its artifacts, which then
  // drifts composition; decoding and upscaling in pixel space keeps 0.35-0.4 clean.
  if (params.hiresFix) {
    const vaeSource: [string, number] = params.vae ? ["9", 0] : ["1", 2];
    const scale = params.hiresFixScale ?? 1.5;
    const upscaleModel = params.upscaleModel === undefined ? DEFAULT_UPSCALE_MODEL : params.upscaleModel;

    workflow["20"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: vaeSource },
    };

    let upscaleSource: [string, number] = ["20", 0];
    if (upscaleModel) {
      workflow["22"] = {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: upscaleModel },
      };
      workflow["23"] = {
        class_type: "ImageUpscaleWithModel",
        inputs: { upscale_model: ["22", 0], image: ["20", 0] },
      };
      upscaleSource = ["23", 0];
    }

    // Resize to exact target (model output is 4x; plain path upscales directly)
    workflow["24"] = {
      class_type: "ImageScale",
      inputs: {
        image: upscaleSource,
        upscale_method: "lanczos",
        width: roundTo8(params.width * scale),
        height: roundTo8(params.height * scale),
        crop: "disabled",
      },
    };

    workflow["28"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["24", 0], vae: vaeSource },
    };

    workflow["21"] = {
      class_type: "KSampler",
      inputs: {
        model: modelSource,
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["28", 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: 15,
        cfg: params.cfg ?? 6.5,
        sampler_name: params.sampler ?? "dpmpp_2m",
        scheduler: params.scheduler ?? "karras",
        denoise: params.hiresFixDenoise ?? 0.4,
      },
    };

    // Redirect VAEDecode to take the hires pass output instead of the first KSampler
    workflow["6"].inputs.samples = ["21", 0];
  }

  // Face detail enhancement (ADetailer-style via FaceDetailer + UltralyticsDetectorProvider)
  // VAEDecode (node "6") already outputs the final decoded image regardless of whether
  // hiresFix is active, so FaceDetailer always reads from ["6", 0].
  if (params.faceDetailer) {
    // Determine VAE source for FaceDetailer inpaint pass
    const vaeSource: [string, number] = params.vae ? ["9", 0] : ["1", 2];

    // BBOX detector — whichever installed provider can actually load a face model
    const detector = getFaceDetector() ?? DEFAULT_FACE_DETECTOR;
    workflow["31"] = {
      class_type: detector.classType,
      inputs: {
        model_name: detector.model,
      },
    };

    // FaceDetailer: detect faces, crop, re-generate at higher res, composite back
    workflow["30"] = {
      class_type: "FaceDetailer",
      inputs: {
        image: ["6", 0],
        model: modelSource,
        clip: clipSource,
        vae: vaeSource,
        positive: ["2", 0],
        negative: ["3", 0],
        bbox_detector: ["31", 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: 20,
        cfg: params.cfg ?? 6.5,
        sampler_name: params.sampler ?? "dpmpp_2m",
        scheduler: params.scheduler ?? "karras",
        denoise: params.faceDetailerDenoise ?? 0.35,
        guide_size: 384,
        guide_size_for: true,
        max_size: 1024,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 10,
        bbox_crop_factor: 3.0,
        sam_detection_hint: "center-1",
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: "False",
        drop_size: 10,
        wildcard: "",
        cycle: 1,
      },
    };

    // Rewire SaveImage to consume FaceDetailer output instead of raw VAEDecode
    workflow["7"].inputs.images = ["30", 0];
  }

  return workflow;
}

/** Optional feature node groups that can be removed if ComfyUI rejects them */
const OPTIONAL_GROUPS: { name: string; nodes: string[]; strip: (wf: Workflow) => void }[] = [
  {
    name: "FaceDetailer",
    nodes: ["30", "31"],
    strip: (wf) => { wf["7"].inputs.images = ["6", 0]; },
  },
  {
    name: "IP-Adapter",
    nodes: ["10", "11", "12"],
    // Every consumer of the IPA model (base + hires KSampler, FaceDetailer) falls back to LoRA/checkpoint
    strip: (wf) => rewireSource(wf, "12", wf["8"] ? ["8", 0] : ["1", 0]),
  },
  {
    name: "upscale model",
    nodes: ["22", "23"],
    strip: (wf) => { if (wf["24"]) wf["24"].inputs.image = ["20", 0]; },
  },
];

/** Point every input that references `fromNode` at `to` instead. */
function rewireSource(wf: Workflow, fromNode: string, to: [string, number]): void {
  for (const node of Object.values(wf)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value[0] === fromNode) node.inputs[key] = to;
    }
  }
}

/**
 * Remove the optional groups named in ComfyUI's node_errors (all present groups if the
 * error body can't be parsed). Returns the names of the stripped groups.
 */
export function stripFailedOptionalNodes(wf: Workflow, errorBody: string): string[] {
  let failing: Set<string> | null = null;
  try {
    const parsed = JSON.parse(errorBody) as { node_errors?: Record<string, unknown> };
    if (parsed.node_errors && Object.keys(parsed.node_errors).length > 0) {
      failing = new Set(Object.keys(parsed.node_errors));
    }
  } catch {
    // not JSON — strip everything optional
  }

  const stripped: string[] = [];
  for (const group of OPTIONAL_GROUPS) {
    const present = group.nodes.some(id => wf[id]);
    const failed = failing === null || group.nodes.some(id => failing!.has(id));
    if (!present || !failed) continue;
    group.strip(wf);
    for (const id of group.nodes) delete wf[id];
    stripped.push(group.name);
  }
  return stripped;
}

export interface GenerateResult {
  filePath: string;
  /** The KSampler seed used — store this to allow exact reproduction. */
  seed: number;
}

export interface ProgressInfo {
  /** 0-100 for KSampler steps */
  percent: number;
  /** Which phase: loading, sampling, decoding, saving */
  phase: "loading" | "sampling" | "decoding" | "saving" | "done";
}

export async function generateImage(
  params: GenerateParams,
  campaignId: string,
  imageId: string,
  onProgress?: (info: ProgressInfo) => void
): Promise<GenerateResult> {
  const workflow = buildWorkflow(params);
  const seed = (workflow["5"]?.inputs?.seed as number) ?? 0;
  workflow["7"].inputs.filename_prefix = `${campaignId}_${imageId}`;

  const clientId = crypto.randomUUID();
  const ws = await openProgressSocket(clientId);
  try {
    let promptId: string;
    try {
      promptId = await submitPrompt(workflow, clientId);
    } catch (err) {
      // Strip only the optional feature groups ComfyUI rejected, then retry once
      if (!(err instanceof PromptRejectedError) || err.status !== 400) throw err;
      const stripped = stripFailedOptionalNodes(workflow, err.body);
      if (stripped.length === 0) throw err;
      for (const group of stripped) console.warn(`[ComfyUI] Stripping ${group} nodes (rejected by ComfyUI)`);
      promptId = await submitPrompt(workflow, clientId);
    }
    onProgress?.({ percent: 0, phase: "loading" });
    await waitForCompletion(ws, promptId, onProgress);
    const filename = await getOutputFilename(promptId);
    onProgress?.({ percent: 100, phase: "done" });
    return { filePath: await downloadOutput(filename, campaignId, imageId), seed };
  } finally {
    ws.close();
  }
}

class PromptRejectedError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`ComfyUI prompt submission failed: ${status} — ${body.slice(0, 200)}`);
  }
}

/** Open the progress socket BEFORE queueing, so no event for our prompt is missed. */
function openProgressSocket(clientId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${config.comfyuiWsUrl}?clientId=${clientId}`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("ComfyUI WebSocket connect timed out")); }, 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      // Permanent listener: a later socket error must never be unhandled (it would crash the process).
      // waitForCompletion notices the drop via its own listeners / readyState and falls back to polling.
      ws.on("error", (err) => console.warn("[ComfyUI] progress socket error:", err.message));
      resolve(ws);
    });
    ws.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

async function submitPrompt(workflow: Workflow, clientId: string): Promise<string> {
  const res = await fetch(`${config.comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) throw new PromptRejectedError(res.status, await res.text().catch(() => ""));
  return (await res.json()).prompt_id;
}

async function downloadOutput(filename: string, campaignId: string, imageId: string): Promise<string> {
  const imageResponse = await fetch(`${config.comfyuiUrl}/view?filename=${encodeURIComponent(filename)}`);
  if (!imageResponse.ok) throw new Error("Failed to fetch generated image from ComfyUI");
  const buffer = stripPngTextChunks(Buffer.from(await imageResponse.arrayBuffer()));
  const outputDir = join(config.outputDir, campaignId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, `${imageId}.png`), buffer);
  return `rpg/${campaignId}/${imageId}.png`;
}

/** Best-effort: ask ComfyUI to abort the currently executing prompt. */
async function interruptComfyUI(): Promise<void> {
  try {
    await fetch(`${config.comfyuiUrl}/interrupt`, { method: "POST", signal: AbortSignal.timeout(3000) });
  } catch (err) {
    console.warn("[ComfyUI] interrupt after timeout failed:", err instanceof Error ? err.message : err);
  }
}

type ProgressSocket = Pick<EventEmitter, "on"> & { close(): void; readyState?: number };

/**
 * Wait for one prompt to finish. Completion is per prompt: an `executing`
 * event with node null, an `execution_success`, or the SaveImage node ("7")
 * reaching "finished" in progress_state. If the socket drops, poll /history
 * until the prompt has outputs.
 */
export function waitForCompletion(
  ws: ProgressSocket,
  promptId: string,
  onProgress?: (info: ProgressInfo) => void,
  opts: { timeoutMs?: number; pollMs?: number; slowPollMs?: number; isDone?: (promptId: string) => Promise<boolean> } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? GENERATION_TIMEOUT;
  const pollMs = opts.pollMs ?? 2000;
  const slowPollMs = opts.slowPollMs ?? 10_000;
  const isDone = opts.isDone ?? historyHasOutputs;
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(pollTimer);
      clearInterval(slowTimer);
      try { ws.close(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve();
    };
    const timeout = setTimeout(() => {
      // Stop the render itself: otherwise the GPU lease is released while ComfyUI keeps using the GPU.
      // Reject only after the interrupt attempt (bounded at 3s) so the lease isn't released first.
      void interruptComfyUI().then(() => finish(new Error("ComfyUI generation timed out")));
    }, timeoutMs);
    const poll = async () => {
      if (settled) return;
      try {
        if (await isDone(promptId)) return finish();
      } catch {
        // ComfyUI briefly unreachable — keep polling until the timeout
      }
      if (settled) return;
      pollTimer = setTimeout(() => void poll(), pollMs); // poll() handles its own errors
    };
    // Safety net: a completion event we never saw must not hang us until the timeout
    const slowTimer = setInterval(() => {
      void isDone(promptId).then((done) => { if (done) finish(); }, () => { /* keep waiting */ });
    }, slowPollMs);

    ws.on("message", (data: Buffer) => {
      let msg: { type?: string; data?: Record<string, unknown> };
      try { msg = JSON.parse(data.toString()); } catch { return; } // binary preview frames
      const d = msg.data ?? {};
      if (d.prompt_id !== promptId) return;
      if (msg.type === "execution_error") return finish(new Error(`ComfyUI execution error: ${String(d.exception_message ?? "unknown error")}`));
      if (msg.type === "execution_success" || (msg.type === "executing" && d.node === null)) return finish();
      if (msg.type === "progress") {
        onProgress?.({ percent: Math.round((Number(d.value) / Number(d.max)) * 100), phase: "sampling" });
      }
      if (msg.type === "progress_state") {
        const nodes = d.nodes as Record<string, { state: string }>;
        for (const [nodeId, node] of Object.entries(nodes ?? {})) {
          if (node.state !== "running") continue;
          if (nodeId === "1") onProgress?.({ percent: 0, phase: "loading" });
          else if (nodeId === "6") onProgress?.({ percent: 95, phase: "decoding" });
          else if (nodeId === "7") onProgress?.({ percent: 98, phase: "saving" });
        }
        if (nodes?.["7"]?.state === "finished") finish();
      }
    });
    let polling = false;
    const startPolling = () => {
      if (polling) return;
      polling = true;
      void poll();
    };
    ws.on("error", startPolling);
    ws.on("close", startPolling);
    // The socket may have dropped before these listeners were attached (CLOSING=2, CLOSED=3)
    if (ws.readyState !== undefined && ws.readyState >= 2) startPolling();
  });
}

async function historyHasOutputs(promptId: string): Promise<boolean> {
  const res = await fetch(`${config.comfyuiUrl}/history/${promptId}`);
  if (!res.ok) return false;
  const history = await res.json();
  const outputs = history[promptId]?.outputs as Record<string, { images?: unknown[] }> | undefined;
  return !!outputs && Object.values(outputs).some((o) => (o.images?.length ?? 0) > 0);
}

/**
 * Get the output filename from ComfyUI history API. ComfyUI emits the completion
 * event BEFORE it writes the /history entry, so retry briefly while it is missing.
 */
export async function getOutputFilename(promptId: string): Promise<string> {
  const ATTEMPTS = 10;
  const PAUSE_MS = 300;
  let lastError = new Error(`No history found for prompt ${promptId}`);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const response = await fetch(`${config.comfyuiUrl}/history/${promptId}`);
    if (!response.ok) {
      lastError = new Error(`Failed to fetch history for prompt ${promptId}`);
      continue;
    }
    const history = await response.json();
    const promptHistory = history[promptId];
    if (!promptHistory) {
      lastError = new Error(`No history found for prompt ${promptId}`);
      continue;
    }
    for (const nodeOutput of Object.values(promptHistory.outputs ?? {})) {
      const images = (nodeOutput as Record<string, unknown>)?.images as { filename: string }[] | undefined;
      if (images?.[0]?.filename) return images[0].filename;
    }
    lastError = new Error("No image found in ComfyUI history output");
  }
  throw lastError;
}

export async function isComfyUIAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.comfyuiUrl}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Cache of which optional node types are available in this ComfyUI instance. */
let availableNodes: Set<string> | null = null;
/** Face bbox detector usable in this instance (node class + model file), from object_info */
let faceDetector: FaceDetector | null = null;

interface FaceDetector { classType: string; model: string }
const DEFAULT_FACE_DETECTOR: FaceDetector = { classType: "UltralyticsDetectorProvider", model: "bbox/face_yolov8m.pt" };

/** Read a combo input's options from object_info (old `[[...]]` and new `["COMBO", {options}]` formats). */
export function comboOptions(nodeInfo: unknown, input: string): string[] {
  const spec = (nodeInfo as { input?: { required?: Record<string, unknown[]> } })?.input?.required?.[input];
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0] as string[];
  const opts = (spec[1] as { options?: unknown })?.options;
  return Array.isArray(opts) ? opts as string[] : [];
}

/**
 * Pick a face detector that can actually load a model. Ultralytics (Impact Subpack) loads
 * .pt files; ONNXDetectorProvider only lists .onnx files.
 */
export function pickFaceDetector(objectInfo: Record<string, unknown>): FaceDetector | null {
  const ultra = comboOptions(objectInfo["UltralyticsDetectorProvider"], "model_name");
  const ultraFace = ultra.find(m => /face/i.test(m) && m.startsWith("bbox/"));
  if (ultraFace) return { classType: "UltralyticsDetectorProvider", model: ultraFace };
  const onnxFace = comboOptions(objectInfo["ONNXDetectorProvider"], "model_name").find(m => /face/i.test(m));
  if (onnxFace) return { classType: "ONNXDetectorProvider", model: onnxFace };
  return null;
}

export function getFaceDetector(): FaceDetector | null {
  return faceDetector;
}

/** Probe ComfyUI for installed node types. Cached after first call. */
export async function probeAvailableNodes(): Promise<Set<string>> {
  if (availableNodes) return availableNodes;
  try {
    const response = await fetch(`${config.comfyuiUrl}/object_info`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return new Set();
    const data = await response.json() as Record<string, unknown>;
    availableNodes = new Set(Object.keys(data));
    faceDetector = pickFaceDetector(data);
    if (availableNodes.has("FaceDetailer") && !faceDetector) {
      console.warn("[ComfyUI] FaceDetailer installed but no usable face detector model — install ComfyUI-Impact-Subpack for bbox/face_yolov8m.pt");
    }
    return availableNodes;
  } catch {
    return new Set();
  }
}

/** Check if specific optional nodes are installed. */
export function hasNode(name: string): boolean {
  return availableNodes?.has(name) ?? false;
}

/** Check if face detailer nodes are available AND a detector can load a face model. */
export function hasFaceDetailer(): boolean {
  return hasNode("FaceDetailer") && faceDetector !== null;
}

/** Check if IP-Adapter nodes are available. */
export function hasIPAdapter(): boolean {
  return hasNode("IPAdapterUnifiedLoader") && hasNode("IPAdapterAdvanced");
}
