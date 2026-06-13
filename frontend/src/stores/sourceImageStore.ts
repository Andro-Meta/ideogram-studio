import { create } from "zustand"

/**
 * Holds the image uploaded via "Generate from image" so it can optionally be
 * blended into the result. Ideogram 4's weights are text-to-image only, so the
 * "mix" is done through the local Remix path (RePaint img2img on a full-image
 * mask): blend 0 = ignore the original (pure text-to-image from the derived
 * prompt), blend 100 = keep the original almost intact.
 */
interface SourceImageStore {
  imageB64: string | null // the uploaded image (no data: prefix)
  blendPct: number // 0–100: how much of the original to keep
  setImage: (b64: string | null) => void
  setBlend: (pct: number) => void
  clear: () => void
}

/** Default blend for a freshly-added image: keep 20% of the original. */
export const DEFAULT_BLEND_PCT = 20

export const useSourceImageStore = create<SourceImageStore>((set) => ({
  imageB64: null,
  blendPct: DEFAULT_BLEND_PCT,
  setImage: (imageB64) => set({ imageB64 }),
  setBlend: (blendPct) => set({ blendPct: Math.max(0, Math.min(100, Math.round(blendPct))) }),
  clear: () => set({ imageB64: null, blendPct: DEFAULT_BLEND_PCT }),
}))
