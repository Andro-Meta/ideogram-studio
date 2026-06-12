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

  setModelVariant: (v: ModelVariant) => void
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
      // nf4 is the official variant for single 24 GB consumer GPUs.
      // fp8 targets A100/H100-class hardware and can crash smaller machines.
      modelVariant: "nf4",
      samplerPreset: "V4_DEFAULT_20",
      width: 1024,
      height: 1024,
      fixedSeed: false,
      seed: 42,
      batchCount: 4,
      canvasOpen: false,

      setModelVariant: (v) => set({ modelVariant: v }),
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
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsStore> & { variationCount?: number }
        // v0 shipped with fp8 as the default — migrate to nf4.
        if (version < 1 && state.modelVariant === "fp8") {
          state.modelVariant = "nf4"
        }
        // v2 renamed variationCount → batchCount and widened the range.
        if (version < 2) {
          state.batchCount = clampBatch(state.variationCount ?? 4)
          delete state.variationCount
        }
        return state as SettingsStore
      },
    }
  )
)
