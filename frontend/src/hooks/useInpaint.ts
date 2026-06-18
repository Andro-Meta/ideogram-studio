import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"
import { cfgRequestFields, qualityRequestFields } from "@/stores/settingsStore"

export interface InpaintArgs {
  imageBlob: Blob              // flattened canvas
  maskCanvas: HTMLCanvasElement // selection mask (white-on-transparent)
  prompt: string
  strength?: number           // 0.1–1: how much the selection may change
  sourceJobId?: string
  sampler_preset?: string
  ground?: boolean            // ground the caption in the source image (default on)
  magicPrompt?: boolean       // LLM rewrite of the instruction (default off)
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read image"))
    r.readAsDataURL(blob)
  })
}

async function callInpaint(args: InpaintArgs): Promise<EditResponse> {
  const image_b64 = await blobToB64(args.imageBlob)
  const mask_b64 = args.maskCanvas.toDataURL("image/png").split(",")[1] ?? ""
  const res = await fetch("/api/edit/inpaint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64,
      mask_b64,
      prompt: args.prompt,
      strength: args.strength ?? 0.75,
      source_job_id: args.sourceJobId,
      ground: args.ground ?? true,
      magic_prompt: args.magicPrompt ?? false,
      // Honour the user's chosen CFG + quality (sampler/steps) controls.
      ...cfgRequestFields(),
      ...qualityRequestFields(),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI fill failed" }))
    throw new Error(err.detail ?? "AI fill failed")
  }
  return res.json()
}

/** AI region fill (inpaint). Slow (full diffusion, ~30-60s), so callers show a
 *  spinner. Returns the new gallery image on success. */
export function useInpaint() {
  return useMutation({
    mutationFn: callInpaint,
    onError: (err: Error) => toast.error(err.message),
  })
}
