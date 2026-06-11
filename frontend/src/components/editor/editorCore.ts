/**
 * Pure canvas operations for the layered editor. No React in here — every
 * function takes canvases/numbers and returns canvases/numbers, which keeps
 * the pixel pipeline unit-testable and the hook thin.
 *
 * Compositing model (Photoshop-style adjustment layers):
 *   result = base
 *   for each visible layer (bottom → top):
 *     adjusted = filter(result)            // CSS filter chain on 2D context
 *     adjusted = adjusted ∩ layer.mask     // destination-in
 *     result   = result + adjusted @ layer.opacity
 *
 * Because each layer filters the CURRENT result, stacked layers compose the
 * way Photoshop users expect (a saturation layer above a brightness layer
 * sees the brightened pixels).
 */
import type { Adjustments, AdjustmentLayer, SelectionMode } from "./editorTypes"
import { isIdentity } from "./editorTypes"

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: false })
  if (!ctx) throw new Error("2D canvas context unavailable")
  return ctx
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

export function cssFilter(a: Adjustments): string {
  const parts: string[] = []
  if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`)
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`)
  if (a.saturation !== 1) parts.push(`saturate(${a.saturation})`)
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`)
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`)
  return parts.length ? parts.join(" ") : "none"
}

/** Full composite of base + adjustment layers, at native image resolution. */
export function composite(
  base: HTMLCanvasElement,
  layers: AdjustmentLayer[],
): HTMLCanvasElement {
  const result = cloneCanvas(base)
  const rctx = ctx2d(result)

  for (const layer of layers) {
    if (!layer.visible || layer.opacity === 0 || isIdentity(layer.adjustments)) continue

    const tmp = makeCanvas(base.width, base.height)
    const tctx = ctx2d(tmp)
    tctx.filter = cssFilter(layer.adjustments)
    tctx.drawImage(result, 0, 0)
    tctx.filter = "none"

    if (layer.mask) {
      tctx.globalCompositeOperation = "destination-in"
      tctx.drawImage(layer.mask, 0, 0)
      tctx.globalCompositeOperation = "source-over"
    }

    rctx.globalAlpha = layer.opacity
    rctx.drawImage(tmp, 0, 0)
    rctx.globalAlpha = 1
  }
  return result
}

// ── Selection mask builders ──────────────────────────────────────────────────
// All masks are image-resolution canvases; selectedness lives in the ALPHA
// channel (white @ alpha 255 = fully selected).

function blankMask(w: number, h: number): HTMLCanvasElement {
  return makeCanvas(w, h) // transparent = nothing selected
}

function fillSelected(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff"
}

export function maskFromRect(
  w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
): HTMLCanvasElement {
  const m = blankMask(w, h)
  const ctx = ctx2d(m)
  fillSelected(ctx)
  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
  return m
}

export function maskFromEllipse(
  w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
): HTMLCanvasElement {
  const m = blankMask(w, h)
  const ctx = ctx2d(m)
  fillSelected(ctx)
  ctx.beginPath()
  ctx.ellipse(
    (x0 + x1) / 2, (y0 + y1) / 2,
    Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2,
    0, 0, Math.PI * 2,
  )
  ctx.fill()
  return m
}

export function maskFromPolygon(
  w: number, h: number,
  points: { x: number; y: number }[],
): HTMLCanvasElement {
  const m = blankMask(w, h)
  if (points.length < 3) return m
  const ctx = ctx2d(m)
  fillSelected(ctx)
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  ctx.fill()
  return m
}

