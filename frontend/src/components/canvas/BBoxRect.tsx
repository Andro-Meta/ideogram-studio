import { useRef, useEffect, type CSSProperties } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { elementColor } from "@/lib/caption"
import { normToPixel, clampBBox, shiftBBox } from "@/lib/bbox"
import type { BBox } from "@/lib/bbox"
import type { AnyElement } from "@/types/caption"

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move"

interface DragState {
  dir: HandleDir
  startX: number
  startY: number
  startBBox: BBox
}

interface Props {
  element: AnyElement
  elementIndex: number
  canvasW: number
  canvasH: number
  onUpdate: (bbox: BBox) => void
  onRemove: () => void
}

const HANDLE = 8
const HANDLES: { dir: HandleDir; cursor: string; style: CSSProperties }[] = [
  { dir: "nw", cursor: "nw-resize", style: { top: -HANDLE / 2, left: -HANDLE / 2 } },
  { dir: "n",  cursor: "n-resize",  style: { top: -HANDLE / 2, left: "50%", marginLeft: -HANDLE / 2 } },
  { dir: "ne", cursor: "ne-resize", style: { top: -HANDLE / 2, right: -HANDLE / 2 } },
  { dir: "e",  cursor: "e-resize",  style: { top: "50%", right: -HANDLE / 2, marginTop: -HANDLE / 2 } },
  { dir: "se", cursor: "se-resize", style: { bottom: -HANDLE / 2, right: -HANDLE / 2 } },
  { dir: "s",  cursor: "s-resize",  style: { bottom: -HANDLE / 2, left: "50%", marginLeft: -HANDLE / 2 } },
  { dir: "sw", cursor: "sw-resize", style: { bottom: -HANDLE / 2, left: -HANDLE / 2 } },
  { dir: "w",  cursor: "w-resize",  style: { top: "50%", left: -HANDLE / 2, marginTop: -HANDLE / 2 } },
]

export function BBoxRect({ element, elementIndex, canvasW, canvasH, onUpdate, onRemove }: Props) {
  const colors = elementColor(elementIndex)
  const dragRef = useRef<DragState | null>(null)

  // Keep latest props accessible in global listeners without re-registering
  const canvasWRef = useRef(canvasW)
  const canvasHRef = useRef(canvasH)
  const onUpdateRef = useRef(onUpdate)
  canvasWRef.current = canvasW
  canvasHRef.current = canvasH
  onUpdateRef.current = onUpdate

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragRef.current
      if (!ds) return
      const cw = canvasWRef.current
      const ch = canvasHRef.current
      const dx = e.clientX - ds.startX
      const dy = e.clientY - ds.startY

      let next: BBox

      if (ds.dir === "move") {
        next = shiftBBox(ds.startBBox, dx, dy, cw, ch)
      } else {
        const dxN = Math.round((dx / cw) * 1000)
        const dyN = Math.round((dy / ch) * 1000)
        next = { ...ds.startBBox }
        if (ds.dir.includes("n")) next.ymin = ds.startBBox.ymin + dyN
        if (ds.dir.includes("s")) next.ymax = ds.startBBox.ymax + dyN
        if (ds.dir.includes("w")) next.xmin = ds.startBBox.xmin + dxN
        if (ds.dir.includes("e")) next.xmax = ds.startBBox.xmax + dxN
        // Enforce minimum 20-unit size
        if (next.xmax - next.xmin < 20) {
          if (ds.dir.includes("w")) next.xmin = next.xmax - 20
          else next.xmax = next.xmin + 20
        }
        if (next.ymax - next.ymin < 20) {
          if (ds.dir.includes("n")) next.ymin = next.ymax - 20
          else next.ymax = next.ymin + 20
        }
        next = clampBBox(next)
      }

      onUpdateRef.current(next)
    }

    const onUp = () => { dragRef.current = null }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent, dir: HandleDir) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startBBox: { ...element.bbox! },
    }
  }

  const rect = normToPixel(element.bbox!, canvasW, canvasH)
  const label = element.type === "text" && element.text
    ? `"${element.text.slice(0, 12)}${element.text.length > 12 ? "…" : ""}"`
    : element.desc.slice(0, 16) || `#${elementIndex + 1}`

  return (
    <div
      className={cn("absolute border-2 group select-none", colors.border)}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, cursor: "move" }}
      onMouseDown={(e) => startDrag(e, "move")}
    >
      {/* Hover bridge. The label + remove button sit ABOVE the box (-top-5),
          with a gap between them and the box's own hover area. Without this,
          moving the cursor up to the red X leaves the box, group-hover flips
          off, and the X vanishes before you can click it. This transparent
          strip is part of the group, so hover stays active across the gap.
          stopPropagation keeps a click in the strip from starting a drag. */}
      <div
        className="absolute -top-5 left-0 right-0 h-5"
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* Label chip */}
      <div
        className={cn(
          "absolute -top-5 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-t text-[10px] font-medium whitespace-nowrap pointer-events-none",
          colors.bg, colors.text
        )}
      >
        <span className="font-bold">{elementIndex + 1}</span>
        <span className="opacity-70 uppercase text-[9px]">{element.type}</span>
        <span className="opacity-60">{label}</span>
      </div>

      {/* Remove button */}
      <button
        className="absolute -top-5 right-0 hidden group-hover:flex items-center justify-center w-4 h-4 rounded bg-red-500/80 hover:bg-red-500 text-white transition-colors"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove() }}
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {/* Resize handles */}
      {HANDLES.map((h) => (
        <div
          key={h.dir}
          className={cn("absolute rounded-sm border-2 bg-zinc-900", colors.border)}
          style={{ ...h.style, position: "absolute", width: HANDLE, height: HANDLE, cursor: h.cursor }}
          onMouseDown={(e) => startDrag(e, h.dir)}
        />
      ))}
    </div>
  )
}
