/**
 * Caption JSON utilities for the frontend.
 * Mirrors the backend caption.py logic for display purposes.
 */
import type { PromptState, StyleDescription } from "@/types/caption"

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

// ── Caption schema limits (docs/prompting.md) ────────────────────────────────
// These are INDEPENDENT limits, applied per-palette — never summed together.
export const GLOBAL_PALETTE_MAX = 16   // style_description.color_palette
export const ELEMENT_PALETTE_MAX = 5   // each element's color_palette
// Hosted-API-only limit (NOT a model/weights constraint) — advisory.
export const HOSTED_API_TEXT_LAYER_MAX = 6

// ── Resolution limits (docs/inference.md) ────────────────────────────────────
export const RES_MIN = 256
export const RES_MAX = 2048
export const RES_STEP = 16
// Ideogram 4 supports aspect ratios up to 6:1 (or 1:6). Beyond that the model is
// out of its trained distribution, so we clamp custom/derived sizes to ≤ 6:1.
export const MAX_ASPECT_RATIO = 6

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

  // The #1 cause of Ideogram 4 "blocked"/garbled outputs is a too-sparse prompt:
  // the model collapses out-of-distribution on short input (it's not real
  // moderation). Warn before that happens — adding detail is the community's
  // top fix. Count meaningful words across every field.
  const sd = state.style_description
  const totalWords =
    wordCount(state.high_level_description) +
    wordCount(state.background) +
    wordCount(sd.aesthetics ?? "") + wordCount(sd.lighting ?? "") +
    wordCount(sd.medium ?? "") + wordCount(sd.photo ?? "") + wordCount(sd.art_style ?? "") +
    state.elements.reduce(
      (n, el) => n + wordCount(el.desc) + wordCount("text" in el ? (el.text ?? "") : ""),
      0,
    )
  if (totalWords < 12) {
    warnings.push(
      "Prompt looks sparse — Ideogram 4 often refuses or garbles very short prompts. " +
        "Add detail to the description, background, or an element (the top community fix for “blocked” images).",
    )
  }

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

  // Official Ideogram guide: overlapping bounding boxes degrade rendering, and
  // it's worst for TEXT (each text element needs its own non-overlapping zone).
  const boxed = state.elements
    .map((el, i) => ({ i, el }))
    .filter((x) => !!x.el.bbox)
  let anyOverlap = false
  let textOverlap = false
  for (let a = 0; a < boxed.length; a++) {
    for (let b = a + 1; b < boxed.length; b++) {
      const A = boxed[a].el.bbox!
      const B = boxed[b].el.bbox!
      const overlap =
        A.xmin < B.xmax && B.xmin < A.xmax && A.ymin < B.ymax && B.ymin < A.ymax
      if (overlap) {
        anyOverlap = true
        if (boxed[a].el.type === "text" || boxed[b].el.type === "text") textOverlap = true
      }
    }
  }
  if (textOverlap) {
    warnings.push("A text box overlaps another box — Ideogram renders text worst when zones overlap. Give each text element its own non-overlapping box.")
  } else if (anyOverlap) {
    warnings.push("Some element boxes overlap — Ideogram composes more reliably with non-overlapping boxes.")
  }

  // Official guide: break multi-line text into separate text elements (the model
  // renders individual lines more accurately than one box with line breaks).
  for (const [i, el] of state.elements.entries()) {
    if (el.type === "text" && (el.text ?? "").includes("\n")) {
      warnings.push(`Text element ${i + 1} spans multiple lines — the model renders each line more accurately as its own text element.`)
    }
  }

  // Empty-canvas collapse: the community found Ideogram 4 treats large UNBOXED
  // regions as "transparent/canvas" and is far more likely to collapse (the gray
  // "blocked" card) or paint a fake-alpha background. The fix is to fill empty
  // space with a near-full-canvas background element. Warn when boxes leave most
  // of the canvas uncovered (only meaningful once at least one box exists; pure
  // text-to-image with no boxes relies on the background text and is fine).
  if (boxed.length > 0 && boxCoverageFraction(state) < 0.5) {
    warnings.push(
      "Most of the canvas has no box — Ideogram tends to collapse or paint a fake transparent background in empty areas. " +
        "Add a near-full-canvas background element (the community's “fill the empty space” fix).",
    )
  }

  // Ideogram 4 caption schema palette limits are INDEPENDENT, not combined:
  //   • style_description.color_palette         → up to 16 colors (overall image)
  //   • each element's color_palette            → up to 5 colors (that element)
  // (docs/prompting.md "Color palette conditioning"). Count DISTINCT valid
  // colors per palette so repeating the same swatch never trips the warning.
  const distinct = (palette: string[] | undefined) =>
    new Set((palette ?? []).filter(isValidHex).map((c) => c.toUpperCase())).size

  const globalColors = distinct(state.style_description.color_palette)
  if (globalColors > GLOBAL_PALETTE_MAX) {
    warnings.push(
      `Style palette has ${globalColors} distinct colors — Ideogram supports at most ${GLOBAL_PALETTE_MAX} in the overall image palette. Trim the global palette.`,
    )
  }
  for (const [i, el] of state.elements.entries()) {
    const elColors = distinct(el.color_palette)
    if (elColors > ELEMENT_PALETTE_MAX) {
      warnings.push(
        `Element ${i + 1} has ${elColors} distinct colors — Ideogram supports at most ${ELEMENT_PALETTE_MAX} per element. Trim this element's palette.`,
      )
    }
  }

  // NOTE: the ≤6 text-layer ceiling is a limit of the hosted Ideogram.ai API,
  // NOT of the open-weights model or its caption schema (CaptionVerifier imposes
  // no such cap). It's surfaced as a soft advisory so people targeting the
  // hosted product aren't surprised; local-weights users can safely ignore it.
  const textCount = state.elements.filter((el) => el.type === "text").length
  if (textCount > HOSTED_API_TEXT_LAYER_MAX) {
    warnings.push(
      `${textCount} text elements — the hosted Ideogram.ai API allows at most ${HOSTED_API_TEXT_LAYER_MAX} text layers (the open-weights model has no such limit). Merge or remove some if you target the hosted API.`,
    )
  }

  return warnings
}

