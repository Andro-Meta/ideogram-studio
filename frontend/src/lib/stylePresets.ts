import type { StyleDescription } from "@/types/caption"

export interface StylePreset {
  id: string
  label: string
  mode: "photo" | "illustration"
  fields: Partial<Omit<StyleDescription, "mode" | "color_palette">>
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    mode: "photo",
    fields: {
      aesthetics: "cinematic, widescreen, dramatic, filmic",
      lighting:   "golden hour, volumetric light, lens flare",
      photo:      "anamorphic lens, shallow depth of field, f/1.8",
      medium:     "film photography",
    },
  },
  {
    id: "product",
    label: "Product",
    mode: "photo",
    fields: {
      aesthetics: "clean, commercial, minimalist, professional",
      lighting:   "studio lighting, softbox, white background",
      photo:      "macro lens, sharp focus, f/8",
      medium:     "product photography",
    },
  },
  {
    id: "editorial",
    label: "Editorial",
    mode: "photo",
    fields: {
      aesthetics: "editorial, luxury, sophisticated, magazine-quality",
      lighting:   "professional studio lighting, dramatic shadows",
      photo:      "portrait lens, 85mm",
      medium:     "fashion photography",
    },
  },
  {
    id: "documentary",
    label: "Documentary",
    mode: "photo",
    fields: {
      aesthetics: "raw, authentic, candid, journalistic",
      lighting:   "natural available light, harsh midday or overcast",
      photo:      "35mm, grain, reportage style",
      medium:     "documentary photography",
    },
  },
  {
    id: "anime",
    label: "Anime",
    mode: "illustration",
    fields: {
      aesthetics: "anime, vibrant, expressive, high detail",
      lighting:   "dynamic cel shading, dramatic highlights",
      medium:     "digital illustration",
      art_style:  "Japanese anime, key visual, studio-quality animation",
    },
  },
  {
    id: "concept-art",
    label: "Concept Art",
    mode: "illustration",
    fields: {
      aesthetics: "concept art, painterly, detailed world-building",
      lighting:   "atmospheric, ambient occlusion, mood lighting",
      medium:     "digital illustration",
      art_style:  "concept art, professional illustration, ArtStation quality",
    },
  },
  {
    id: "watercolor",
    label: "Watercolor",
    mode: "illustration",
    fields: {
      aesthetics: "soft, dreamy, organic, translucent washes",
      lighting:   "soft diffused light, watercolor glow",
      medium:     "watercolor painting",
      art_style:  "traditional watercolor, loose expressive brushwork",
    },
  },
  {
    id: "flat-design",
    label: "Flat Design",
    mode: "illustration",
    fields: {
      aesthetics: "flat, geometric, bold, graphic design",
      lighting:   "no shadows, flat colors",
      medium:     "vector illustration",
      art_style:  "flat design, modern graphic illustration",
    },
  },
]
