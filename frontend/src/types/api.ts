import type { SamplerPreset, ModelVariant } from "./caption"

export interface MagicPromptRequest {
  text: string
  width: number
  height: number
  style?: {
    mode: "photo" | "illustration"
    aesthetics: string
    lighting: string
    medium: string
    photo?: string
    art_style?: string
    color_palette: string[]
  }
}

export interface MagicPromptResponse {
  caption_json: string
  warnings: string[]
}

export interface StyleFuseSide {
  label: string
  mode: "photo" | "illustration"
  aesthetics: string
  lighting: string
  medium: string
  photo: string
  art_style: string
}

export interface StyleFuseRequest {
  form: StyleFuseSide
  mood: StyleFuseSide
}

export interface StyleFuseResponse {
  mode: "photo" | "illustration"
  aesthetics: string
  lighting: string
  medium: string
  photo: string
  art_style: string
}

/** Custom CFG (guidance) controls. Omit `cfg` to use the sampler preset's
 *  built-in schedule. When set, the backend builds a high→low per-step curve:
 *  `cfg` for the first `cfg_override_start` fraction of steps, then
 *  `cfg_override` for the tail (e.g. 3.5 → 2.0 for the last 30% at start 0.7). */
export interface CfgControls {
  cfg?: number
  cfg_override?: number
  cfg_override_start?: number
}

export interface GenerationRequest extends CfgControls {
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
  supports_inpaint?: boolean
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
  openrouter_model: string
  openrouter_free_only: boolean
  has_ideogram_api_key: boolean
  has_openrouter_api_key: boolean
  has_hf_token: boolean
  auto_structure_prompt: boolean
  auto_retry_on_collapse: boolean
  safety_moderation_enabled: boolean
  has_hive_text_key: boolean
  has_hive_visual_key: boolean
}

export interface SettingsUpdateRequest {
  model_variant?: ModelVariant
  magic_prompt_backend?: string
  openrouter_model?: string
  openrouter_free_only?: boolean
  ideogram_api_key?: string
  openrouter_api_key?: string
  hf_token?: string
  auto_structure_prompt?: boolean
  auto_retry_on_collapse?: boolean
  safety_moderation_enabled?: boolean
  hive_text_key?: string
  hive_visual_key?: string
}

// ── LoRA adapters ────────────────────────────────────────────────────────────

export interface LoraInfo {
  name: string
  weight: number
  source: string
  triggers?: string[]
}

export interface LoraListResponse {
  supported: boolean
  variant: ModelVariant | null
  available: string[]
  loaded: LoraInfo[]
  loras_dir: string
}

export interface LoraApplyRequest {
  filename?: string
  hf_repo?: string
  weight?: number
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

export interface EditResponse {
  job_id: string
  image_url: string
  width: number
  height: number
  /** Real seed + timing for diffusion edits (inpaint / remix / extend);
   *  null for non-diffusion edits (flatten-save, import). */
  seed?: number | null
  duration_ms?: number | null
  /** Whether the edit caption was actually grounded in the source image.
   *  false = requested but skipped (no OpenRouter key) or failed; null = N/A. */
  grounded?: boolean | null
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
