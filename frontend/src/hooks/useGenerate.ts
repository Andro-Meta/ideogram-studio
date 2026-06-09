import { useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useGenerationStore } from "@/stores/generationStore"
import type { GenerationRequest, WsMessage } from "@/types/api"

export function useGenerate() {
  const wsRef = useRef<WebSocket | null>(null)
  const store = useGenerationStore()
  const queryClient = useQueryClient()

  const generate = useCallback((req: GenerationRequest) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const jobId = crypto.randomUUID()
    store.reset()
    store.setStatus("running")
    store.setJobId(jobId)

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? `${window.location.hostname}:8000`
      : window.location.host
    const ws = new WebSocket(`${protocol}//${host}/ws/${jobId}`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify(req))
    }

    ws.onmessage = (event) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      switch (msg.type) {
        case "started":
          break
        case "status":
          store.setStatus("loading-model", msg.message)
          break
        case "progress":
          store.setProgress(msg.step, msg.total)
          break
        case "done":
          store.setDone(msg.image_url, msg.seed, msg.duration_ms)
          toast.success(`Image generated in ${(msg.duration_ms / 1000).toFixed(1)}s`)
          queryClient.invalidateQueries({ queryKey: ["gallery"] })
          ws.close()
          break
        case "error":
          store.setError(msg.message)
          toast.error(`Generation failed: ${msg.message}`)
          ws.close()
          break
      }
    }

    ws.onerror = () => {
      store.setError("WebSocket connection error")
      toast.error("Connection error — is the server running?")
    }

    ws.onclose = (ev) => {
      if (ev.code !== 1000 && store.status === "running") {
        store.setError("Connection closed unexpectedly")
      }
      wsRef.current = null
    }
  }, [store])

  const cancel = useCallback(() => {
    wsRef.current?.close(1000)
    store.reset()
  }, [store])

  return { generate, cancel }
}
