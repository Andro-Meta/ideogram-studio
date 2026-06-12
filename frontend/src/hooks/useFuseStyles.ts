import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { StyleFuseRequest, StyleFuseResponse } from "@/types/api"

async function callFuse(req: StyleFuseRequest): Promise<StyleFuseResponse> {
  const res = await fetch("/api/style/fuse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }))
    throw new Error(err.detail ?? "AI Fuse failed")
  }
  return res.json()
}

/**
 * AI Fuse: ask the backend's LLM to invent one hybrid style from two
 * presets. Takes ~10-30s (OpenRouter or local Claude CLI), so callers
 * should show a pending state. Applying the result to the prompt store
 * is left to the caller via mutate's onSuccess.
 */
export function useFuseStyles() {
  return useMutation({
    mutationFn: callFuse,
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