/** Stamp a soft round brush dab trail into a (new copy of the) mask. */
export function maskWithBrushStroke(
  current: HTMLCanvasElement | null,
  w: number, h: number,
  points: { x: number; y: number }[],
  radius: number,
  softness: number,          // 0 = hard edge, 1 = fully soft
  erase: boolean,
): HTMLCanvasElement {
  const m = current ? cloneCanvas(current) : blankMask(w, h)
  const ctx = ctx2d(m)
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over"
  for (const p of points) {
    const g = ctx.createRadialGradient(p.x, p.y, radius * (1 - softness), p.x, p.y, radius)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = softness > 0 ? g : "#ffffff"
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = "source-over"
  return m
}

/**
 * Magic wand: flood fill from (sx, sy) over `source` pixels, selecting the
 * connected region whose color stays within `tolerance` (0-255 per-channel
 * euclidean-ish distance) of the start pixel.
 */
export function maskFromWand(
  source: HTMLCanvasElement,
  sx: number, sy: number,
  tolerance: number,
): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const m = blankMask(w, h)
  sx = Math.floor(sx); sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return m

  const src = ctx2d(source).getImageData(0, 0, w, h).data
  const out = ctx2d(m).createImageData(w, h)
  const visited = new Uint8Array(w * h)
  const start = (sy * w + sx) * 4
  const r0 = src[start], g0 = src[start + 1], b0 = src[start + 2]
  const tol2 = tolerance * tolerance * 3

  const stack = new Int32Array(w * h)
  let sp = 0
  stack[sp++] = sy * w + sx

  while (sp > 0) {
    const idx = stack[--sp]
    if (visited[idx]) continue
    visited[idx] = 1
    const o = idx * 4
    const dr = src[o] - r0, dg = src[o + 1] - g0, db = src[o + 2] - b0
    if (dr * dr + dg * dg + db * db > tol2) continue

    out.data[o] = 255
    out.data[o + 1] = 255
    out.data[o + 2] = 255
    out.data[o + 3] = 255

    const x = idx % w
    if (x > 0 && !visited[idx - 1]) stack[sp++] = idx - 1
    if (x < w - 1 && !visited[idx + 1]) stack[sp++] = idx + 1
    if (idx >= w && !visited[idx - w]) stack[sp++] = idx - w
    if (idx < w * (h - 1) && !visited[idx + w]) stack[sp++] = idx + w
  }

  ctx2d(m).putImageData(out, 0, 0)
  return m
}

/** Combine a new shape into the current selection per the selection mode. */
export function combineSelection(
  current: HTMLCanvasElement | null,
  shape: HTMLCanvasElement,
  mode: SelectionMode,
): HTMLCanvasElement {
  if (mode === "replace" || !current) {
    return mode === "subtract" && !current ? blankMask(shape.width, shape.height) : shape
  }
  const m = cloneCanvas(current)
  const ctx = ctx2d(m)
  ctx.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out"
  ctx.drawImage(shape, 0, 0)
  ctx.globalCompositeOperation = "source-over"
  return m
}

export function invertMask(
  current: HTMLCanvasElement | null,
  w: number, h: number,
): HTMLCanvasElement {
  const m = makeCanvas(w, h)
  const ctx = ctx2d(m)
  fillSelected(ctx)
  ctx.fillRect(0, 0, w, h)
  if (current) {
    ctx.globalCompositeOperation = "destination-out"
    ctx.drawImage(current, 0, 0)
    ctx.globalCompositeOperation = "source-over"
  }
  return m
}

/** Feather = gaussian-ish blur of the mask alpha. Returns a new canvas. */
export function featherMask(
  mask: HTMLCanvasElement,
  radius: number,
): HTMLCanvasElement {
  if (radius <= 0) return mask
  const m = makeCanvas(mask.width, mask.height)
  const ctx = ctx2d(m)
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = "none"
  return m
}

/** True if the mask selects at least one pixel (cheap downsampled check). */
export function maskHasPixels(mask: HTMLCanvasElement | null): boolean {
  if (!mask) return false
  const probe = makeCanvas(64, 64)
  const ctx = ctx2d(probe)
  ctx.drawImage(mask, 0, 0, 64, 64)
  const data = ctx.getImageData(0, 0, 64, 64).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true
  }
  return false
}

/** Flatten the composite to a PNG blob for upload. */
export function flattenToBlob(
  base: HTMLCanvasElement,
  layers: AdjustmentLayer[],
): Promise<Blob> {
  const result = composite(base, layers)
  return new Promise((resolve, reject) => {
    result.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png",
    )
  })
}
