import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import type { GalleryItem } from "@/types/gallery"

/**
 * Load a past image's saved prompt + settings back into the Generate page so
 * you can tweak or regenerate from it. `lockSeed` reproduces the exact image;
 * otherwise the seed is freed for variations. Shared by the gallery detail
 * view and the lightbox.
 */
export function useReusePrompt() {
  const loadFromParsed = usePromptStore((s) => s.loadFromParsed)
  const navigate = useNavigate()

  return useCallback((item: GalleryItem, lockSeed = false): boolean => {
    if (!item.prompt_json) {
      toast.error("No prompt data saved for this image")
      return false
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(item.prompt_json)
    } catch {
      toast.error("Could not parse the saved prompt")
      return false
    }

    const style = (parsed.style_description ?? {}) as Record<string, unknown>
    const comp = (parsed.compositional_deconstruction ?? {}) as Record<string, unknown>
    const mode = "photo" in style ? "photo" : "illustration"
    loadFromParsed({
      high_level_description: (parsed.high_level_description as string) ?? "",
      style_description: {
        mode,
        aesthetics: (style.aesthetics as string) ?? "",
        lighting: (style.lighting as string) ?? "",
        medium: (style.medium as string) ?? "",
        photo: (style.photo as string) ?? "",
        art_style: (style.art_style as string) ?? "",
        color_palette: (style.color_palette as string[]) ?? [],
      },
      background: (comp.background as string) ?? "",
      elements: ((comp.elements as Record<string, unknown>[]) ?? []).map((el) => {
        const bbox = Array.isArray(el.bbox) && el.bbox.length === 4
          ? { ymin: el.bbox[0] as number, xmin: el.bbox[1] as number, ymax: el.bbox[2] as number, xmax: el.bbox[3] as number }
          : undefined
        return {
          id: crypto.randomUUID(),
          type: el.type as "obj" | "text",
          bbox,
          text: (el.text as string) ?? "",
          desc: (el.desc as string) ?? "",
          color_palette: (el.color_palette as string[]) ?? [],
        }
      }),
    })

    const s = useSettingsStore.getState()
    if (item.width && item.height) s.setResolution(item.width, item.height)
    if (item.sampler_preset) s.setSamplerPreset(item.sampler_preset)
    if (item.model_variant) s.setModelVariant(item.model_variant)
    if (lockSeed && item.seed != null) { s.setSeed(item.seed); s.setFixedSeed(true) }
    else s.setFixedSeed(false)

    toast.success(lockSeed
      ? "Prompt + settings loaded, seed locked — Generate reproduces this image"
      : "Prompt + settings loaded — tweak and Generate for variations")
    navigate("/generate")
    return true
  }, [loadFromParsed, navigate])
}
