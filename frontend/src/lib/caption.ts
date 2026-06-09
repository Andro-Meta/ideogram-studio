/**
 * Caption JSON utilities for the frontend.
 * Mirrors the backend caption.py logic for display purposes.
 */
import type { PromptState, StyleDescription } from "@/types/caption"

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

export function isValidHex(color: string): boolean {
  return HEX_RE.test(color)
}

export function normalizeHex(input: string): string {
  let c = input.trim()
  if (!c.startsWith("#")) c = "#" + c
  return c.toUpperCase().slice(0, 7)
}

/** Count words in a string. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Validate a PromptState and return a list of warning strings. */
export function validatePromptState(state: PromptState): string[] {
  const warnings: string[] = []

  if (wordCount(state.high_level_description) > 50) {
    warnings.push("High-level description exceeds 50 words — quality may degrade.")
  }

  if (!state.background.trim()) {
    warnings.push("Background description is empty.")
  }

  for (const [i, el] of state.elements.entries()) {
    if (!el.desc.trim()) {
      warnings.push(`Element ${i + 1} has no description.`)
    }
    if (wordCount(el.desc) > 60) {
      warnings.push(`Element ${i + 1} description exceeds 60 words.`)
    }
    if (el.type === "text" && !el.text?.trim()) {
      warnings.push(`Text element ${i + 1} has no text content.`)
    }
    const badColors = (el.color_palette ?? []).filter((c) => !isValidHex(c))
    if (badColors.length) {
      warnings.push(`Element ${i + 1} has invalid colors: ${badColors.join(", ")}`)
    }
  }

  const badGlobal = (state.style_description.color_palette ?? []).filter(
    (c) => !isValidHex(c)
  )
  if (badGlobal.length) {
    warnings.push(`Style palette has invalid colors: ${badGlobal.join(", ")}`)
  }

  return warnings
}

/** Human-readable summary of a sampler preset. */
export const PRESET_LABELS: Record<string, { name: string; steps: string; time: string }> = {
  V4_TURBO_12:   { name: "Turbo",   steps: "12 steps", time: "~15s" },
  V4_DEFAULT_20: { name: "Default", steps: "20 steps", time: "~25s" },
  V4_QUALITY_48: { name: "Quality", steps: "48 steps", time: "~60s" },
}

export const ASPECT_RATIO_PRESETS = [
  { label: "1:1",   width: 1024, height: 1024 },
  { label: "4:3",   width: 1024, height: 768  },
  { label: "3:4",   width: 768,  height: 1024 },
  { label: "16:9",  width: 1280, height: 720  },
  { label: "9:16",  width: 720,  height: 1280 },
  { label: "21:9",  width: 1512, height: 648  },
  { label: "3:2",   width: 1024, height: 688  },
]

export const ELEMENT_COLORS = [
  { border: "border-violet-500", bg: "bg-violet-500/20", text: "text-violet-300" },
  { border: "border-cyan-500",   bg: "bg-cyan-500/20",   text: "text-cyan-300"   },
  { border: "border-emerald-500",bg: "bg-emerald-500/20",text: "text-emerald-300"},
  { border: "border-amber-500",  bg: "bg-amber-500/20",  text: "text-amber-300"  },
  { border: "border-rose-500",   bg: "bg-rose-500/20",   text: "text-rose-300"   },
  { border: "border-blue-500",   bg: "bg-blue-500/20",   text: "text-blue-300"   },
  { border: "border-orange-500", bg: "bg-orange-500/20", text: "text-orange-300" },
  { border: "border-pink-500",   bg: "bg-pink-500/20",   text: "text-pink-300"   },
]

export function elementColor(index: number) {
  return ELEMENT_COLORS[index % ELEMENT_COLORS.length]
}

export function snapTo16(value: number): number {
  return Math.max(256, Math.min(2048, Math.round(value / 16) * 16))
}

/**
 * Build the Ideogram 4 caption JSON string from a PromptState.
 * Key ordering matches the backend caption.py OrderedDict exactly.
 */
export function buildCaption(state: PromptState): string {
  const style: Record<string, unknown> = {}
  if (state.style_description.aesthetics) style.aesthetics = state.style_description.aesthetics
  if (state.style_description.lighting) style.lighting = state.style_description.lighting
  if (state.style_description.medium) style.medium = state.style_description.medium
  if (state.style_description.mode === "photo") {
    if (state.style_description.photo) style.photo = state.style_description.photo
  } else {
    if (state.style_description.art_style) style.art_style = state.style_description.art_style
  }
  if (state.style_description.color_palette.length > 0) {
    style.color_palette = state.style_description.color_palette
  }

  const elements = state.elements.map((el) => {
    const e: Record<string, unknown> = { type: el.type }
    if (el.bbox) {
      e.bbox = [el.bbox.ymin, el.bbox.xmin, el.bbox.ymax, el.bbox.xmax]
    }
    if (el.type === "text" && el.text) {
      e.text = el.text
    }
    e.desc = el.desc
    if (el.color_palette.length > 0) {
      e.color_palette = el.color_palette
    }
    return e
  })

  const caption: Record<string, unknown> = {
    high_level_description: state.high_level_description,
    style_description: style,
    compositional_deconstruction: {
      background: state.background,
      elements,
    },
  }

  return JSON.stringify(caption)
}
