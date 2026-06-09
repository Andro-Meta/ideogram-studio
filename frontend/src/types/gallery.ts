import type { SamplerPreset, ModelVariant } from "./caption"

export interface GalleryItem {
  id: string
  status: string
  prompt_json: string | null
  prompt_text: string | null
  image_path: string | null
  seed: number | null
  width: number | null
  height: number | null
  sampler_preset: SamplerPreset | null
  model_variant: ModelVariant | null
  duration_ms: number | null
  created_at: string
  error_message: string | null
  favorite: boolean
}

export interface GalleryListResponse {
  items: GalleryItem[]
  total: number
}
