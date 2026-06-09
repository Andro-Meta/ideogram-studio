import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { buildWsUrl } from "@/lib/ws"
import type { GenerationRequest } from "@/types/api"

export interface VariationResult {
  seed: number
  imageUrl: string
  durationMs: number
}

interface BatchState {
  results: VariationResult[]
  failures: number
  isRunning: boolean
  current: number   // 1-based index of generation in progress
  total: number
}

/** Generous ceiling per variation — 2k V4_QUALITY_48 renders take minutes,
 *  but nothing legitimate takes this long once the model is loaded. */
const VARIATION_TIMEOUT_MS = 15 * 60_000

function generateOne(
  req: GenerationRequest,
  sockets: Set<WebSocket>,
): Promise<VariationResult> {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID()
    const ws = new WebSocket(buildWsUrl(`/ws/${jobId}`))
    sockets.add(ws)

    let settled = false
    const timeout = setTimeout(() => {
      settle(reject, new Error("Variation timed out"))
      ws.close()
    }, VARIATION_TIMEOUT_MS)

    const settle = <T,>(fn: (v: T) => void, val: T) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        sockets.delete(ws)
        fn(val)
      }
    }

    ws.onopen = () => ws.send(JSON.stringify(req))
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === "done") {
          settle(resolve, {
            seed: msg.seed as number,
            imageUrl: msg.image_url as string,
            durationMs: msg.duration_ms as number,
          })
          ws.close(1000)
        } else if (msg.type === "error") {
          settle(reject, new Error(msg.message as string))
          ws.close()
        }
      } catch (err) {
        console.error("Malformed WS message:", err)
      }
    }
    ws.onerror = () => settle(reject, new Error("WebSocket error"))
    ws.onclose = (ev) => {
      if (ev.code !== 1000) settle(reject, new Error("Connection closed unexpectedly"))
    }
  })
}

export function useBatchGenerate() {
  const [state, setState] = useState<BatchState>({
    results: [],
    failures: 0,
    isRunning: false,
    current: 0,
    total: 0,
  })

  const cancelledRef = useRef(false)
  // Track every open socket (not just the last one) so cancel closes them all.
  const socketsRef = useRef<Set<WebSocket>>(new Set())

  const run = useCallback(async (baseReq: GenerationRequest, count: number) => {
    cancelledRef.current = false
    setState({ results: [], failures: 0, isRunning: true, current: 0, total: count })

    for (let i = 0; i < count; i++) {
      if (cancelledRef.current) break
      setState((s) => ({ ...s, current: i + 1 }))

      const seed = Math.floor(Math.random() * 2 ** 32)
      try {
        const result = await generateOne({ ...baseReq, seed }, socketsRef.current)
        if (!cancelledRef.current) {
          setState((s) => ({ ...s, results: [...s.results, result] }))
        }
      } catch (err) {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(`Variation ${i + 1}/${count} failed: ${msg}`)
          setState((s) => ({ ...s, failures: s.failures + 1 }))
          // Continue with remaining variations — don't abort the batch
        }
      }
      if (cancelledRef.current) break
    }

    setState((s) => ({ ...s, isRunning: false, current: 0 }))
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    for (const ws of socketsRef.current) {
      try { ws.close(1000) } catch { /* already closed */ }
    }
    socketsRef.current.clear()
    setState((s) => ({ ...s, isRunning: false, current: 0 }))
  }, [])

  const clear = useCallback(() => {
    setState({ results: [], failures: 0, isRunning: false, current: 0, total: 0 })
  }, [])

  return { run, cancel, clear, ...state }
}
