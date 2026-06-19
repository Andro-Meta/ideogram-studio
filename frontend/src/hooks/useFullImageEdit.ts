import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"
import { cfgRequestFields, qualityRequestFields } from "@/stores/settingsStore"

export interface FullEditElement {
  kind: "object" | "text"
  desc?: string
  text?: string
  bbox: number[] // [ymin, xmin, ymax, xmax], 0–1000
  colors?: string[]
  behind?: boolean // keep existing foreground here on top (occlusion)
}

export interface FullImageEditArgs {
  imageBlob: Blob
  basePromptJson?: string | null // the caption that made the image, if any
  elements: FullEditElement[]
  sourceJobId?: string
  keepOriginal?: boolean // composite back only the change (default true)
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read image"))
    r.readAsDataURL(blob)
  })
}

async function call(args: FullImageEditArgs): Promise<EditResponse> {
  const image_b64 = await blobToB64(args.imageBlob)
  const res = await fetch("/api/edit/full-image-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64,
      base_prompt_json: args.basePromptJson ?? null,
      elements: args.elements,
      source_job_id: args.sourceJobId,
      keep_original: args.keepOriginal ?? true,
      ...cfgRequestFields(),
      ...qualityRequestFields(),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Full image edit failed" }))
    throw new Error(err.detail ?? "Full image edit failed")
  }
  return res.json()
}

/** EXPERIMENTAL whole-image edit — regenerate the full frame, conditioned on the
 *  source image, reusing its caption plus new boxed elements. Slow (full
 *  diffusion). Returns the new gallery image on success. */
export function useFullImageEdit() {
  return useMutation({
    mutationFn: call,
    onError: (err: Error) => toast.error(err.message),
  })
}
