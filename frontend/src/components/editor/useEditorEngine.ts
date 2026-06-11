import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Adjustments, AdjustmentLayer, SelectionMode } from "./editorTypes"
import { IDENTITY_ADJUSTMENTS } from "./editorTypes"
import {
  cloneCanvas,
  combineSelection,
  composite,
  ctx2d,
  featherMask,
  flattenToBlob,
  invertMask,
  makeCanvas,
  maskHasPixels,
} from "./editorCore"

interface HistoryEntry {
  layers: AdjustmentLayer[]
  activeLayerId: string | null
  selection: HTMLCanvasElement | null
}

const HISTORY_LIMIT = 40

let layerCounter = 0
function nextLayerName(): string {
  layerCounter += 1
  return `Adjustment ${layerCounter}`
}

/**
 * State engine for the layered editor.
 *
 * Layers and masks are treated as immutable values: every mutation builds new
 * objects/canvases and pushes a history entry, so undo/redo is pointer motion.
 * Slider drags are the exception — they update the active layer in place and
 * commit a single history entry on release (commitAdjustments).
 */
export function useEditorEngine(imageUrl: string, open: boolean) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [layers, setLayers] = useState<AdjustmentLayer[]>([])
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [selection, setSelection] = useState<HTMLCanvasElement | null>(null)

  const historyRef = useRef<HistoryEntry[]>([])
  const historyIdxRef = useRef(-1)
  const [historyVersion, setHistoryVersion] = useState(0) // re-render trigger

  // ── image load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBase(null)
    setLoadError(null)
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (cancelled) return
      const c = makeCanvas(img.naturalWidth, img.naturalHeight)
      ctx2d(c).drawImage(img, 0, 0)
      setBase(c)
      // fresh session state
      setLayers([])
      setActiveLayerId(null)
      setSelection(null)
      historyRef.current = [{ layers: [], activeLayerId: null, selection: null }]
      historyIdxRef.current = 0
      setHistoryVersion((v) => v + 1)
    }
    img.onerror = () => {
      if (!cancelled) setLoadError("Could not load the image for editing.")
    }
    img.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl, open])

  // ── history ─────────────────────────────────────────────────────────────
  const pushHistory = useCallback(
    (next: { layers?: AdjustmentLayer[]; activeLayerId?: string | null; selection?: HTMLCanvasElement | null }) => {
      const entry: HistoryEntry = {
        layers: next.layers !== undefined ? next.layers : layers,
        activeLayerId: next.activeLayerId !== undefined ? next.activeLayerId : activeLayerId,
        selection: next.selection !== undefined ? next.selection : selection,
      }
      const hist = historyRef.current.slice(0, historyIdxRef.current + 1)
      hist.push(entry)
      if (hist.length > HISTORY_LIMIT) hist.shift()
      historyRef.current = hist
      historyIdxRef.current = hist.length - 1

      setLayers(entry.layers)
      setActiveLayerId(entry.activeLayerId)
      setSelection(entry.selection)
      setHistoryVersion((v) => v + 1)
    },
    [layers, activeLayerId, selection],
  )

  const applyHistoryEntry = useCallback((idx: number) => {
    const entry = historyRef.current[idx]
    if (!entry) return
    historyIdxRef.current = idx
    setLayers(entry.layers)
    setActiveLayerId(entry.activeLayerId)
    setSelection(entry.selection)
    setHistoryVersion((v) => v + 1)
  }, [])

  const undo = useCallback(() => {
    if (historyIdxRef.current > 0) applyHistoryEntry(historyIdxRef.current - 1)
  }, [applyHistoryEntry])

  const redo = useCallback(() => {
    if (historyIdxRef.current < historyRef.current.length - 1) {
      applyHistoryEntry(historyIdxRef.current + 1)
    }
  }, [applyHistoryEntry])

  const canUndo = historyIdxRef.current > 0
  const canRedo = historyIdxRef.current < historyRef.current.length - 1

  // ── selection actions ───────────────────────────────────────────────────
  const applySelectionShape = useCallback(
    (shape: HTMLCanvasElement, mode: SelectionMode) => {
      const combined = combineSelection(selection, shape, mode)
      pushHistory({ selection: maskHasPixels(combined) ? combined : null })
    },
    [selection, pushHistory],
  )

  const deselect = useCallback(() => {
    if (selection) pushHistory({ selection: null })
  }, [selection, pushHistory])

  const invertSelection = useCallback(() => {
    if (!base) return
    pushHistory({ selection: invertMask(selection, base.width, base.height) })
  }, [base, selection, pushHistory])

  // ── layer actions ───────────────────────────────────────────────────────
  const addLayer = useCallback(
    (feather: number) => {
      if (!base) return
      const mask = selection
        ? featherMask(cloneCanvas(selection), feather)
        : null
      const layer: AdjustmentLayer = {
        id: crypto.randomUUID(),
        name: selection ? nextLayerName() : `${nextLayerName()} (whole image)`,
        visible: true,
        opacity: 1,
        adjustments: { ...IDENTITY_ADJUSTMENTS },
        mask,
      }
      pushHistory({
        layers: [...layers, layer],
        activeLayerId: layer.id,
        selection: null,             // selection is consumed by the layer
      })
    },
    [base, selection, layers, pushHistory],
  )

  const removeLayer = useCallback(
    (id: string) => {
      const next = layers.filter((l) => l.id !== id)
      pushHistory({
        layers: next,
        activeLayerId: activeLayerId === id ? (next.at(-1)?.id ?? null) : activeLayerId,
      })
    },
    [layers, activeLayerId, pushHistory],
  )

  const patchLayer = useCallback(
    (id: string, patch: Partial<Pick<AdjustmentLayer, "visible" | "opacity" | "name">>) => {
      pushHistory({
        layers: layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })
    },
    [layers, pushHistory],
  )

  const moveLayer = useCallback(
    (id: string, direction: -1 | 1) => {
      const idx = layers.findIndex((l) => l.id === id)
      const to = idx + direction
      if (idx < 0 || to < 0 || to >= layers.length) return
      const next = [...layers]
      ;[next[idx], next[to]] = [next[to], next[idx]]
      pushHistory({ layers: next })
    },
    [layers, pushHistory],
  )

  /** Live slider updates — no history entry until commitAdjustments(). */
  const previewAdjustments = useCallback(
    (id: string, adjustments: Adjustments) => {
      setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, adjustments } : l)))
    },
    [],
  )

  /** Live opacity/visibility preview without a history entry. */
  const previewLayerPatch = useCallback(
    (id: string, patch: Partial<Pick<AdjustmentLayer, "opacity" | "visible">>) => {
      setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    },
    [],
  )

  const commitAdjustments = useCallback(
    (id: string, adjustments: Adjustments) => {
      pushHistory({
        layers: layers.map((l) => (l.id === id ? { ...l, adjustments } : l)),
      })
    },
    [layers, pushHistory],
  )

  // ── derived ─────────────────────────────────────────────────────────────
  const compositeCanvas = useMemo(() => {
    if (!base) return null
    return composite(base, layers)
  }, [base, layers])

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null
  const dirty = layers.length > 0

  const flatten = useCallback(async (): Promise<Blob> => {
    if (!base) throw new Error("No image loaded")
    return flattenToBlob(base, layers)
  }, [base, layers])

  return {
    base, loadError, compositeCanvas,
    layers, activeLayer, activeLayerId, setActiveLayerId,
    selection, hasSelection: selection != null,
    applySelectionShape, deselect, invertSelection,
    addLayer, removeLayer, patchLayer, moveLayer,
    previewAdjustments, commitAdjustments, previewLayerPatch,
    undo, redo, canUndo, canRedo, historyVersion,
    dirty, flatten,
  }
}
