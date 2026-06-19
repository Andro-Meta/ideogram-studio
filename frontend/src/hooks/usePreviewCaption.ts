import { useMutation } from "@tanstack/react-query"

export interface PreviewCaptionArgs {
  image_b64: string
  prompt: string
  width?: number
  height?: number
  preserve?: boolean
  element_bbox?: number[] | null
  ground?: boolean
  magic_prompt?: boolean
}

interface PreviewCaptionResult {
  caption: string
  grounded: boolean | null
}

async function callPreview(args: PreviewCaptionArgs): Promise<PreviewCaptionResult> {
  const res = await fetch("/api/edit/preview-caption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Preview failed" }))
    throw new Error(err.detail ?? "Preview failed")
  }
  return res.json()
}

/** Build (without generating) the exact JSON caption an edit would send, so the
 *  CaptionJsonPanel can show — and let the user hand-edit — it before running. */
export function usePreviewCaption() {
  return useMutation({ mutationFn: callPreview })
}
