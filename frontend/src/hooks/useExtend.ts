import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"
import { cfgRequestFields } from "@/stores/settingsStore"

export interface ExtendArgs {
  imageBlob: Blob
  targetRatio: string        // "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "1:1"
  prompt?: string
  sourceJobId?: string
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read image"))
    r.readAsDataURL(blob)
  })
}

async function callExtend(args: ExtendArgs): Promise<EditResponse> {
  const image_b64 = await blobToB64(args.imageBlob)
  const res = await fetch("/api/edit/extend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64,
      target_ratio: args.targetRatio,
      prompt: args.prompt ?? "",
      source_job_id: args.sourceJobId,
      // Honour the user's custom CFG curve (same as text-to-image / remix).
      ...cfgRequestFields(),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Extend failed" }))
    throw new Error(err.detail ?? "Extend failed")
  }
  return res.json()
}

/** Outpaint / reframe — grow the canvas to a target ratio and fill the new
 *  area by continuing the scene. Slow (full diffusion). */
export function useExtend() {
  return useMutation({
    mutationFn: callExtend,
    onError: (err: Error) => toast.error(err.message),
  })
}
