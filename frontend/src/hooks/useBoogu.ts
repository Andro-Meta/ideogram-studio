import { useQuery, useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"

export function useBooguStatus() {
  return useQuery({
    queryKey: ["boogu-status"],
    queryFn: async () => {
      const r = await fetch("/api/boogu/status")
      return (await r.json()) as { installed: boolean; dir: string }
    },
  })
}

export interface BooguEditArgs {
  imageBlob: Blob
  instruction: string
  steps: number
  textGuidance: number
  imageGuidance: number
  size: 1024 | 2048
  offload: boolean
  fp8: boolean
  seed: number | null
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

export function useBooguEdit() {
  return useMutation({
    mutationFn: async (a: BooguEditArgs): Promise<EditResponse> => {
      const image_b64 = await blobToB64(a.imageBlob)
      const res = await fetch("/api/edit/boogu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64,
          instruction: a.instruction,
          steps: a.steps,
          text_guidance: a.textGuidance,
          image_guidance: a.imageGuidance,
          size: a.size,
          offload: a.offload,
          fp8: a.fp8,
          seed: a.seed,
          source_job_id: a.sourceJobId,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Boogu edit failed" }))
        throw new Error(err.detail ?? "Boogu edit failed")
      }
      return res.json()
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
