/**
 * Curated LoRA gallery for Ideogram 4.
 *
 * A vetted, one-click list of community LoRA adapters published on Hugging Face.
 * Each entry can ship `recommended` settings (weight, sampler, CFG, trigger
 * words) that the LoRA panel auto-applies on add.
 *
 * FORMAT NOTE: only standard LoRA (lora_A/lora_B) adapters work on the diffusers
 * Ideogram-4 model — they're remapped from the native fused-QKV layout on load.
 * LoKr / LoHa adapters are trained on the fused layout and can't be split into
 * the diffusers' separate q/k/v, so they're flagged `format: "lokr"` and shown
 * disabled. (Formats audited from each repo's safetensors header, June 2026.)
 *
 * Only NF4·D / BF16 pipelines support LoRA (the panel is hidden otherwise).
 */

export type SamplerPresetId = "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"

export interface LoraRecommended {
  weight?: number              // default adapter strength
  samplerPreset?: SamplerPresetId
  cfgPreset?: string           // a CFG preset id (see cfgPresets.ts)
  triggerWords?: string[]      // words to include in the prompt to activate it
  notes?: string
}

export interface CuratedLora {
  repo: string                 // Hugging Face repo id (passed as hf_repo)
  file?: string                // exact file for multi-file repos ("repo::file")
  title: string
  author: string
  kind: "style" | "realism" | "utility"
  blurb: string
  format?: "lora" | "lokr" | "loha"   // non-"lora" → shown disabled
  recommended?: LoraRecommended
}

export const CURATED_LORAS: CuratedLora[] = [
  {
    repo: "tsolful/zjourney-Ideogram-4-Fantasy-Realism-Refiner",
    title: "Fantasy Realism Refiner",
    author: "tsolful",
    kind: "realism",
    blurb: "Refines fantasy/illustrative scenes toward grounded, detailed realism.",
    format: "lora",
    recommended: { weight: 0.9, triggerWords: ["zjourney"], notes: "Include “zjourney” in the prompt." },
  },
  {
    repo: "jmanhype/Ektachrome-LoRA-v1-Ideogram-v4",
    title: "Ektachrome Film",
    author: "jmanhype",
    kind: "style",
    blurb: "Vintage Ektachrome slide-film color and grain — industrial/editorial look.",
    format: "lora",
    recommended: { weight: 0.8, triggerWords: ["ektachrome"], notes: "Film color + grain; pairs well with photographic prompts." },
  },
  {
    repo: "multimodalart/tarot-ideogram-4",
    title: "Tarot Card",
    author: "multimodalart",
    kind: "style",
    blurb: "Ornate tarot-card framing and symbolism for portrait/illustration scenes.",
    format: "lora",
    recommended: { weight: 0.9, triggerWords: ["tarot card"] },
  },
  {
    repo: "DeverStyle/Ideogram-4.0-Loras",
    file: "dever_pastry_font_ideogram4 (dvr_pstr).safetensors",
    title: "DeverStyle · Pastry Font",
    author: "DeverStyle",
    kind: "style",
    blurb: "Soft pastry/lettering style from the DeverStyle pack.",
    format: "lora",
    recommended: { weight: 0.9, triggerWords: ["dvr_pstr"] },
  },
  {
    repo: "ostris/ideogram_4_unconditional_lora",
    title: "Unconditional (CFG-1)",
    author: "ostris",
    kind: "utility",
    blurb: "Stabilizes very low / CFG-1 runs (relates to the uncond-collapse work). Advanced.",
    format: "lora",
    recommended: { weight: 1.0, cfgPreset: "soft", notes: "Advanced — for very low-CFG / unconditional sampling." },
  },
  {
    repo: "RazzzHF/Realism_Engine_Ideogram_4",
    title: "Realism Engine",
    author: "RazzzHF",
    kind: "realism",
    blurb: "Photographic realism — but published in LoKr format, which can't run on the nf4 diffusers model.",
    format: "lokr",
  },
]
