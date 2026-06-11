import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

interface FreeGpuResponse {
  stopped: string[]
  vram_free_gb: number | null
}

/** Unload other apps' models (Ollama) from VRAM via the backend. */
export function useFreeGpu() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<FreeGpuResponse> => {
      const res = await fetch("/api/system/free-gpu", { method: "POST" })
      if (!res.ok) throw new Error(`Could not free GPU memory (${res.status})`)
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["system-info"] })
      if (data.stopped.length) {
        toast.success(
          `Freed GPU memory: ${data.stopped.join(", ")} unloaded` +
          (data.vram_free_gb != null ? ` — ${data.vram_free_gb} GB free` : ""),
        )
      } else {
        toast.info("No other models were using the GPU")
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
