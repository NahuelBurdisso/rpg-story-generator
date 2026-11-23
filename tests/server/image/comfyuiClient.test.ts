import { describe, it, expect, vi } from "vitest";
import { buildWorkflow, isComfyUIAvailable } from "@/server/image/comfyuiClient";
import type { WorkflowNode } from "@/server/image/comfyuiClient";

vi.stubGlobal("fetch", vi.fn());

describe("comfyuiClient", () => {
  describe("buildWorkflow", () => {
    it("injects positive prompt into workflow", () => {
      const workflow = buildWorkflow({
        positive: "a dragon in a dark cave",
        negative: "blurry, deformed",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      const parsed = JSON.parse(JSON.stringify(workflow));
      const nodes = Object.values(parsed) as WorkflowNode[];
      const positiveNode = nodes.find((n) =>
        n.class_type === "CLIPTextEncode" && n.inputs?.text === "a dragon in a dark cave"
      );
      expect(positiveNode).toBeDefined();
    });

    it("injects dimensions into EmptyLatentImage", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1216,
        height: 832,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const latentNode = nodes.find((n) => n.class_type === "EmptyLatentImage");
      expect(latentNode!.inputs.width).toBe(1216);
      expect(latentNode!.inputs.height).toBe(832);
    });

    it("includes LoRA node when lora provided", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        lora: { name: "fantasy.safetensors", strength: 0.8 },
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const loraNode = nodes.find((n) => n.class_type === "LoraLoader");
      expect(loraNode).toBeDefined();
      expect(loraNode!.inputs.lora_name).toBe("fantasy.safetensors");
      expect(loraNode!.inputs.strength_model).toBe(0.8);
    });

    it("adds IP-Adapter nodes when referenceImagePath provided", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        referenceImagePath: "refs/warrior.png",
        ipaWeight: 0.7,
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const loadImage = nodes.find((n) => n.class_type === "LoadImage");
      const ipaLoader = nodes.find((n) => n.class_type === "IPAdapterUnifiedLoader");
      const ipaNode = nodes.find((n) => n.class_type === "IPAdapterAdvanced");

      expect(loadImage).toBeDefined();
      expect(loadImage!.inputs.image).toBe("refs/warrior.png");
      expect(ipaLoader).toBeDefined();
      expect(ipaNode).toBeDefined();
      expect(ipaNode!.inputs.weight).toBe(0.7);
    });

    it("does NOT add IP-Adapter nodes without referenceImagePath", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const ipaNode = nodes.find((n) => n.class_type === "IPAdapterAdvanced");
      expect(ipaNode).toBeUndefined();
    });

    it("IP-Adapter model receives output from LoRA when both active", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        lora: { name: "style.safetensors", strength: 0.5 },
        referenceImagePath: "refs/char.png",
      });
      // IP-Adapter should receive model from UnifiedLoader (node 11), which itself gets LoRA output
      expect(workflow["12"].inputs.model).toEqual(["11", 0]);
      // KSampler should receive model from IP-Adapter (node 12)
      expect(workflow["5"].inputs.model).toEqual(["12", 0]);
    });

    it("adds hires fix nodes when hiresFix is true", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        hiresFix: true,
      });
      // Pixel-space upscale: decode first pass → upscale model → resize to 1.5x → re-encode
      expect(workflow["20"].class_type).toBe("VAEDecode");
      expect(workflow["20"].inputs.samples).toEqual(["5", 0]);
      expect(workflow["22"].class_type).toBe("UpscaleModelLoader");
      expect(workflow["23"].class_type).toBe("ImageUpscaleWithModel");
      expect(workflow["23"].inputs.image).toEqual(["20", 0]);
      expect(workflow["24"].class_type).toBe("ImageScale");
      expect(workflow["24"].inputs.image).toEqual(["23", 0]);
      expect(workflow["24"].inputs.width).toBe(1536);
      expect(workflow["24"].inputs.height).toBe(1536);
      expect(workflow["28"].class_type).toBe("VAEEncode");
      expect(workflow["28"].inputs.pixels).toEqual(["24", 0]);
      // Second KSampler node must exist with correct denoise
      expect(workflow["21"]).toBeDefined();
      expect(workflow["21"].class_type).toBe("KSampler");
      expect(workflow["21"].inputs.steps).toBe(15);
      expect(workflow["21"].inputs.denoise).toBe(0.4);
      expect(workflow["21"].inputs.latent_image).toEqual(["28", 0]);
      // VAEDecode (node 6) must be wired to the hires KSampler output, not the first
      expect(workflow["6"].inputs.samples).toEqual(["21", 0]);
    });

    it("hires fix uses plain lanczos resize when upscaleModel is null", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 832,
        height: 1216,
        checkpoint: "juggernautXL_v9.safetensors",
        hiresFix: true,
        upscaleModel: null,
      });
      expect(workflow["22"]).toBeUndefined();
      expect(workflow["23"]).toBeUndefined();
      expect(workflow["24"].inputs.image).toEqual(["20", 0]);
      // Target size rounded to a multiple of 8
      expect(workflow["24"].inputs.width).toBe(1248);
      expect(workflow["24"].inputs.height).toBe(1824);
    });

    it("does NOT add hires fix nodes by default", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      expect(workflow["20"]).toBeUndefined();
      expect(workflow["21"]).toBeUndefined();
    });

    it("adds CLIPSetLastLayer when clipSkip > 1", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        clipSkip: 2,
      });
      expect(workflow["15"]).toBeDefined();
      expect(workflow["15"].class_type).toBe("CLIPSetLastLayer");
      expect(workflow["15"].inputs.stop_at_clip_layer).toBe(-2);
      // Both CLIP text encode nodes must use the CLIPSetLastLayer output
      expect(workflow["2"].inputs.clip).toEqual(["15", 0]);
      expect(workflow["3"].inputs.clip).toEqual(["15", 0]);
    });

    it("adds VAELoader node when vae is provided", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        vae: "sdxl_vae.safetensors",
      });
      expect(workflow["9"]).toBeDefined();
      expect(workflow["9"].class_type).toBe("VAELoader");
      expect(workflow["9"].inputs.vae_name).toBe("sdxl_vae.safetensors");
    });

    it("VAEDecode uses VAELoader output when vae is provided", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        vae: "sdxl_vae.safetensors",
      });
      expect(workflow["6"].inputs.vae).toEqual(["9", 0]);
    });

    it("VAEDecode uses checkpoint VAE when no separate vae", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      expect(workflow["9"]).toBeUndefined();
      // VAEDecode should still reference the checkpoint node output (from the base workflow JSON)
      expect(workflow["6"].inputs.vae).toEqual(["1", 2]);
    });

    it("adds FaceDetailer nodes when faceDetailer is true", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        faceDetailer: true,
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const faceDetailer = nodes.find((n) => n.class_type === "FaceDetailer");
      const bboxDetector = nodes.find((n) => n.class_type === "UltralyticsDetectorProvider" || n.class_type === "ONNXDetectorProvider");
      expect(faceDetailer).toBeDefined();
      expect(bboxDetector).toBeDefined();
      expect(bboxDetector!.inputs.model_name).toBe("bbox/face_yolov8m.pt");
    });

    it("FaceDetailer takes image from VAEDecode", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        faceDetailer: true,
      });
      expect(workflow["30"]).toBeDefined();
      expect(workflow["30"].inputs.image).toEqual(["6", 0]);
    });

    it("SaveImage is rewired to FaceDetailer output", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        faceDetailer: true,
      });
      expect(workflow["7"].inputs.images).toEqual(["30", 0]);
    });

    it("does NOT add FaceDetailer nodes by default", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      const nodes = Object.values(workflow) as WorkflowNode[];
      const faceDetailer = nodes.find((n) => n.class_type === "FaceDetailer");
      expect(faceDetailer).toBeUndefined();
      expect(workflow["30"]).toBeUndefined();
      expect(workflow["31"]).toBeUndefined();
      // SaveImage still points to VAEDecode
      expect(workflow["7"].inputs.images).toEqual(["6", 0]);
    });

    it("FaceDetailer still works with hiresFix (both active)", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        hiresFix: true,
        faceDetailer: true,
      });
      // Hires fix: VAEDecode (node 6) must read from second KSampler
      expect(workflow["6"].inputs.samples).toEqual(["21", 0]);
      // FaceDetailer still takes the VAEDecode output (node 6 already includes hires result)
      expect(workflow["30"].inputs.image).toEqual(["6", 0]);
      // SaveImage must be rewired to FaceDetailer, not VAEDecode
      expect(workflow["7"].inputs.images).toEqual(["30", 0]);
    });

    it("does NOT add CLIPSetLastLayer when clipSkip is 1 or undefined", () => {
      const workflowDefault = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      expect(workflowDefault["15"]).toBeUndefined();

      const workflowOne = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        clipSkip: 1,
      });
      expect(workflowOne["15"]).toBeUndefined();
    });

    it("adds LoadImage and VAEEncode nodes when initImagePath is provided", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
      });
      expect(workflow["25"]).toBeDefined();
      expect(workflow["25"].class_type).toBe("LoadImage");
      expect(workflow["25"].inputs.image).toBe("outputs/scene_001.png");
      expect(workflow["26"]).toBeDefined();
      expect(workflow["26"].class_type).toBe("VAEEncode");
    });

    it("resizes the init image to the target dimensions before encoding", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 832,
        height: 1216,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
      });
      expect(workflow["27"].class_type).toBe("ImageScale");
      expect(workflow["27"].inputs.image).toEqual(["25", 0]);
      expect(workflow["27"].inputs.width).toBe(832);
      expect(workflow["27"].inputs.height).toBe(1216);
      expect(workflow["27"].inputs.crop).toBe("center");
      expect(workflow["26"].inputs.pixels).toEqual(["27", 0]);
    });

    it("wires KSampler latent_image to VAEEncode output for img2img", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
      });
      expect(workflow["5"].inputs.latent_image).toEqual(["26", 0]);
    });

    it("sets KSampler denoise to initDenoise value for img2img", () => {
      const workflowCustomDenoise = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
        initDenoise: 0.4,
      });
      expect(workflowCustomDenoise["5"].inputs.denoise).toBe(0.4);

      // Default denoise when initDenoise is omitted
      const workflowDefaultDenoise = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
      });
      expect(workflowDefaultDenoise["5"].inputs.denoise).toBe(0.6);
    });

    it("does NOT add img2img nodes when initImagePath is absent", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
      });
      expect(workflow["25"]).toBeUndefined();
      expect(workflow["26"]).toBeUndefined();
    });

    it("EmptyLatentImage is NOT wired when initImagePath is present", () => {
      const workflow = buildWorkflow({
        positive: "test",
        negative: "test",
        width: 1024,
        height: 1024,
        checkpoint: "juggernautXL_v9.safetensors",
        initImagePath: "outputs/scene_001.png",
      });
      // KSampler must point to VAEEncode, not EmptyLatentImage
      expect(workflow["5"].inputs.latent_image).not.toEqual(["4", 0]);
      expect(workflow["5"].inputs.latent_image).toEqual(["26", 0]);
    });
  });

  describe("isComfyUIAvailable", () => {
    it("returns true when ComfyUI responds", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
      const result = await isComfyUIAvailable();
      expect(result).toBe(true);
    });

    it("returns false when ComfyUI is unreachable", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await isComfyUIAvailable();
      expect(result).toBe(false);
    });
  });
});
