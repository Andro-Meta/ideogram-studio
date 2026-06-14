import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ModelVariant, SamplerPreset } from "@/types/caption"

export const MIN_BATCH = 1
export const MAX_BATCH = 12

const clampBatch = (n: number) =>
  Math.max(MIN_BATCH, Math.min(MAX_BATCH, Math.round(n) || MIN_BATCH))

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
  /** Custom CFG curve. On by default with community-recommended values: the
   *  official CFG (7) is too high and burns/splotches photos. When off, the
   *  sampler preset's built-in schedule is used unchanged. */
  customCfg: boolean
  /** Main guidance scale for the first part of the run. */
  cfg: number
  /** Lower guidance for the tail (reduces burn / lingering noise). */
  cfgOverride: number
  /** Fraction (0–1) of the run at `cfg` before dropping to `cfgOverride`.
   *  0.7 = first 70% at `cfg`, last 30% at `cfgOverride`. */
  cfgOverrideStart: number

  setModelVariant: (v: ModelVariant) => void
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
      // Ship the community-recommended defaults ON: CFG 3.5 dropping to 2.0 for
      // the last 30% of steps. Users can turn this off to use the raw preset
      // (CFG 7) or tune the values.
      customCfg: true,
      cfg: 3.5,
      cfgOverride: 2.0,
      cfgOverrideStart: 0.7,

      setModelVariant: (v) => set({ modelVariant: v }),
      setCustomCfg: (v) => set({ customCfg: v }),
      setCfg: (v) => set({ cfg: Math.max(1, Math.min(15, v)) }),
      setCfgOverride: (v) => set({ cfgOverride: Math.max(1, Math.min(15, v)) }),
      setCfgOverrideStart: (v) => set({ cfgOverrideStart: Math.max(0, Math.min(1, v)) }),
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
      version: 3,
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
        return state as SettingsStore
      },
    }
  )
)
