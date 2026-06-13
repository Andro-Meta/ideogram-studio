import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { aspectMatchedResolution } from "@/lib/caption"
import type { EditResponse } from "@/types/api"

export interface RemixArgs {
  imageB64: string          // the source image (no data: prefix)
  prompt: string            // structured caption JSON
  blendPct: number          // 0–100: how much of the original to keep
  sampler_preset?: string
  seed?: number | null
}

/** Resize the source to an aspect-matched ~1 MP canvas and build a solid-white
 *  mask the same size. The full-image mask turns the inpaint endpoint into a
 *  whole-image Remix (img2img); the resize keeps the run fast (a raw phone photo
 *  would otherwise generate at up to 2048² and run ~4× slower). */
function prepareRemix(imageB64: string): Promise<{ image: string; mask: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { width, height } = aspectMatchedResolution(img.naturalWidth, img.naturalHeight)
      const c = document.createElement("canvas")
      c.width = width
      c.height = height
      const ctx = c.getContext("2d")
      if (!ctx) return reject(new Error("Could not create canvas"))
      ctx.drawImage(img, 0, 0, width, height)
      const image = c.toDataURL("image/png").split(",")[1] ?? ""
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, width, height)
      const mask = c.toDataURL("image/png").split(",")[1] ?? ""
      resolve({ image, mask })
    }
    img.onerror = () => reject(new Error("Could not read the source image"))
    img.src = `data:image/*;base64,${imageB64}`
  })
}

async function callRemix(args: RemixArgs): Promise<EditResponse> {
  const { image, mask } = await prepareRemix(args.imageB64)
  // blend 100 → keep original (low strength); blend 0 → full regen (strength 1).
  const strength = Math.max(0.1, Math.min(1, 1 - args.blendPct / 100))
  const res = await fetch("/api/edit/inpaint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64: image,
      mask_b64: mask,
      prompt: args.prompt,
      strength,
      sampler_preset: args.sampler_preset ?? "V4_DEFAULT_20",
      seed: args.seed ?? null,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Remix failed" }))
    throw new Error(err.detail ?? "Remix failed")
  }
  return res.json()
}

/** Blend the uploaded image into a generation via the local Remix (img2img)
 *  path. Slow (full diffusion), so callers show the generating state. */
export function useRemixFromImage() {
  return useMutation({
    mutationFn: callRemix,
    onError: (err: Error) => toast.error(err.message),
  })
}
