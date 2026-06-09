import { useCallback, useRef, useState } from "react"
import { buildWsUrl } from "@/lib/ws"
import type { GenerationRequest } from "@/types/api"

export interface VariationResult {
  seed: number
  imageUrl: string
  durationMs: number
}

interface BatchState {
  results: VariationResult[]
  isRunning: boolean
  current: number   // 1-based index of generation in progress
  total: number
}

async function generateOne(req: GenerationRequest, wsRef: { current: WebSocket | null }): Promise<VariationResult> {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID()
    const ws = new WebSocket(buildWsUrl(`/ws/${jobId}`))
    wsRef.current = ws

    let settled = false
    const settle = <T>(fn: (v: T) => void, val: T) => {
      if (!settled) { settled = true; fn(val) }
    }

    ws.onopen = () => ws.send(JSON.stringify(req))
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === "done") {
          settle(resolve, { seed: msg.seed as number, imageUrl: msg.image_url as string, durationMs: msg.duration_ms as number })
          ws.close(1000)
        } else if (msg.type === "error") {
          settle(reject, new Error(msg.message as string))
          ws.close()
        }
      } catch { /* ignore parse errors */ }
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
    isRunning: false,
    current: 0,
    total: 0,
  })

  const cancelledRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)

  const run = useCallback(async (baseReq: GenerationRequest, count: number) => {
    cancelledRef.current = false
    setState({ results: [], isRunning: true, current: 0, total: count })

    for (let i = 0; i < count; i++) {
      if (cancelledRef.current) break
      setState((s) => ({ ...s, current: i + 1 }))

      const seed = Math.floor(Math.random() * 2 ** 32)
      try {
        const result = await generateOne({ ...baseReq, seed }, wsRef)
        if (!cancelledRef.current) {
          setState((s) => ({ ...s, results: [...s.results, result] }))
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.warn(`Variation ${i + 1}/${count} failed:`, err)
          // Continue with remaining variations — don't abort the batch
        }
      }
    }

    setState((s) => ({ ...s, isRunning: false, current: 0 }))
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    wsRef.current?.close(1000)
    wsRef.current = null
    setState((s) => ({ ...s, isRunning: false, current: 0 }))
  }, [])

  const clear = useCallback(() => {
    setState({ results: [], isRunning: false, current: 0, total: 0 })
  }, [])

  return { run, cancel, clear, ...state }
}
