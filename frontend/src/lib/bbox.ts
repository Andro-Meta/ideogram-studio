/**
 * Bounding box utilities.
 *
 * Ideogram 4 bbox format: [ymin, xmin, ymax, xmax]  (Y first, then X)
 * Range: 0–1000 integers (normalized, NOT 0–1)
 * Origin: top-left
 */

export interface BBox {
  ymin: number  // 0–1000
  xmin: number
  ymax: number
  xmax: number
}

export interface PixelRect {
  left:   number
  top:    number
  width:  number
  height: number
}

/** Convert pixel rect to normalized BBox (0–1000 int coords). */
export function pixelToNorm(
  rect: PixelRect,
  canvasW: number,
  canvasH: number,
): BBox {
  return {
    ymin: Math.round((rect.top                  / canvasH) * 1000),
    xmin: Math.round((rect.left                 / canvasW) * 1000),
    ymax: Math.round(((rect.top + rect.height)  / canvasH) * 1000),
    xmax: Math.round(((rect.left + rect.width)  / canvasW) * 1000),
  }
}

/** Convert normalized BBox to pixel rect on a canvas of given size. */
export function normToPixel(bbox: BBox, canvasW: number, canvasH: number): PixelRect {
  return {
    left:   (bbox.xmin / 1000) * canvasW,
    top:    (bbox.ymin / 1000) * canvasH,
    width:  ((bbox.xmax - bbox.xmin) / 1000) * canvasW,
    height: ((bbox.ymax - bbox.ymin) / 1000) * canvasH,
  }
}

/** Clamp and normalize a BBox (ensure min <= max, values in 0–1000). */
export function clampBBox(bbox: BBox): BBox {
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)))
  const ymin = clamp(bbox.ymin)
  const xmin = clamp(bbox.xmin)
  const ymax = clamp(Math.max(bbox.ymin, bbox.ymax))
  const xmax = clamp(Math.max(bbox.xmin, bbox.xmax))
  return { ymin, xmin, ymax, xmax }
}

/** Shift a BBox by pixel delta, keeping it within canvas bounds. */
export function shiftBBox(
  bbox: BBox,
  dx: number,
  dy: number,
  canvasW: number,
  canvasH: number,
): BBox {
  const dxNorm = Math.round((dx / canvasW) * 1000)
  const dyNorm = Math.round((dy / canvasH) * 1000)
  const w = bbox.xmax - bbox.xmin
  const h = bbox.ymax - bbox.ymin
  let xmin = Math.max(0, Math.min(1000 - w, bbox.xmin + dxNorm))
  let ymin = Math.max(0, Math.min(1000 - h, bbox.ymin + dyNorm))
  return { ymin, xmin, ymax: ymin + h, xmax: xmin + w }
}

export const DEFAULT_BBOX: BBox = { ymin: 100, xmin: 100, ymax: 900, xmax: 900 }

/** Returns a new default bbox, slightly offset per index to avoid stacking. */
export function defaultBBoxForIndex(index: number): BBox {
  const offset = (index % 5) * 30
  return {
    ymin: 100 + offset,
    xmin: 100 + offset,
    ymax: 900 - offset,
    xmax: 900 - offset,
  }
}
