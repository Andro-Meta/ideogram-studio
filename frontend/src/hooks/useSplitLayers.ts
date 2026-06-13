import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

export interface LayerInfo {
  name: string
  kind: string // "background" | "foreground" | "obj" | "text"
  image_url: string
}
export interface LayersResult {
  layers: LayerInfo[]
  zip_url: string
}

async function imageUrlToB64(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read the image"))
    r.readAsDataURL(blob)
  })
}

interface Args {
  imageUrl: string
  promptJson?: string | null
  sourceJobId?: string
}

/**
 * Split an image into separate transparent layers — one per bounding-box
 * element (matted out), plus a background. Uses the saved prompt JSON to find
 * the element boxes; falls back to a foreground/background split when there are
 * none. Slow-ish (one cutout per element), so callers show a spinner.
 */
export function useSplitLayers() {
  return useMutation({
    mutationFn: async ({ imageUrl, promptJson, sourceJobId }: Args): Promise<LayersResult> => {
      const image_b64 = await imageUrlToB64(imageUrl)

      let elements: Array<{ type: string; text: string | null; desc: string; bbox: number[] | null }> = []
      if (promptJson) {
        try {
          const p = JSON.parse(promptJson)
          const els = p?.compositional_deconstruction?.elements ?? []
          elements = els.map((e: Record<string, unknown>) => ({
            type: (e.type as string) ?? "obj",
            text: (e.text as string) ?? null,
            desc: (e.desc as string) ?? "",
            bbox: Array.isArray(e.bbox) && e.bbox.length === 4 ? (e.bbox as number[]) : null,
          }))
        } catch {
          /* no usable elements — backend falls back to foreground/background */
        }
      }

      const res = await fetch("/api/edit/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64, elements, source_job_id: sourceJobId ?? null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Split into layers failed" }))
        throw new Error(err.detail ?? "Split into layers failed")
      }
      return res.json()
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
