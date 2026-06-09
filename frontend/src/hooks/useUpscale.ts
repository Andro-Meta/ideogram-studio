import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import type { UpscaleModelInfo, UpscaleRequest, UpscaleResponse } from "@/types/api"

async function fetchUpscaleModels(): Promise<UpscaleModelInfo[]> {
  const res = await fetch("/api/upscale/models")
  if (!res.ok) return []
  return res.json()
}

async function runUpscale(req: UpscaleRequest): Promise<UpscaleResponse> {
  const res = await fetch("/api/upscale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }))
    throw new Error(err.detail ?? "Upscale failed")
  }
  return res.json()
}

export function useUpscaleModels() {
  return useQuery({
    queryKey: ["upscale-models"],
    queryFn: fetchUpscaleModels,
    staleTime: Infinity,
    retry: false,
  })
}

export function useUpscale() {
  return useMutation({
    mutationFn: runUpscale,
    onSuccess: (data) => {
      toast.success(`Upscaled to ${data.upscaled_width}×${data.upscaled_height}`)
    },
    onError: (err: Error) => {
      toast.error(`Upscale failed: ${err.message}`)
    },
  })
}
