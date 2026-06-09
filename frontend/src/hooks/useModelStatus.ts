import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { ModelStatusResponse } from "@/types/api"
import type { ModelVariant } from "@/types/caption"

async function fetchModelStatus(): Promise<ModelStatusResponse> {
  const res = await fetch("/api/model/status")
  if (!res.ok) throw new Error("Could not reach server")
  return res.json()
}

/** Thrown when the backend's hardware preflight refuses the load (HTTP 422). */
export class LoadBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LoadBlockedError"
  }
}

export interface LoadModelArgs {
  variant: ModelVariant
  force?: boolean
}

async function loadModel({ variant, force = false }: LoadModelArgs): Promise<void> {
  const res = await fetch("/api/model/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant, force }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Load failed" }))
    if (res.status === 422) throw new LoadBlockedError(err.detail)
    throw new Error(err.detail)
  }
}

export function useModelStatus() {
  return useQuery({
    queryKey: ["model-status"],
    queryFn: fetchModelStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Poll fast while downloading/loading so progress feels live
      if (status === "downloading") return 1000
      if (status === "loading") return 2000
      return 10_000
    },
  })
}

export function useLoadModel() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: loadModel,
    onSuccess: (_, { variant }) => {
      toast.info(`Loading ${variant} model...`)
      qc.invalidateQueries({ queryKey: ["model-status"] })
    },
    onError: (err: Error, args) => {
      if (err instanceof LoadBlockedError) {
        // The hardware preflight refused — explain why and offer an override.
        toast.warning(err.message, {
          duration: 15_000,
          action: {
            label: "Load anyway",
            onClick: () => mutation.mutate({ ...args, force: true }),
          },
        })
      } else {
        toast.error(err.message)
      }
    },
  })
  return mutation
}

export function useUnloadModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/model/unload", { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unload failed" }))
        throw new Error(err.detail)
      }
    },
    onSuccess: () => {
      toast.success("Model unloaded")
      qc.invalidateQueries({ queryKey: ["model-status"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
