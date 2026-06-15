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
        // Log only the parse error — never the raw (untrusted) WS payload, so
        // there's no log-injection / tainted-format-string vector.
        console.error("Malformed WS message from server:", err)
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
      // Read LIVE status (not the render-time snapshot): an abnormal close is a
      // failure only while a run is ACTIVE — model-load or running. From any
      // resting state (idle/done/error) a close is expected and must not be
      // turned into a spurious error. code 1000 = our own cancel().
      const live = useGenerationStore.getState()
      const active = live.status === "running" || live.status === "loading-model"
      if (ev.code !== 1000 && active) {
        live.setError("Connection closed unexpectedly")
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
