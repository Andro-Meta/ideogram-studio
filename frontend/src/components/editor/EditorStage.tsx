import { useCallback, useEffect, useRef, useState } from "react"
import type { SelectionMode, ToolId } from "./editorTypes"
import {
  ctx2d,
  makeCanvas,
  maskFromEllipse,
  maskFromPolygon,
  maskFromRect,
  maskFromWand,
  maskWithBrushStroke,
} from "./editorCore"

interface StageProps {
  composite: HTMLCanvasElement | null
  selection: HTMLCanvasElement | null
  tool: ToolId
  brushSize: number
  brushSoftness: number
  brushErase: boolean
  wandTolerance: number
  onSelectionShape: (shape: HTMLCanvasElement, mode: SelectionMode) => void
  onZoomChange?: (zoom: number) => void
}

interface ViewTransform {
  scale: number
  x: number
  y: number
}

function modeFromEvent(e: { shiftKey: boolean; altKey: boolean }): SelectionMode {
  if (e.shiftKey) return "add"
  if (e.altKey) return "subtract"
  return "replace"
}

/**
 * The zoom/pan canvas viewport. Renders the composite plus a violet selection
 * tint, and turns pointer gestures into selection shapes in IMAGE coordinates
 * (the CSS transform keeps screen→image mapping a single affine inversion).
 */
