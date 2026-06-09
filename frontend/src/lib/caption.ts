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

// Ideogram 4 supports any resolution 256–2048 px (multiples of 16), aspect ratio ≤ 6:1.
// Max is ~2K equivalent — 4K (3840+) is NOT possible with this model.
//
// All preset dimensions are verified pixel-perfect: exact ratios AND valid multiples of 16.
// Verified with: node -e "check all pairs for w%16===0 && h%16===0 && w/h===exact_ratio"
export const ASPECT_RATIO_PRESETS = [
  // ── Standard — ~1MP, fast, good for most GPUs ─────────────────────────────────
  { label: "21:9",  width: 1792, height: 768,  group: "landscape" as const },  // 1792/768  = 7/3  ✓ (prev: 1512×648, 648÷16=40.5 — was WRONG)
  { label: "16:9",  width: 1280, height: 720,  group: "landscape" as const },  // 1280/720  = 16/9 ✓
  { label: "3:2",   width: 1152, height: 768,  group: "landscape" as const },  // 1152/768  = 3/2  ✓
  { label: "4:3",   width: 1024, height: 768,  group: "landscape" as const },  // 1024/768  = 4/3  ✓
  { label: "5:4",   width: 1280, height: 1024, group: "landscape" as const },  // 1280/1024 = 5/4  ✓
  { label: "1:1",   width: 1024, height: 1024, group: "square"    as const },
  { label: "4:5",   width: 1024, height: 1280, group: "portrait"  as const },  // 1024/1280 = 4/5  ✓
  { label: "3:4",   width: 768,  height: 1024, group: "portrait"  as const },  // 768/1024  = 3/4  ✓
  { label: "2:3",   width: 768,  height: 1152, group: "portrait"  as const },  // 768/1152  = 2/3  ✓
  { label: "9:16",  width: 720,  height: 1280, group: "portrait"  as const },  // 720/1280  = 9/16 ✓
  // ── HD — up to 2048px (max the model supports, ~2–4× more VRAM) ──────────────
  { label: "21:9",  width: 2016, height: 864,  group: "hd-landscape" as const }, // 2016/864  = 7/3  ✓
  { label: "16:9",  width: 2048, height: 1152, group: "hd-landscape" as const }, // 2048/1152 = 16/9 ✓ — max 16:9
  { label: "3:2",   width: 2016, height: 1344, group: "hd-landscape" as const }, // 2016/1344 = 3/2  ✓
  { label: "4:3",   width: 2048, height: 1536, group: "hd-landscape" as const }, // 2048/1536 = 4/3  ✓ — max 4:3
  { label: "5:4",   width: 1920, height: 1536, group: "hd-landscape" as const }, // 1920/1536 = 5/4  ✓
  { label: "1:1",   width: 2048, height: 2048, group: "hd-square"    as const }, // max square
  { label: "4:5",   width: 1536, height: 1920, group: "hd-portrait"  as const }, // 1536/1920 = 4/5  ✓
  { label: "3:4",   width: 1536, height: 2048, group: "hd-portrait"  as const }, // 1536/2048 = 3/4  ✓ — max 3:4
  { label: "2:3",   width: 1344, height: 2016, group: "hd-portrait"  as const }, // 1344/2016 = 2/3  ✓
  { label: "9:16",  width: 1152, height: 2048, group: "hd-portrait"  as const }, // 1152/2048 = 9/16 ✓ — max 9:16
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
 *
 * Rules (from caption.py + CaptionVerifier):
 *  - Omit high_level_description when empty (model handles absent fine)
 *  - Omit style_description when none of aesthetics/lighting/medium is set
 *  - Key ordering in style MUST match training data: aesthetics → lighting →
 *    photo → medium (photo mode) or medium → art_style (illustration mode)
 *  - Always include the mode-discriminator key (photo / art_style) so that
 *    "Load into Editor" can reliably round-trip photo vs illustration mode
 *  - Fill defaults for empty required fields, matching backend caption.py
 */
export function buildCaption(state: PromptState): string {
  const caption: Record<string, unknown> = {}

  const hld = state.high_level_description.trim()
  if (hld) caption.high_level_description = hld

  const sd = state.style_description
  const modeField = sd.mode === "photo" ? sd.photo.trim() : sd.art_style.trim()
  const hasStyleBase = !!(sd.aesthetics.trim() || sd.lighting.trim() || sd.medium.trim() || modeField)
  if (hasStyleBase) {
    const style: Record<string, unknown> = {
      aesthetics: sd.aesthetics.trim() || "natural",
      lighting:   sd.lighting.trim()   || "natural lighting",
    }
    if (sd.mode === "photo") {
      // photo BEFORE medium — exact backend key order
      style.photo  = sd.photo.trim()  || "standard lens"
      style.medium = sd.medium.trim() || "photograph"
    } else {
      // medium BEFORE art_style
      style.medium    = sd.medium.trim()    || "illustration"
      style.art_style = sd.art_style.trim() || "digital art"
    }
    if (sd.color_palette.length > 0) style.color_palette = sd.color_palette
    caption.style_description = style
  }

  const elements = state.elements.map((el) => {
    const e: Record<string, unknown> = { type: el.type }
    if (el.bbox) e.bbox = [el.bbox.ymin, el.bbox.xmin, el.bbox.ymax, el.bbox.xmax]
    if (el.type === "text") e.text = el.text || ""
    e.desc = el.desc.trim() || "An element in the scene."
    if (el.color_palette.length > 0) e.color_palette = el.color_palette
    return e
  })

  caption.compositional_deconstruction = {
    background: state.background.trim() || "A neutral background.",
    elements,
  }

  return JSON.stringify(caption)
}

/**
 * Estimate token count for the current prompt state.
 * Uses chars/4 heuristic from kjnodes. Hard cap is 2048 (Qwen tokenizer).
 */
export function estimateTokens(state: PromptState): number {
  return Math.ceil(buildCaption(state).length / 4)
}
