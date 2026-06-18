import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ModelVariant, SamplerPreset } from "@/types/caption"
import { DEFAULT_CONSTRAINT_IDS, buildConstraintClause } from "@/lib/constraintPresets"
import { CFG_PRESETS, DEFAULT_CFG_PRESET } from "@/lib/cfgPresets"

export const MIN_BATCH = 1
export const MAX_BATCH = 12

// Shared CFG (guidance) bounds — the single source of truth for the sliders, the
// store clamps, and (kept in sync) the backend's _clamp_cfg in schemas.py.
export const CFG_MIN = 1
export const CFG_MAX = 10

const clampBatch = (n: number) =>
  Math.max(MIN_BATCH, Math.min(MAX_BATCH, Math.round(n) || MIN_BATCH))

const clampCfg = (v: number) => Math.max(CFG_MIN, Math.min(CFG_MAX, v))

interface SettingsStore {
  // Generation defaults (persisted in localStorage)
  modelVariant: ModelVariant
  samplerPreset: SamplerPreset
  width: number
  height: number
  fixedSeed: boolean
  seed: number
  /** How many images one Batch run produces (each with a different seed). */
  batchCount: number
  /** Layout canvas is opt-in — most generations never pin elements. */
  canvasOpen: boolean
  /** Named CFG preset currently selected (id from cfgPresets), e.g.
   *  "recommended" | "soft" | "sharp" | "preset" | "custom". Drives customCfg +
   *  the cfg/override/start values; "custom" keeps the slider values. */
  cfgPreset: string
  /** Custom CFG curve. On by default with the official dual-CFG values (7 → 3).
   *  When off, the sampler preset's built-in schedule is used unchanged. */
  customCfg: boolean
  /** Main guidance scale for the first part of the run. */
  cfg: number
  /** Lower guidance for the tail (reduces burn / lingering noise). */
  cfgOverride: number
  /** Fraction (0–1) of the run at `cfg` before dropping to `cfgOverride`.
   *  0.7 = first 70% at `cfg`, last 30% at `cfgOverride`. */
  cfgOverrideStart: number

  /** Editor quality/sampler controls (recommended defaults; customizable). */
  editSampler: "res_multistep" | "euler"
  editDetail: boolean
  editQuality: SamplerPreset
  setEditSampler: (v: "res_multistep" | "euler") => void
  setEditDetail: (v: boolean) => void
  setEditQuality: (v: SamplerPreset) => void

  /** Target image size in megapixels — drives the ratio→W/H computation in the
   *  resolution picker (Ideogram native ratios, snapped to ×16). */
  megapixels: number
  /** Currently selected native aspect-ratio label (e.g. "16:9"), or "" for a
   *  custom W/H pair. */
  ratioLabel: string

  /** Artifact suppression (pseudo–negative-prompt). When on, a positive
   *  constraint clause is appended to the caption at build time. */
  artifactSuppression: boolean
  /** Which constraint categories are active (ids from constraintPresets). */
  artifactCategoryIds: string[]
  /** Optional free-text addition to the constraint clause. */
  artifactCustom: string

  setMegapixels: (v: number) => void
  setRatioLabel: (v: string) => void
  setArtifactSuppression: (v: boolean) => void
  toggleArtifactCategory: (id: string) => void
  setArtifactCustom: (v: string) => void
  setModelVariant: (v: ModelVariant) => void
  /** Select a CFG preset by id — applies its customCfg + values (or, for
   *  "custom", just switches the mode and keeps the current slider values). */
  setCfgPreset: (id: string) => void
  setCustomCfg: (v: boolean) => void
  setCfg: (v: number) => void
  setCfgOverride: (v: number) => void
  setCfgOverrideStart: (v: number) => void
  setCanvasOpen: (v: boolean) => void
  setSamplerPreset: (v: SamplerPreset) => void
  setResolution: (w: number, h: number) => void
  setFixedSeed: (v: boolean) => void
  setSeed: (v: number) => void
  randomizeSeed: () => void
  setBatchCount: (v: number) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // nf4d is recommended for single 24 GB consumer GPUs (same fit as nf4 but
      // adds live progress, LoRA, and inpaint). fp8 targets A100/H100 hardware.
      modelVariant: "nf4d",
      samplerPreset: "V4_DEFAULT_20",
      width: 1024,
      height: 1024,
      fixedSeed: false,
      seed: 42,
      batchCount: 4,
      canvasOpen: false,
      // Default to the official "Recommended" dual-CFG: 7 → 3 at 70% (smooths
      // the result). Pick "Soft" (3.5 → 2), "Sampler default", or "Custom" in
      // the CFG control.
      cfgPreset: DEFAULT_CFG_PRESET,
      customCfg: true,
      cfg: 7,
      cfgOverride: 3,
      cfgOverrideStart: 0.7,

      editSampler: "res_multistep",
      editDetail: true,
      editQuality: "V4_DEFAULT_20",

      // Resolution: default 1:1 at ~1 MP (1024²). The picker recomputes W/H from
      // the selected native ratio + this MP budget, snapped to ×16.
      megapixels: 1.0,
      ratioLabel: "1:1",

      // Artifact suppression is OFF by default — it's an opt-in quality lever, not
      // something to silently inject into every caption.
      artifactSuppression: false,
      artifactCategoryIds: [...DEFAULT_CONSTRAINT_IDS],
      artifactCustom: "",

