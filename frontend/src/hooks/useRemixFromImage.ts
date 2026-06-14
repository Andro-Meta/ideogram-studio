import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"

export interface RemixArgs {
  imageB64: string          // the source image (no data: prefix)
  prompt: string            // structured caption JSON
  blendPct: number          // 0–100: how much of the original to keep
  width: number             // target canvas resolution (valid Ideogram size)
  height: number
  sampler_preset?: string
  seed?: number | null
  // Optional custom CFG curve (same controls as text-to-image).
  cfg?: number
  cfg_override?: number
  cfg_override_start?: number
}

/** Keep a generation size inside Ideogram's valid range (256–2048, ×16). */
function snap16(v: number): number {
  return Math.max(256, Math.min(2048, Math.round(v / 16) * 16))
}

/** Resize the source to the target canvas (an Ideogram-valid 1k–2k resolution)
 *  and build a solid-white mask the same size. The full-image mask turns the
 *  inpaint endpoint into a whole-image Remix (img2img). The source is *always*
 *  brought to the canvas size so a raw phone photo generates correctly (not at
 *  its native 12 MP, which would be wrong/slow); cover-fit preserves the source
 *  aspect ratio (the canvas is aspect-matched to it on upload, so by default
 *  this is an exact, non-cropping fit). */
function prepareRemix(
  imageB64: string,
  targetW: number,
  targetH: number,
): Promise<{ image: string; mask: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const width = snap16(targetW)
      const height = snap16(targetH)
      const c = document.createElement("canvas")
      c.width = width
      c.height = height
      const ctx = c.getContext("2d")
      if (!ctx) return reject(new Error("Could not create canvas"))
      // Cover-fit: scale to fill, centre any overflow (no stretching).
      const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
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
  const { image, mask } = await prepareRemix(args.imageB64, args.width, args.height)
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
      ...(args.cfg !== undefined
        ? { cfg: args.cfg, cfg_override: args.cfg_override, cfg_override_start: args.cfg_override_start }
        : {}),
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