export function EditorStage({
  composite, selection, tool,
  brushSize, brushSoftness, brushErase, wandTolerance,
  onSelectionShape, onZoomChange,
}: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const viewRef = useRef(view)
  viewRef.current = view

  // Active gesture (not React state — updated per pointermove)
  const gestureRef = useRef<{
    kind: "drag-shape" | "lasso" | "brush" | "pan" | null
    startX: number; startY: number          // image coords
    lastX: number; lastY: number
    points: { x: number; y: number }[]
    panStart?: { x: number; y: number; vx: number; vy: number }
    mode: SelectionMode
  }>({ kind: null, startX: 0, startY: 0, lastX: 0, lastY: 0, points: [], mode: "replace" })

  const imgW = composite?.width ?? 0
  const imgH = composite?.height ?? 0

  // ── fit on image change ─────────────────────────────────────────────────
  useEffect(() => {
    if (!composite || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const scale = Math.min(
      (rect.width - 48) / composite.width,
      (rect.height - 48) / composite.height,
      1,
    )
    const s = Math.max(scale, 0.02)
    setView({
      scale: s,
      x: (rect.width - composite.width * s) / 2,
      y: (rect.height - composite.height * s) / 2,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgW, imgH])

  useEffect(() => { onZoomChange?.(view.scale) }, [view.scale, onZoomChange])

  // ── draw composite + selection tint ─────────────────────────────────────
  useEffect(() => {
    const display = displayRef.current
    if (!display || !composite) return
    display.width = composite.width
    display.height = composite.height
    ctx2d(display).drawImage(composite, 0, 0)
  }, [composite])

  const drawOverlay = useCallback((inProgress?: (ctx: CanvasRenderingContext2D) => void) => {
    const overlay = overlayRef.current
    if (!overlay || !imgW) return
    if (overlay.width !== imgW) { overlay.width = imgW; overlay.height = imgH }
    const ctx = ctx2d(overlay)
    ctx.clearRect(0, 0, imgW, imgH)

    if (selection) {
      // violet tint where selected
      const tint = makeCanvas(imgW, imgH)
      const tctx = ctx2d(tint)
      tctx.drawImage(selection, 0, 0)
      tctx.globalCompositeOperation = "source-in"
      tctx.fillStyle = "rgba(139, 92, 246, 0.35)"
      tctx.fillRect(0, 0, imgW, imgH)
      ctx.drawImage(tint, 0, 0)
    }
    inProgress?.(ctx)
  }, [selection, imgW, imgH])

  useEffect(() => { drawOverlay() }, [drawOverlay])

  // ── coordinate mapping ──────────────────────────────────────────────────
  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current!
    const rect = stage.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (clientX - rect.left - v.x) / v.scale,
      y: (clientY - rect.top - v.y) / v.scale,
    }
  }, [])

  // ── pointer handlers ────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!composite) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toImageCoords(e.clientX, e.clientY)
    const g = gestureRef.current
    g.mode = modeFromEvent(e)

    const wantPan = tool === "pan" || e.button === 1
    if (wantPan) {
      g.kind = "pan"
      g.panStart = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y }
      return
    }
    if (e.button !== 0) return

    if (tool === "wand") {
      const shape = maskFromWand(composite, x, y, wandTolerance)
      onSelectionShape(shape, g.mode)
      return
    }
    if (tool === "marquee-rect" || tool === "marquee-ellipse") {
      g.kind = "drag-shape"
      g.startX = x; g.startY = y; g.lastX = x; g.lastY = y
      return
    }
    if (tool === "lasso") {
      g.kind = "lasso"
      g.points = [{ x, y }]
      return
    }
    if (tool === "brush") {
      g.kind = "brush"
      g.points = [{ x, y }]
      drawBrushPreview()
    }
  }, [composite, tool, wandTolerance, toImageCoords, onSelectionShape]) // eslint-disable-line react-hooks/exhaustive-deps

  const drawShapePreview = useCallback(() => {
    const g = gestureRef.current
    drawOverlay((ctx) => {
      ctx.strokeStyle = "rgba(139, 92, 246, 0.9)"
      ctx.lineWidth = Math.max(1, 1.5 / viewRef.current.scale)
      ctx.setLineDash([6 / viewRef.current.scale, 4 / viewRef.current.scale])
      const x = Math.min(g.startX, g.lastX)
      const y = Math.min(g.startY, g.lastY)
      const w = Math.abs(g.lastX - g.startX)
      const h = Math.abs(g.lastY - g.startY)
      ctx.beginPath()
      if (tool === "marquee-ellipse") {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      } else {
        ctx.rect(x, y, w, h)
      }
      ctx.stroke()
      ctx.setLineDash([])
    })
  }, [drawOverlay, tool])

  const drawLassoPreview = useCallback(() => {
    const g = gestureRef.current
    drawOverlay((ctx) => {
      if (g.points.length < 2) return
      ctx.strokeStyle = "rgba(139, 92, 246, 0.9)"
      ctx.lineWidth = Math.max(1, 1.5 / viewRef.current.scale)
      ctx.beginPath()
      ctx.moveTo(g.points[0].x, g.points[0].y)
      for (const p of g.points) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    })
  }, [drawOverlay])

  const drawBrushPreview = useCallback(() => {
    const g = gestureRef.current
    drawOverlay((ctx) => {
      ctx.fillStyle = g.mode === "subtract" || brushErase
        ? "rgba(248, 113, 113, 0.35)"
        : "rgba(139, 92, 246, 0.35)"
      for (const p of g.points) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, brushSize, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  }, [drawOverlay, brushSize, brushErase])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g.kind) return
    if (g.kind === "pan" && g.panStart) {
      setView((v) => ({
        ...v,
        x: g.panStart!.vx + (e.clientX - g.panStart!.x),
        y: g.panStart!.vy + (e.clientY - g.panStart!.y),
      }))
      return
    }
    const { x, y } = toImageCoords(e.clientX, e.clientY)
    if (g.kind === "drag-shape") {
      g.lastX = x; g.lastY = y
      drawShapePreview()
    } else if (g.kind === "lasso") {
      g.points.push({ x, y })
      drawLassoPreview()
    } else if (g.kind === "brush") {
      // interpolate between events so fast strokes stay continuous
      const last = g.points[g.points.length - 1]
      const dist = Math.hypot(x - last.x, y - last.y)
      const step = Math.max(brushSize / 3, 2)
      for (let d = step; d < dist; d += step) {
        g.points.push({
          x: last.x + ((x - last.x) * d) / dist,
          y: last.y + ((y - last.y) * d) / dist,
        })
      }
      g.points.push({ x, y })
      drawBrushPreview()
    }
  }, [toImageCoords, drawShapePreview, drawLassoPreview, drawBrushPreview, brushSize])

  const onPointerUp = useCallback(() => {
    const g = gestureRef.current
    if (!g.kind || !composite) { g.kind = null; return }
    const kind = g.kind
    g.kind = null

    if (kind === "pan") return
    if (kind === "drag-shape") {
      if (Math.abs(g.lastX - g.startX) > 2 && Math.abs(g.lastY - g.startY) > 2) {
        const build = tool === "marquee-ellipse" ? maskFromEllipse : maskFromRect
        onSelectionShape(build(imgW, imgH, g.startX, g.startY, g.lastX, g.lastY), g.mode)
      } else {
        drawOverlay()
      }
    } else if (kind === "lasso") {
      if (g.points.length >= 3) {
        onSelectionShape(maskFromPolygon(imgW, imgH, g.points), g.mode)
      } else {
        drawOverlay()
      }
      g.points = []
    } else if (kind === "brush") {
      const stroke = maskWithBrushStroke(null, imgW, imgH, g.points, brushSize, brushSoftness, false)
      onSelectionShape(stroke, brushErase || g.mode === "subtract" ? "subtract" : g.mode === "replace" ? "add" : g.mode)
      g.points = []
    }
  }, [composite, tool, imgW, imgH, brushSize, brushSoftness, brushErase, onSelectionShape, drawOverlay])

  // ── wheel zoom (to cursor) ──────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!stageRef.current) return
    e.preventDefault()
    const rect = stageRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const scale = Math.min(8, Math.max(0.02, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
    })
  }, [])

  const cursor =
    tool === "pan" ? "grab"
    : tool === "brush" ? "crosshair"
    : tool === "wand" ? "crosshair"
    : "crosshair"

  return (
    <div
      ref={stageRef}
      className="relative flex-1 overflow-hidden bg-zinc-950 touch-none select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          width: imgW,
          height: imgH,
        }}
      >
        <canvas ref={displayRef} className="absolute inset-0" style={{ imageRendering: view.scale > 2 ? "pixelated" : "auto" }} />
        <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
      </div>
    </div>
  )
}
