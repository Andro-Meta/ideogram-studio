/**
 * CFG (guidance) presets — named curves for the "two CFG" dual-guidance Ideogram
 * 4 uses: a main CFG for the first part of the run, dropping to a lower override
 * CFG for the tail (smooths the result, reduces burn). Shared by image
 * generation and image editing.
 */
export interface CfgPreset {
  id: string
  label: string
  hint: string
  /** false = use the sampler preset's built-in schedule (no custom curve). */
  customCfg: boolean
  cfg?: number
  cfgOverride?: number
  cfgOverrideStart?: number
}

export const CFG_PRESETS: CfgPreset[] = [
  {
    id: "recommended",
    label: "Recommended",
    hint: "7 → 3 at 70% — the official dual-CFG (balanced, smooths the result)",
    customCfg: true, cfg: 7, cfgOverride: 3, cfgOverrideStart: 0.7,
  },
  {
    id: "soft",
    label: "Soft",
    hint: "3.5 → 2 — gentler guidance, fewer burnt / splotchy photos",
    customCfg: true, cfg: 3.5, cfgOverride: 2, cfgOverrideStart: 0.7,
  },
  {
    id: "sharp",
    label: "Sharp",
    hint: "7 → 5 — strongest prompt adherence, least smoothing",
    customCfg: true, cfg: 7, cfgOverride: 5, cfgOverrideStart: 0.7,
  },
  {
    id: "preset",
    label: "Sampler default",
    hint: "the model's built-in schedule, no custom curve",
    customCfg: false,
  },
  {
    id: "custom",
    label: "Custom",
    hint: "tune the values yourself",
    customCfg: true,
  },
]

export const DEFAULT_CFG_PRESET = "recommended"

/** The named preset matching the given CFG values, or "custom" if none match. */
export function matchCfgPreset(s: {
  customCfg: boolean; cfg: number; cfgOverride: number; cfgOverrideStart: number
}): string {
  if (!s.customCfg) return "preset"
  const hit = CFG_PRESETS.find(
    (p) => p.customCfg && p.cfg === s.cfg && p.cfgOverride === s.cfgOverride &&
           p.cfgOverrideStart === s.cfgOverrideStart,
  )
  return hit ? hit.id : "custom"
}
