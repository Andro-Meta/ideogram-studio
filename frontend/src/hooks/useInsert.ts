import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"
import { qualityRequestFields } from "@/stores/settingsStore"

export interface InsertArgs {
  imageBlob: Blob               // flattened canvas
  maskCanvas: HTMLCanvasElement // selection mask (white-on-transparent)
  prompt: string                // the object to add
  blend?: number                // 0.3–0.7: how much the refine reworks the pasted object
  sourceJobId?: string
  sampler_preset?: string
  ground?: boolean              // match the object to the scene's lighting (default on)
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read image"))
    r.readAsDataURL(blob)
  })
}

async function callInsert(args: InsertArgs): Promise<EditResponse> {
  const image_b64 = await blobToB64(args.imageBlob)
  const mask_b64 = args.maskCanvas.toDataURL("image/png").split(",")[1] ?? ""
  const res = await fetch("/api/edit/insert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64,
      mask_b64,
      prompt: args.prompt,
      strength: args.blend ?? 0.45,
      source_job_id: args.sourceJobId,
      ground: args.ground ?? true,
      magic_prompt: false,
      ...qualityRequestFields(),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Object insert failed" }))
    throw new Error(err.detail ?? "Object insert failed")
  }
  return res.json()
}

/** Insert a NEW object into the selection: the backend generates the object,
 *  mattes it to a cutout, composites it in, and RePaint-refines to blend.
 *  Slower than Fill (a generation + a refine pass, ~60-120s). */
export function useInsert() {
  return useMutation({
    mutationFn: callInsert,
    onError: (err: Error) => toast.error(err.message),
  })
}
