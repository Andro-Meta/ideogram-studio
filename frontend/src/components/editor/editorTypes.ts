/** Tool identifiers for the editor tool rail. */
export type ToolId =
  | "pan"
  | "marquee-rect"
  | "marquee-ellipse"
  | "lasso"
  | "brush"
  | "wand"

/** Per-layer pixel adjustments. 1 = identity for multiplicative ones. */
export interface Adjustments {
  brightness: number   // 0.2 – 2.5, 1 = unchanged
  contrast: number     // 0.2 – 2.5
  saturation: number   // 0   – 2.5
  hue: number          // -180 – 180 degrees
  blur: number         // 0 – 20 px
}

export const IDENTITY_ADJUSTMENTS: Adjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
}

export function isIdentity(a: Adjustments): boolean {
  return (
    a.brightness === 1 && a.contrast === 1 && a.saturation === 1 &&
    a.hue === 0 && a.blur === 0
  )
}

/**
 * A non-destructive adjustment layer. `mask` is an image-resolution canvas
 * whose ALPHA channel defines where the layer applies (255 = full effect);
 * null means the layer covers the whole image.
 *
 * Masks are treated as immutable once attached to a layer — tools build a new
 * canvas and replace the reference. That makes history snapshots cheap (they
 * share mask references instead of cloning pixels).
 */
export interface AdjustmentLayer {
  id: string
  name: string
  visible: boolean
  opacity: number              // 0..1
  adjustments: Adjustments
  mask: HTMLCanvasElement | null
}

/** How a new selection shape combines with the existing selection. */
export type SelectionMode = "replace" | "add" | "subtract"

export interface EditorState {
  layers: AdjustmentLayer[]
  activeLayerId: string | null
  /** Current selection mask (alpha channel), or null = no selection. */
  selection: HTMLCanvasElement | null
}
