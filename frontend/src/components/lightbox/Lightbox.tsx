import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Download, Brush, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Link } from "react-router-dom"

interface LightboxProps {
  open: boolean
  onClose: () => void
  imageUrl: string
  /** Filename for the download link. */
  downloadName?: string
  /** When set, shows an "Edit" action linking to /editor?job=… */
  editJobId?: string | null
  /** Extra caption line under the actions (seed, duration, …) */
  caption?: string
}

interface View { scale: number; x: number; y: number }
const FIT: View = { scale: 1, x: 0, y: 0 }

/**
 * Full-screen image lightbox: wheel-zoom to cursor, drag to pan,
 * double-click to toggle 1×/2.5×, Esc or backdrop click to close.
 * Rendered in a portal so layout containers can't clip it.
 */
export function Lightbox({
  open, onClose, imageUrl, downloadName = "image.png", editJobId, caption,
}: LightboxProps) {
  const [view, setView] = useState<View>(FIT)
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null)
  const movedRef = useRef(false)

  useEffect(() => {
    if (open) setView(FIT)
  }, [open, imageUrl])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    // Prevent the page behind from scrolling while open
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const scale = Math.min(8, Math.max(0.2, v.scale * factor))
      if (cx == null || cy == null) return { ...v, scale }
      const k = scale / v.scale
      // zoom toward the cursor (coordinates relative to viewport center)
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }, [])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none"
      onClick={() => { if (!movedRef.current) onClose() }}
      onWheel={(e) => {
        const cx = e.clientX - window.innerWidth / 2
        const cy = e.clientY - window.innerHeight / 2
        zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy)
      }}
    >
      {/* Image */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="max-w-[92vw] max-h-[88vh] object-contain cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: dragRef.current ? "none" : "transform 120ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setView((v) => (v.scale > 1.01 ? FIT : { ...v, scale: 2.5 }))
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y }
          movedRef.current = false
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (!d) return
          const dx = e.clientX - d.startX
          const dy = e.clientY - d.startY
          if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
        }}
        onPointerUp={() => { dragRef.current = null }}
      />

      {/* Top-right actions */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setView(FIT)}
          className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Fit to screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="w-px h-5 bg-zinc-700 mx-0.5" />
        <a
          href={imageUrl}
          download={downloadName}
          className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Download PNG"
        >
          <Download className="h-4 w-4" />
        </a>
        {editJobId && (
          <Link
            to={`/editor?job=${editJobId}`}
            className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
            title="Open in Editor"
          >
            <Brush className="h-4 w-4" />
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Caption + zoom level */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[11px] text-zinc-400 bg-zinc-900/80 rounded-full px-4 py-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {caption && <span>{caption}</span>}
        <span className="tabular-nums">{Math.round(view.scale * 100)}%</span>
        <span className="text-zinc-600">scroll to zoom · drag to pan · double-click to toggle</span>
      </div>
    </div>,
    document.body,
  )
}
