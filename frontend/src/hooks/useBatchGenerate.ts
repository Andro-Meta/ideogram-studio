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
  current: number   // 1-based index of the image in progress
  total: number
  note: string | null      // e.g. "Loading model…" — surfaced from WS status
  step: number             // current diffusion step within this image
  stepTotal: number        // total steps for this image
}

interface OneCallbacks {
  onStatus: (message: string) => void
  onProgress: (step: number, total: number) => void
}

/** Generous ceiling per image — 2k V4_QUALITY_48 renders take minutes,
 *  but nothing legitimate takes this long once the model is loaded. */
const VARIATION_TIMEOUT_MS = 15 * 60_000

function generateOne(
  req: GenerationRequest,
  sockets: Set<WebSocket>,
  cbs: OneCallbacks,
): Promise<VariationResult> {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID()
    const ws = new WebSocket(buildWsUrl(`/ws/${jobId}`))
    sockets.add(ws)

    let settled = false
    const timeout = setTimeout(() => {
      settle(reject, new Error("Image timed out"))
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
        if (msg.type === "status") {
          cbs.onStatus(msg.message as string)
        } else if (msg.type === "progress") {
          cbs.onProgress(msg.step as number, msg.total as number)
        } else if (msg.type === "done") {
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

const INITIAL: BatchState = {
  results: [], failures: 0, isRunning: false,
  current: 0, total: 0, note: null, step: 0, stepTotal: 0,
}

export function useBatchGenerate() {
  const [state, setState] = useState<BatchState>(INITIAL)

  const cancelledRef = useRef(false)
  // Track every open socket (not just the last one) so cancel closes them all.
  const socketsRef = useRef<Set<WebSocket>>(new Set())

  const run = useCallback(async (baseReq: GenerationRequest, count: number) => {
    cancelledRef.current = false
    setState({ ...INITIAL, isRunning: true, total: count })

    for (let i = 0; i < count; i++) {
      if (cancelledRef.current) break
      // Reset per-image progress when each image starts.
      setState((s) => ({ ...s, current: i + 1, note: null, step: 0, stepTotal: 0 }))

      const seed = Math.floor(Math.random() * 2 ** 32)
      try {
        const result = await generateOne(
          { ...baseReq, seed },
          socketsRef.current,
          {
            onStatus: (message) => setState((s) => ({ ...s, note: message })),
            onProgress: (step, total) =>
              setState((s) => ({ ...s, note: null, step, stepTotal: total })),
          },
        )
        if (!cancelledRef.current) {
          setState((s) => ({ ...s, results: [...s.results, result] }))
        }
      } catch (err) {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(`Batch image ${i + 1}/${count} failed: ${msg}`)
          setState((s) => ({ ...s, failures: s.failures + 1 }))
          // Continue with remaining images — don't abort the whole batch.
        }
      }
      if (cancelledRef.current) break
    }

    setState((s) => ({ ...s, isRunning: false, current: 0, note: null, step: 0, stepTotal: 0 }))
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    for (const ws of socketsRef.current) {
      try { ws.close(1000) } catch { /* already closed */ }
    }
    socketsRef.current.clear()
    setState((s) => ({ ...s, isRunning: false, current: 0, note: null }))
  }, [])

  const clear = useCallback(() => {
    setState(INITIAL)
  }, [])

  return { run, cancel, clear, ...state }
}
