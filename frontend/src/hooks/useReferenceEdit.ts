import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"

export interface ReferenceEditArgs {
  imageBlob: Blob               // flattened canvas
  maskCanvas: HTMLCanvasElement // selection mask (white = edit here)
  prompt: string                // what to change in the selection
  sourceJobId?: string
  sampler_preset?: string
  ground?: boolean
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read image"))
    r.readAsDataURL(blob)
  })
}

async function callReferenceEdit(args: ReferenceEditArgs): Promise<EditResponse> {
  const image_b64 = await blobToB64(args.imageBlob)
  const mask_b64 = args.maskCanvas.toDataURL("image/png").split(",")[1] ?? ""
  const res = await fetch("/api/edit/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64,
      mask_b64,
      prompt: args.prompt,
      sampler_preset: args.sampler_preset ?? "V4_DEFAULT_20",
      source_job_id: args.sourceJobId,
      ground: args.ground ?? true,
      magic_prompt: false,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Reference edit failed" }))
    throw new Error(err.detail ?? "Reference edit failed")
  }
  return res.json()
}

/** Precise in-place edit via the reference-latent inpaint LoRA. The model
 *  regenerates the frame faithful to the original (the reference) and edits the
 *  selection; the rest is composited back from the original. Slow (loads the
 *  LoRA + a full denoise, ~2-3 min) and experimental. */
export function useReferenceEdit() {
  return useMutation({
    mutationFn: callReferenceEdit,
    onError: (err: Error) => toast.error(err.message),
  })
}
