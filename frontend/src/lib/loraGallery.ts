/**
 * Curated LoRA gallery for Ideogram 4.
 *
 * A vetted, one-click list of community LoRA adapters published on Hugging Face
 * for Ideogram 4. The LoRA panel turns each entry into an "Add" button that
 * applies it by HF repo id through the existing /api/loras/apply plumbing
 * (which already accepts `hf_repo`). Nothing here downloads automatically —
 * the user picks one.
 *
 * Only NF4·D / BF16 pipelines support LoRA (the panel is hidden otherwise).
 * Repo ids verified on the Hugging Face hub (June 2026); see docs/RESEARCH_2026-06-16.md.
 */

export interface CuratedLora {
  repo: string          // Hugging Face repo id (passed as hf_repo)
  title: string
  author: string
  kind: "style" | "realism" | "utility"
  blurb: string
}

export const CURATED_LORAS: CuratedLora[] = [
  {
    repo: "RazzzHF/Realism_Engine_Ideogram_4",
    title: "Realism Engine",
    author: "RazzzHF",
    kind: "realism",
    blurb: "Pushes photographic realism — skin, texture, lighting. Community favorite.",
  },
  {
    repo: "tsolful/zjourney-Ideogram-4-Fantasy-Realism-Refiner",
    title: "Fantasy Realism Refiner",
    author: "tsolful",
    kind: "realism",
    blurb: "Refines fantasy/illustrative scenes toward grounded, detailed realism.",
  },
  {
    repo: "jmanhype/Ektachrome-LoRA-v1-Ideogram-v4",
    title: "Ektachrome Film",
    author: "jmanhype",
    kind: "style",
    blurb: "Vintage Ektachrome slide-film color and grain — industrial/editorial look.",
  },
  {
    repo: "multimodalart/tarot-ideogram-4",
    title: "Tarot Card",
    author: "multimodalart",
    kind: "style",
    blurb: "Ornate tarot-card framing and symbolism for portrait/illustration scenes.",
  },
  {
    repo: "DeverStyle/Ideogram-4.0-Loras",
    title: "DeverStyle Pack",
    author: "DeverStyle",
    kind: "style",
    blurb: "A multi-style adapter pack covering several distinct aesthetics.",
  },
  {
    repo: "ostris/ideogram_4_unconditional_lora",
    title: "Unconditional (CFG-1)",
    author: "ostris",
    kind: "utility",
    blurb: "Stabilizes very low / CFG-1 runs (relates to the uncond-collapse work). Advanced.",
  },
]
