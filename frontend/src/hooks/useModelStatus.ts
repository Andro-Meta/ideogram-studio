import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { ModelStatusResponse } from "@/types/api"

async function fetchModelStatus(): Promise<ModelStatusResponse> {
  const res = await fetch("/api/model/status")
  if (!res.ok) throw new Error("Could not reach server")
  return res.json()
}

async function loadModel(variant: string): Promise<void> {
  const res = await fetch("/api/model/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Load failed" }))
    throw new Error(err.detail)
  }
}

export function useModelStatus() {
  return useQuery({
    queryKey: ["model-status"],
    queryFn: fetchModelStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Poll every 2s while loading, every 10s otherwise
      return status === "loading" ? 2000 : 10_000
    },
  })
}

export function useLoadModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: loadModel,
    onSuccess: (_, variant) => {
      toast.info(`Loading ${variant} model...`)
      qc.invalidateQueries({ queryKey: ["model-status"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