      setMegapixels: (v) => set({ megapixels: Math.max(0.25, Math.min(4.0, v)) }),
      setRatioLabel: (v) => set({ ratioLabel: v }),
      setArtifactSuppression: (v) => set({ artifactSuppression: v }),
      toggleArtifactCategory: (id) =>
        set((s) => ({
          artifactCategoryIds: s.artifactCategoryIds.includes(id)
            ? s.artifactCategoryIds.filter((x) => x !== id)
            : [...s.artifactCategoryIds, id],
        })),
      setArtifactCustom: (v) => set({ artifactCustom: v }),
      setModelVariant: (v) => set({ modelVariant: v }),
      setCfgPreset: (id) => {
        const p = CFG_PRESETS.find((x) => x.id === id)
        if (!p) return
        if (id === "custom") {
          set({ cfgPreset: "custom", customCfg: true })
          return
        }
        set({
          cfgPreset: id,
          customCfg: p.customCfg,
          ...(p.cfg !== undefined
            ? { cfg: clampCfg(p.cfg), cfgOverride: clampCfg(p.cfgOverride ?? p.cfg), cfgOverrideStart: p.cfgOverrideStart ?? 0.7 }
            : {}),
        })
      },
      // Manual slider edits switch the active preset to "custom".
      setCustomCfg: (v) => set({ customCfg: v, cfgPreset: v ? "custom" : "preset" }),
      setCfg: (v) => set({ cfg: clampCfg(v), cfgPreset: "custom", customCfg: true }),
      setCfgOverride: (v) => set({ cfgOverride: clampCfg(v), cfgPreset: "custom", customCfg: true }),
      setCfgOverrideStart: (v) => set({ cfgOverrideStart: Math.max(0, Math.min(1, v)), cfgPreset: "custom", customCfg: true }),
      setEditSampler: (v) => set({ editSampler: v }),
      setEditDetail: (v) => set({ editDetail: v }),
      setEditQuality: (v) => set({ editQuality: v }),
      setCanvasOpen: (v) => set({ canvasOpen: v }),
      setSamplerPreset: (v) => set({ samplerPreset: v }),
      setResolution: (w, h) => set({ width: w, height: h }),
      setFixedSeed: (v) => set({ fixedSeed: v }),
      setSeed: (v) => set({ seed: v }),
      randomizeSeed: () =>
        set({ seed: Math.floor(Math.random() * 2 ** 32) }),
      setBatchCount: (v) => set({ batchCount: clampBatch(v) }),
    }),
    {
      name: "ideogram-studio-settings",
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsStore> & {
          variationCount?: number
          softGuidance?: boolean
        }
        // v0 shipped with fp8 as the default — migrate to nf4.
        if (version < 1 && state.modelVariant === "fp8") {
          state.modelVariant = "nf4"
        }
        // v2 renamed variationCount → batchCount and widened the range.
        if (version < 2) {
          state.batchCount = clampBatch(state.variationCount ?? 4)
          delete state.variationCount
        }
        // v3 replaced the softGuidance boolean with explicit CFG controls.
        if (version < 3) {
          state.customCfg = true
          state.cfg = 3.5
          state.cfgOverride = 2.0
          state.cfgOverrideStart = 0.7
          delete state.softGuidance
        }
        // v4 added the megapixel/native-ratio resolution model + artifact
        // suppression. Seed sensible defaults for anyone upgrading.
        if (version < 4) {
          state.megapixels = state.megapixels ?? 1.0
          state.ratioLabel = state.ratioLabel ?? "1:1"
          state.artifactSuppression = state.artifactSuppression ?? false
          state.artifactCategoryIds = state.artifactCategoryIds ?? [...DEFAULT_CONSTRAINT_IDS]
          state.artifactCustom = state.artifactCustom ?? ""
        }
        // v5 added CFG presets and made the official "Recommended" 7 → 3 the
        // default (the newer community/official recommendation).
        if (version < 5) {
          state.cfgPreset = DEFAULT_CFG_PRESET
          state.customCfg = true
          state.cfg = 7
          state.cfgOverride = 3
          state.cfgOverrideStart = 0.7
        }
        return state as SettingsStore
      },
    }
  )
)

/**
 * The CFG fields to send with a generation/edit request — empty when custom CFG
 * is off, so the backend falls back to the sampler preset's built-in schedule.
 * Shared by text-to-image, remix, inpaint, and extend so every path honours the
 * same control. Reads the live store at call time.
 */
export function cfgRequestFields():
  | { cfg: number; cfg_override: number; cfg_override_start: number }
  | Record<string, never> {
  const s = useSettingsStore.getState()
  return s.customCfg
    ? { cfg: s.cfg, cfg_override: s.cfgOverride, cfg_override_start: s.cfgOverrideStart }
    : {}
}

/** The editor's quality/sampler choices to send with an edit request — the
 *  sampler, the EIS "detail" toggle, and the step preset. Reads the live store. */
export function qualityRequestFields(): {
  sampler: "res_multistep" | "euler"; detail: boolean; sampler_preset: SamplerPreset
} {
  const s = useSettingsStore.getState()
  return { sampler: s.editSampler, detail: s.editDetail, sampler_preset: s.editQuality }
}

/**
 * The current artifact-suppression clause to inject into the caption, or "" when
 * suppression is off / nothing is selected. Reads the live store at call time so
 * callers (Generate page, scene export) stay in sync. Pure string out.
 */
export function currentConstraintClause(): string {
  const s = useSettingsStore.getState()
  if (!s.artifactSuppression) return ""
  return buildConstraintClause(s.artifactCategoryIds, s.artifactCustom)
}
