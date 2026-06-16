/**
 * Scene presets — export/import a whole scene (prompt + layout + generation
 * settings) as a portable, shareable JSON file. Ported in spirit from
 * jonasnordlund/intuition's "save/load settings", but captures the full app
 * state, not just the caption.
 *
 * File format (`.ideoscene.json`):
 *   {
 *     "format": "ideogram-studio-scene",
 *     "version": 1,
 *     "savedAt": "<ISO>",
 *     "prompt": PromptState,
 *     "generation": { width, height, samplerPreset, megapixels, ratioLabel,
 *                     customCfg, cfg, cfgOverride, cfgOverrideStart,
 *                     fixedSeed, seed },
 *     "constraints": { artifactSuppression, artifactCategoryIds, artifactCustom }
 *   }
 *
 * Pure module (no React) so it can be unit-tested and reused.
 */
import type { PromptState, SamplerPreset, AnyElement } from "@/types/caption"
import { defaultPromptState } from "@/types/caption"
import type { BBox } from "@/lib/bbox"
import { uid } from "@/lib/uid"

export const SCENE_FORMAT = "ideogram-studio-scene"
export const SCENE_VERSION = 1

export interface SceneGeneration {
  width: number
  height: number
  samplerPreset: SamplerPreset
  megapixels: number
  ratioLabel: string
  customCfg: boolean
  cfg: number
  cfgOverride: number
  cfgOverrideStart: number
  fixedSeed: boolean
  seed: number
}

/**
 * Coerce one untrusted element from an uploaded scene into a valid AnyElement.
 * Hand-edited / corrupt files can carry missing or wrong-typed fields; without
 * this, an element with no `desc` crashes buildCaption (`el.desc.trim()`).
 * Returns null for anything that isn't an object so the caller can drop it.
 */
function sanitizeElement(raw: unknown): AnyElement | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const desc = typeof e.desc === "string" ? e.desc : ""
  const color_palette = Array.isArray(e.color_palette)
    ? e.color_palette.filter((c): c is string => typeof c === "string")
    : []
  const id = typeof e.id === "string" && e.id ? e.id : uid()

  // Keep bbox only when it's a well-formed numeric {ymin,xmin,ymax,xmax}.
  let bbox: BBox | undefined
  const b = e.bbox as Record<string, unknown> | null | undefined
  if (b && typeof b === "object" &&
      ["ymin", "xmin", "ymax", "xmax"].every((k) => typeof b[k] === "number")) {
    bbox = { ymin: b.ymin as number, xmin: b.xmin as number, ymax: b.ymax as number, xmax: b.xmax as number }
  }

  if (e.type === "text") {
    return { id, type: "text", text: typeof e.text === "string" ? e.text : "", desc, bbox, color_palette }
  }
  return { id, type: "obj", desc, bbox, color_palette }
}

export interface SceneConstraints {
  artifactSuppression: boolean
  artifactCategoryIds: string[]
  artifactCustom: string
}

export interface ScenePreset {
  format: typeof SCENE_FORMAT
  version: number
  savedAt: string
  prompt: PromptState
  generation: SceneGeneration
  constraints: SceneConstraints
}

export function buildScene(
  prompt: PromptState,
  generation: SceneGeneration,
  constraints: SceneConstraints,
): ScenePreset {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    savedAt: new Date().toISOString(),
    prompt,
    generation,
    constraints,
  }
}

export function serializeScene(scene: ScenePreset): string {
  return JSON.stringify(scene, null, 2)
}

/** Parse + validate an uploaded scene file. Throws a friendly Error on bad input. */
export function parseScene(text: string): ScenePreset {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("Not a valid JSON file.")
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("Scene file is empty or malformed.")
  }
  const obj = data as Record<string, unknown>
  if (obj.format !== SCENE_FORMAT) {
    throw new Error("This isn't an Ideogram Studio scene file.")
  }
  const prompt = obj.prompt as Partial<PromptState> | undefined
  if (!prompt || typeof prompt !== "object") {
    throw new Error("Scene file has no prompt data.")
  }
  // Merge over defaults so missing/older fields are tolerated.
  const base = defaultPromptState()
  const mergedPrompt: PromptState = {
    high_level_description: prompt.high_level_description ?? base.high_level_description,
    style_description: { ...base.style_description, ...(prompt.style_description ?? {}) },
    background: prompt.background ?? base.background,
    // Sanitize each element so a malformed/hand-edited file can't crash buildCaption.
    elements: Array.isArray(prompt.elements)
      ? prompt.elements.map(sanitizeElement).filter((el): el is AnyElement => el !== null)
      : base.elements,
  }
  return {
    format: SCENE_FORMAT,
    version: typeof obj.version === "number" ? obj.version : SCENE_VERSION,
    savedAt: typeof obj.savedAt === "string" ? obj.savedAt : new Date().toISOString(),
    prompt: mergedPrompt,
    generation: (obj.generation ?? {}) as SceneGeneration,
    constraints: (obj.constraints ?? {}) as SceneConstraints,
  }
}

/** Trigger a browser download of the scene as a `.ideoscene.json` file. */
export function downloadScene(scene: ScenePreset, name = "scene"): void {
  const safe = (name || "scene").trim().replace(/[^\w.-]+/g, "_").slice(0, 60) || "scene"
  const blob = new Blob([serializeScene(scene)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${safe}.ideoscene.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
