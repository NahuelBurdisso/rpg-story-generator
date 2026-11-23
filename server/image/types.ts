import type { ImageStatus, ImageStyle, TriggerType } from "@/lib/enums";
import type { CustomImageConfig } from "@/server/db/jsonTypes";

// Single definitions live in lib/enums.ts and server/db/jsonTypes.ts; re-exported for the image subsystem.
export type { ImageStatus, ImageStyle, TriggerType, CustomImageConfig };

export type ShotScale =
  | "extreme-close-up" | "close-up" | "medium-close-up" | "medium-shot"
  | "medium-full" | "full-body" | "wide-shot" | "extreme-wide";

export type CameraAngle =
  | "eye-level" | "low-angle" | "high-angle" | "birds-eye" | "dutch-angle" | "over-shoulder";

export type DepthStyle = "shallow" | "deep" | "atmospheric";

export interface CinematographyResult {
  shotScale: ShotScale;
  cameraAngle: CameraAngle;
  depthStyle: DepthStyle;
  directorNote: string;
}

export interface PromptWriterResult {
  positive: string;
  negative: string;
  width: number;
  height: number;
  /** Suggested CFG based on prompt complexity (fewer tags → higher CFG, more tags → lower) */
  suggestedCfg?: number;
  shotScale?: ShotScale;  // NEW — used by orchestrator for IPA weight + param tuning
}

export interface GenerateParams {
  positive: string;
  negative: string;
  width: number;
  height: number;
  checkpoint: string;
  lora?: { name: string; strength: number };
  seed?: number;
  cfg?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  /** Path to character reference image for IP-Adapter consistency */
  referenceImagePath?: string;
  /** IP-Adapter weight 0.0-1.0 (default 0.6) */
  ipaWeight?: number;
  /** Enable hires fix second pass for sharper detail */
  hiresFix?: boolean;
  /** Hires fix denoise strength (default 0.4) */
  hiresFixDenoise?: number;
  /** Hires fix scale factor (default 1.5) */
  hiresFixScale?: number;
  /** CLIP skip layers (default 1, use 2 for anime models) */
  clipSkip?: number;
  /** Separate VAE model filename (if not using checkpoint's built-in VAE) */
  vae?: string;
  /** When true, structure the positive prompt with SDXL BREAK separators to prevent concept bleeding */
  useBreaks?: boolean;
  /** Enable face detail enhancement (ADetailer-style) */
  faceDetailer?: boolean;
  /** Face detailer denoise strength (default 0.35) */
  faceDetailerDenoise?: number;
  /** Source image path for img2img (init image) */
  initImagePath?: string;
  /** Denoise strength for img2img (0.0 = no change, 1.0 = full regeneration) */
  initDenoise?: number;
  /** Upscale model for hires fix pixel pass; null = plain lanczos resize. Default: RPG_UPSCALE_MODEL env or RealESRGAN_x4plus */
  upscaleModel?: string | null;
}

export interface StylePreset {
  checkpoint: string;
  lora: { name: string; strength: number } | null;
  negativePrompt: string;
  defaultDimensions: { width: number; height: number };
  tags: string;
  cfg: number;
  steps: number;
  sampler?: string;
  scheduler?: string;
  /** CLIP skip layers (default 1, use 2 for anime models) */
  clipSkip?: number;
  /** Separate VAE model (overrides checkpoint VAE when set) */
  vae?: string;
  /** Enable face detailer by default for this style */
  faceDetailer?: boolean;
}

