import type { BBox } from "@/lib/bbox"

export type { BBox }

export type ElementType = "obj" | "text"
export type StyleMode = "photo" | "illustration"
export type SamplerPreset = "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"
export type ModelVariant = "fp8" | "bf16"

export interface ObjElement {
  id: string
  type: "obj"
  bbox?: BBox
  desc: string
  color_palette: string[]
}

export interface TextElement {
  id: string
  type: "text"
  bbox?: BBox
  text: string
  desc: string
  color_palette: string[]
}

export type AnyElement = ObjElement | TextElement

export interface StyleDescription {
  mode: StyleMode
  aesthetics: string
  lighting: string
  medium: string
  photo: string          // photo mode only
  art_style: string      // illustration mode only
  color_palette: string[]
}

export interface PromptState {
  high_level_description: string
  style_description: StyleDescription
  background: string
  elements: AnyElement[]
}

export const defaultStyleDescription = (): StyleDescription => ({
  mode: "photo",
  aesthetics: "",
  lighting: "",
  medium: "",
  photo: "",
  art_style: "",
  color_palette: [],
})

export const defaultPromptState = (): PromptState => ({
  high_level_description: "",
  style_description: defaultStyleDescription(),
  background: "",
  elements: [],
})
