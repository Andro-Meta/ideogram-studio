import type { SamplerPreset, ModelVariant } from "./caption"

export interface MagicPromptRequest {
  text: string
  width: number
  height: number
}

export interface MagicPromptResponse {
  caption_json: string
  warnings: string[]
}

export interface GenerationRequest {
  prompt_json: string
  height: number
  width: number
  sampler_preset: SamplerPreset
  seed: number | null
  model_variant: ModelVariant
}

export type WsMessageType = "started" | "status" | "progress" | "done" | "error"

export type WsMessage =
  | { type: "started";  job_id: string }
  | { type: "status";   message: string }
  | { type: "progress"; step: number; total: number }
  | { type: "done";     image_url: string; seed: number; duration_ms: number }
  | { type: "error";    message: string }

export interface ModelStatusResponse {
  status: "unloaded" | "downloading" | "loading" | "ready" | "error"
  variant: ModelVariant | null
  vram_used_mb: number | null
  error: string | null
  progress_message: string | null
  download_pct: number | null
}

// ── System / hardware report ─────────────────────────────────────────────────

export interface VariantRequirements {
  download_gb: number
  vram_gb: number
  ram_gb: number
  label: string
}

export interface VariantAssessment {
  variant: ModelVariant
  cached: boolean
  blockers: string[]
  warnings: string[]
  requirements: VariantRequirements
  recommended: boolean
}

export interface SystemInfoResponse {
  gpu_name: string | null
  vram_total_gb: number | null
  vram_free_gb: number | null
  gpu_processes: string[]
  ram_total_gb: number | null
  ram_available_gb: number | null
  commit_limit_gb: number | null
  commit_available_gb: number | null
  disk_free_gb: number | null
  models_dir: string
  recommended_variant: ModelVariant
  variants: VariantAssessment[]
}

export interface SettingsResponse {
  model_variant: ModelVariant
  magic_prompt_backend: string
  has_ideogram_api_key: boolean
  has_openrouter_api_key: boolean
  has_hf_token: boolean
}

export interface SettingsUpdateRequest {
  model_variant?: ModelVariant
  magic_prompt_backend?: string
  ideogram_api_key?: string
  openrouter_api_key?: string
  hf_token?: string
}

// ── Upscaling ────────────────────────────────────────────────────────────────

export interface UpscaleRequest {
  job_id: string
  model_name: string
}

export interface UpscaleResponse {
  image_url: string
  original_width: number
  original_height: number
  upscaled_width: number
  upscaled_height: number
}

// ── Image editing ────────────────────────────────────────────────────────────

export interface EditRequest {
  job_id: string
  rotate: 0 | 90 | 180 | 270
  flip_h: boolean
  flip_v: boolean
  brightness: number
  contrast: number
  saturation: number
  sharpness: number
}

export interface EditResponse {
  job_id: string
  image_url: string
  width: number
  height: number
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export interface LogsResponse {
  lines: string[]
  path: string
}

export interface UpscaleModelInfo {
  name: string
  scale: number
  label: string
  description: string
}
