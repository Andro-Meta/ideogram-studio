import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MagicPromptRequest, MagicPromptResponse } from "@/types/api"
import { usePromptStore } from "@/stores/promptStore"
import { uid } from "@/lib/uid"

async function callMagicPrompt(req: MagicPromptRequest): Promise<MagicPromptResponse> {
  const res = await fetch("/api/magic-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }))
    throw new Error(err.detail ?? "Magic Prompt failed")
  }
  return res.json()
}

export function useMagicPrompt() {
  const loadFromParsed = usePromptStore((s) => s.loadFromParsed)

  return useMutation({
    mutationFn: callMagicPrompt,
    onSuccess: (data) => {
      if (data.warnings.length) {
        toast.warning(`Caption warnings: ${data.warnings.join("; ")}`)
      }
      // Parse the JSON and load into prompt store
      try {
        const parsed = JSON.parse(data.caption_json)
        // Convert to our PromptState shape
        const style = parsed.style_description ?? {}
        const comp  = parsed.compositional_deconstruction ?? {}
        const mode  = "photo" in style ? "photo" : "illustration"

        // The hosted ideogram-4-v1 backend never returns style_description —
        // keep whatever style the user already set instead of wiping it.
        const hasStyle = Object.keys(style).length > 0
        const currentStyle = usePromptStore.getState().style_description

        loadFromParsed({
          high_level_description: parsed.high_level_description ?? "",
          style_description: hasStyle ? {
            mode,
            aesthetics:    style.aesthetics   ?? "",
            lighting:      style.lighting     ?? "",
            medium:        style.medium       ?? "",
            photo:         style.photo        ?? "",
            art_style:     style.art_style    ?? "",
            color_palette: style.color_palette ?? [],
          } : currentStyle,
          background: comp.background ?? "",
          elements: (comp.elements ?? []).map((el: Record<string, unknown>, i: number) => {
            const bbox = Array.isArray(el.bbox) && el.bbox.length === 4
              ? { ymin: el.bbox[0] as number, xmin: el.bbox[1] as number, ymax: el.bbox[2] as number, xmax: el.bbox[3] as number }
              : undefined
            return {
              id:            uid(),
              type:          el.type as "obj" | "text",
              bbox,
              text:          (el.text as string) ?? "",
              desc:          (el.desc as string) ?? "",
              color_palette: (el.color_palette as string[]) ?? [],
            }
          }),
        })
        toast.success("Prompt expanded — review and generate!")
      } catch {
        toast.error("Could not parse magic prompt response")
      }
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
