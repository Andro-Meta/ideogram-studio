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
  status: "unloaded" | "loading" | "ready" | "error"
  variant: ModelVariant | null
  vram_used_mb: number | null
  error: string | null
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