/** Fraction (0–1) of the 0–1000 canvas covered by the union of element boxes.
 *  Uses a coarse grid sample — exact enough to drive the empty-canvas warning
 *  without a full polygon-union computation. */
export function boxCoverageFraction(state: PromptState, grid = 40): number {
  const boxes = state.elements.map((el) => el.bbox).filter((b): b is NonNullable<typeof b> => !!b)
  if (boxes.length === 0) return 0
  const cell = 1000 / grid
  let covered = 0
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const cx = (gx + 0.5) * cell
      const cy = (gy + 0.5) * cell
      if (boxes.some((b) => cx >= b.xmin && cx <= b.xmax && cy >= b.ymin && cy <= b.ymax)) {
        covered++
      }
    }
  }
  return covered / (grid * grid)
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
  return Math.max(RES_MIN, Math.min(RES_MAX, Math.round(value / RES_STEP) * RES_STEP))
}

/**
 * Clamp a (width, height) pair to Ideogram 4's ≤ 6:1 / ≥ 1:6 aspect range,
 * keeping both sides valid (multiple of 16, within 256–2048).
 *
 * `anchor` decides which side is authoritative when the ratio is too extreme:
 *  - "w": the just-edited width is kept; height is pulled toward it.
 *  - "h": the just-edited height is kept; width is pulled toward it.
 * The anchored side is itself snapped/clamped first, then the other side is
 * brought into the [anchor/6, anchor*6] window (snapped, re-clamped). Because
 * RES_MIN*6 = 1536 ≤ RES_MAX, a valid in-range window always exists, so the
 * result is guaranteed to satisfy the ratio bound.
 *
 * Returns the clamped pair plus `changed` = true when either side was adjusted
 * for the aspect bound (so the UI can show a notice).
 */
export function clampAspect(
  width: number,
  height: number,
  anchor: "w" | "h" = "w",
): { width: number; height: number; changed: boolean } {
  let w = snapTo16(width)
  let h = snapTo16(height)

  const ratio = Math.max(w / h, h / w)
  if (ratio <= MAX_ASPECT_RATIO) return { width: w, height: h, changed: false }

  // Snap the dependent side INTO the legal window. The lower bound rounds UP
  // and the upper bound rounds DOWN to the nearest 16, so 16-px snapping can
  // never push the ratio back over the limit (plain rounding could, e.g.
  // 2048×256 → 2048×336 = 6.1:1). Since RES_MIN × 6 = 1536 ≤ RES_MAX, the
  // window is always non-empty for any in-range anchor.
  const up16 = (v: number) =>
    Math.min(RES_MAX, Math.max(RES_MIN, Math.ceil(v / RES_STEP) * RES_STEP))
  const down16 = (v: number) =>
    Math.min(RES_MAX, Math.max(RES_MIN, Math.floor(v / RES_STEP) * RES_STEP))
  const into = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  if (anchor === "w") {
    h = into(h, up16(w / MAX_ASPECT_RATIO), down16(w * MAX_ASPECT_RATIO))
  } else {
    w = into(w, up16(h / MAX_ASPECT_RATIO), down16(h * MAX_ASPECT_RATIO))
  }
  return { width: w, height: h, changed: true }
}

/**
 * Given a source image's pixel dimensions, return a generation resolution that
 * matches its *aspect ratio* (not its resolution) at a sane pixel budget, each
 * side snapped to 16 and clamped to 256–2048. A ~1 MP budget keeps generation
 * fast (a phone photo's full size would otherwise balloon to 2048² and run 4×
 * slower) while reproducing any image's shape — including non-preset ratios.
 */
export function aspectMatchedResolution(
  srcW: number,
  srcH: number,
  budget = 1024 * 1024,
): { width: number; height: number } {
  if (!srcW || !srcH) return { width: 1024, height: 1024 }
  const scale = Math.sqrt(budget / (srcW * srcH))
  // Anchor on the longer side so an extreme source (e.g. 8:1) keeps its long
  // dimension and the short side is pulled up to satisfy the ≤ 6:1 bound.
  const anchor = srcW >= srcH ? "w" : "h"
  const { width, height } = clampAspect(srcW * scale, srcH * scale, anchor)
  return { width, height }
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
