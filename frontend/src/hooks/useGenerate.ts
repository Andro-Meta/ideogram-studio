import { useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useGenerationStore } from "@/stores/generationStore"
import { buildWsUrl } from "@/lib/ws"
import { uid } from "@/lib/uid"
import type { GenerationRequest, WsMessage } from "@/types/api"

export function useGenerate() {
  const wsRef = useRef<WebSocket | null>(null)
  const store = useGenerationStore()
  const queryClient = useQueryClient()

  const generate = useCallback((req: GenerationRequest) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const jobId = uid()
    store.reset()
    store.setStatus("running")
    store.setJobId(jobId)

    const ws = new WebSocket(buildWsUrl(`/ws/${jobId}`))
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify(req))
    }

    ws.onmessage = (event) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(event.data)
      } catch (err) {
        // Log only the error + payload size, never the raw (untrusted) payload
        // text — keeps the diagnostic useful without a log-injection vector.
        const size = typeof event.data === "string" ? event.data.length : -1
        console.error(`Malformed WS message from server (len=${size}):`, err)
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
