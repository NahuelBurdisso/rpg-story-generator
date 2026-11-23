import { describe, it, expect } from "vitest";
import { stripPngTextChunks } from "@/server/image/comfyuiClient";
import { genderOf } from "@/server/image/portraitGenerator";
import { isMultiSubject, isGoodAutoReference } from "@/server/image/imageOrchestrator";
import { reorderByPriority } from "@/server/image/promptWriter";

describe("portrait gender", () => {
  it("classifies 1woman as female (not male via substring 'man')", () => {
    expect(genderOf("1woman")).toBe("female");
    expect(genderOf("1girl")).toBe("female");
    expect(genderOf("1man")).toBe("male");
    expect(genderOf("1boy")).toBe("male");
    expect(genderOf("1person, androgynous")).toBeNull();
    expect(genderOf("1droid")).toBeNull();
  });
});

describe("stripPngTextChunks", () => {
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  }
  const SIG = Buffer.from("89504e470d0a1a0a", "hex");

  it("removes tEXt/iTXt chunks and keeps image chunks", () => {
    const png = Buffer.concat([
      SIG,
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.from("prompt\0{\"secret\":1}", "latin1")),
      chunk("iTXt", Buffer.from("workflow", "latin1")),
      chunk("IDAT", Buffer.from([1, 2, 3])),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const out = stripPngTextChunks(png);
    expect(out.toString("latin1")).not.toContain("secret");
    expect(out.toString("latin1")).not.toContain("tEXt");
    expect(out.toString("latin1")).toContain("IDAT");
    expect(out.toString("latin1")).toContain("IEND");
  });

  it("returns non-PNG buffers unchanged", () => {
    const buf = Buffer.from("not a png");
    expect(stripPngTextChunks(buf)).toBe(buf);
  });
});

describe("IP-Adapter subject handling", () => {
  it("detects multi-person prompts", () => {
    expect(isMultiSubject("1woman, 1man, embracing")).toBe(true);
    expect(isMultiSubject("2women, tavern")).toBe(true);
    expect(isMultiSubject("couple, kissing")).toBe(true);
    expect(isMultiSubject("1woman, solo, forest")).toBe(false);
  });

  it("only accepts clean close single-subject shots as auto reference", () => {
    expect(isGoodAutoReference("1woman, red hair", "close-up")).toBe(true);
    expect(isGoodAutoReference("1woman, red hair", "wide-shot")).toBe(false);
    expect(isGoodAutoReference("1woman, 1man", "close-up")).toBe(false);
  });
});

describe("reorderByPriority with weighted quality tags", () => {
  it("sinks weighted quality tags below the subject", () => {
    const result = reorderByPriority("(masterpiece:1.2), dark cave, 1woman, red hair").split(", ");
    expect(result.indexOf("(masterpiece:1.2)")).toBe(result.length - 1);
    expect(result[0]).toBe("1woman");
  });
});

describe("ComfyUI optional-node fallback", () => {
  it("strips only the group named in node_errors and rewires all IPA consumers", async () => {
    const { buildWorkflow, stripFailedOptionalNodes } = await import("@/server/image/comfyuiClient");
    const wf = buildWorkflow({
      positive: "1woman", negative: "", width: 832, height: 1216, checkpoint: "x.safetensors",
      referenceImagePath: "ref.png", hiresFix: true, faceDetailer: true,
    });
    const stripped = stripFailedOptionalNodes(wf, JSON.stringify({ node_errors: { "11": { errors: [] } } }));
    expect(stripped).toEqual(["IP-Adapter"]);
    expect(wf["12"]).toBeUndefined();
    expect(wf["5"].inputs.model).toEqual(["1", 0]);
    expect(wf["21"].inputs.model).toEqual(["1", 0]);
    expect(wf["30"].inputs.model).toEqual(["1", 0]);
    // Upscaler and FaceDetailer untouched
    expect(wf["23"]).toBeDefined();
    expect(wf["30"]).toBeDefined();
  });

  it("strips every present group when the error body is not parseable", async () => {
    const { buildWorkflow, stripFailedOptionalNodes } = await import("@/server/image/comfyuiClient");
    const wf = buildWorkflow({
      positive: "1woman", negative: "", width: 832, height: 1216, checkpoint: "x.safetensors",
      hiresFix: true, faceDetailer: true,
    });
    expect(stripFailedOptionalNodes(wf, "Bad Request")).toEqual(["FaceDetailer", "upscale model"]);
    expect(wf["7"].inputs.images).toEqual(["6", 0]);
    expect(wf["24"].inputs.image).toEqual(["20", 0]);
  });

  it("picks a face detector only when a loadable face model exists", async () => {
    const { pickFaceDetector } = await import("@/server/image/comfyuiClient");
    const onnxEmpty = { ONNXDetectorProvider: { input: { required: { model_name: [[]] } } } };
    expect(pickFaceDetector(onnxEmpty)).toBeNull();
    const ultra = { UltralyticsDetectorProvider: { input: { required: { model_name: ["COMBO", { options: ["bbox/face_yolov8m.pt", "segm/person.pt"] }] } } } };
    expect(pickFaceDetector(ultra)).toEqual({ classType: "UltralyticsDetectorProvider", model: "bbox/face_yolov8m.pt" });
  });
});

describe("img2img compatibility", () => {
  it("continues only same location and orientation", async () => {
    const { isImg2ImgCompatible } = await import("@/server/image/imageOrchestrator");
    const base = { location: "taberna", width: 1216, height: 832 };
    expect(isImg2ImgCompatible(base, { ...base })).toBe(true);
    expect(isImg2ImgCompatible(base, { ...base, width: 832, height: 1216 })).toBe(false);
    expect(isImg2ImgCompatible(base, { ...base, location: "bosque" })).toBe(false);
    expect(isImg2ImgCompatible({ ...base, location: null }, { ...base, location: null })).toBe(false);
  });
});
