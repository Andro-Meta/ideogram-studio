import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ModelVariant, SamplerPreset } from "@/types/caption"

interface SettingsStore {
  // Generation defaults (persisted in localStorage)
  modelVariant: ModelVariant
  samplerPreset: SamplerPreset
  width: number
  height: number
  fixedSeed: boolean
  seed: number
  variationCount: 2 | 4 | 8

  setModelVariant: (v: ModelVariant) => void
  setSamplerPreset: (v: SamplerPreset) => void
  setResolution: (w: number, h: number) => void
  setFixedSeed: (v: boolean) => void
  setSeed: (v: number) => void
  randomizeSeed: () => void
  setVariationCount: (v: 2 | 4 | 8) => void
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
      variationCount: 4,

      setModelVariant: (v) => set({ modelVariant: v }),
      setSamplerPreset: (v) => set({ samplerPreset: v }),
      setResolution: (w, h) => set({ width: w, height: h }),
      setFixedSeed: (v) => set({ fixedSeed: v }),
      setSeed: (v) => set({ seed: v }),
      randomizeSeed: () =>
        set({ seed: Math.floor(Math.random() * 2 ** 32) }),
      setVariationCount: (v) => set({ variationCount: v }),
    }),
    {
      name: "ideogram-studio-settings",
      version: 1,
      // v0 shipped with fp8 as the default — migrate stored settings to nf4
      // so existing installs don't keep trying to load the datacenter variant.
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsStore>
        if (version < 1 && state.modelVariant === "fp8") {
          state.modelVariant = "nf4"
        }
        return state as SettingsStore
      },
    }
  )
)
