import { useRef, useState, useEffect, type PointerEvent as ReactPointerEvent } from "react"
import {
  LayoutGrid, MapPin, MousePointer2, Square, Circle, Lasso, Type, Shapes, Ban,
  AlertTriangle,
} from "lucide-react"
import { BBoxRect } from "./BBoxRect"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { useGenerationStore } from "@/stores/generationStore"
import { pixelToNorm, normToPixel, clampBBox, type BBox } from "@/lib/bbox"
import { ColorPicker } from "@/components/palette/ColorPicker"

// Draw tools. "move" is the default — existing pin/drag/resize behaviour.
// box/ellipse/lasso are opt-in: they let you sketch a region directly on the
// frame (matching KJNodes' freehand prompt builder). The model only consumes a
// bounding box, so ellipse + lasso simply auto-fit a box to the drawn shape —
// the shape itself is just visual guidance while you draw.
type Tool = "move" | "box" | "ellipse" | "lasso"

interface Pt { x: number; y: number }

// The model takes a box, not a pixel shape — keep regions from collapsing to a
// sliver by enforcing a small minimum extent (matches BBoxRect's 20-unit floor).
function enforceMinNorm(b: BBox): BBox {
  const MIN = 20
  const xmax = b.xmax - b.xmin < MIN ? Math.min(1000, b.xmin + MIN) : b.xmax
  const ymax = b.ymax - b.ymin < MIN ? Math.min(1000, b.ymin + MIN) : b.ymax
  return { ...b, xmax, ymax }
}

export function BBoxCanvas() {
  const elements = usePromptStore((s) => s.elements)
  const updateElement = usePromptStore((s) => s.updateElement)
  const addDrawnElement = usePromptStore((s) => s.addDrawnElement)
  const { width, height } = useSettingsStore()
  const { status } = useGenerationStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

  // Draw state
  const [tool, setTool] = useState<Tool>("move")
  const [newType, setNewType] = useState<"obj" | "text">("obj")
  const [color, setColor] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draft, setDraft] = useState<Pt[] | null>(null) // null = not drawing

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setCanvasSize({ w: r.width, h: r.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const elementsWithBBox = elements.filter((el) => !!el.bbox)
  const isGenerating = status === "running" || status === "loading-model"
  const drawing = tool !== "move"

  // Live overlap feedback. Ideogram composes worse when boxes overlap — worst
  // of all for text (each text element needs its own zone). We don't *prevent*
  // overlap (a subject in front of a background is legitimate), but we surface
  // the offending intersection so it's obvious as you stack boxes. Mirrors the
  // detection in validatePromptState (lib/caption.ts).
  const overlaps: { rect: { left: number; top: number; width: number; height: number }; text: boolean }[] = []
  if (canvasSize.w > 0) {
    for (let a = 0; a < elementsWithBBox.length; a++) {
      for (let b = a + 1; b < elementsWithBBox.length; b++) {
        const A = elementsWithBBox[a].bbox!
        const B = elementsWithBBox[b].bbox!
        const x0 = Math.max(A.xmin, B.xmin), x1 = Math.min(A.xmax, B.xmax)
        const y0 = Math.max(A.ymin, B.ymin), y1 = Math.min(A.ymax, B.ymax)
        if (x1 > x0 && y1 > y0) {
          const text = elementsWithBBox[a].type === "text" || elementsWithBBox[b].type === "text"
          overlaps.push({
            rect: normToPixel({ ymin: y0, xmin: x0, ymax: y1, xmax: x1 }, canvasSize.w, canvasSize.h),
            text,
          })
        }
      }
    }
  }
  const hasTextOverlap = overlaps.some((o) => o.text)

  // ---- draw-capture handlers (only active when a draw tool is selected) ----

  function localPoint(e: ReactPointerEvent): Pt {
    const r = containerRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!drawing || isGenerating) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDraft([localPoint(e)])
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!draft) return
    const p = localPoint(e)
    setDraft((prev) => {
      if (!prev) return prev
      // box/ellipse only need start + current; lasso accumulates the path.
      if (tool === "lasso") return [...prev, p]
      return [prev[0], p]
    })
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!draft) return
    e.preventDefault()
    const pts = draft
    setDraft(null)

    // Bounding box of whatever was drawn (shape → box).
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const w = Math.max(...xs) - left
    const h = Math.max(...ys) - top

    // Ignore stray clicks / tiny drags (a real region needs some extent).
    if (w < 10 && h < 10) return

    const bbox = enforceMinNorm(
      clampBBox(pixelToNorm({ left, top, width: w, height: h }, canvasSize.w, canvasSize.h)),
    )
    addDrawnElement(newType, bbox, color ?? undefined)
  }

  // ---- live draft geometry (in px, for the SVG overlay) ----
  let draftRect: { x: number; y: number; w: number; h: number } | null = null
  let draftPath = ""
  if (draft && draft.length > 0) {
    const xs = draft.map((p) => p.x)
    const ys = draft.map((p) => p.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    draftRect = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    if (tool === "lasso") draftPath = draft.map((p) => `${p.x},${p.y}`).join(" ")
  }
  const draftStroke = color ?? "#a78bfa" // violet-400 default

  return (
    <div className="space-y-2">
      {/* Draw toolbar */}
      <div className="flex items-center gap-2 flex-wrap text-zinc-400">
        {/* Tools */}
        <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden">
          <ToolBtn active={tool === "move"} onClick={() => setTool("move")} title="Move / edit boxes">
            <MousePointer2 className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn active={tool === "box"} onClick={() => setTool("box")} title="Draw a box region">
            <Square className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn active={tool === "ellipse"} onClick={() => setTool("ellipse")} title="Draw an ellipse (auto-fits a box)">
            <Circle className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn active={tool === "lasso"} onClick={() => setTool("lasso")} title="Lasso a region (auto-fits a box)">
            <Lasso className="h-3.5 w-3.5" />
          </ToolBtn>
        </div>

        {/* What a drawn region becomes — only relevant while a draw tool is on */}
        {drawing && (
          <>
            <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden">
              <ToolBtn active={newType === "obj"} onClick={() => setNewType("obj")} title="New region = object">
                <Shapes className="h-3.5 w-3.5" />
              </ToolBtn>
              <ToolBtn active={newType === "text"} onClick={() => setNewType("text")} title="New region = text">
                <Type className="h-3.5 w-3.5" />
              </ToolBtn>
            </div>

            {/* Optional starting color for the region — full picker (wheel +
                swatch grid), same as the palette editor. */}
            <div className="relative inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setColor(null)}
                title="No color"
                className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                  color === null ? "border-violet-400" : "border-zinc-600"
                }`}
              >
                <Ban className="h-3 w-3 text-zinc-500" />
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                title={color ?? "Pick a color"}
                className={`h-5 w-5 rounded-full border ${
                  color ? "border-white ring-1 ring-violet-400" : "border-zinc-500"
                }`}
                style={
                  color
                    ? { backgroundColor: color }
                    : { background: "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)" }
                }
              />
              {pickerOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close color picker"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setPickerOpen(false)}
                  />
                  <ColorPicker
                    value={color ?? "#000000"}
                    onPick={(c) => setColor(c)}
                    onClose={() => setPickerOpen(false)}
                    className="absolute top-7 left-0 z-50"
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Composition tool, not an image viewer: cap the canvas at ~36vh tall.
          aspect-ratio (not the padding-bottom hack — % padding resolves against
          the PARENT width, which is what made the old canvas enormous). */}
      <div
        className="relative w-full mx-auto"
        style={{
          aspectRatio: `${width} / ${height}`,
          maxWidth: `min(100%, calc(36vh * ${(width / height).toFixed(4)}))`,
        }}
      >
        <div
          ref={containerRef}
          className="absolute inset-0 rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700"
          style={{ userSelect: "none" }}
        >
          {/* Subtle dot-grid background */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, #3f3f46 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          {/* Overlay while generating */}
          {isGenerating && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-30">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
                <p className="text-xs text-zinc-300">Generating…</p>
              </div>
            </div>
          )}

          {/* BBox rect overlays — interactive only in Move mode, so draw tools
              can sketch over them without grabbing a handle. */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: drawing ? "none" : "auto" }}
          >
            {canvasSize.w > 0 && elementsWithBBox.map((el) => {
              const idx = elements.indexOf(el)
              return (
                <BBoxRect
                  key={el.id}
                  element={el}
                  elementIndex={idx}
                  canvasW={canvasSize.w}
                  canvasH={canvasSize.h}
                  onUpdate={(bbox: BBox) => updateElement(el.id, { bbox })}
                  onRemove={() => updateElement(el.id, { bbox: undefined })}
                />
              )
            })}
          </div>

          {/* Overlap warning overlay — tints the intersection of any two pinned
              boxes so stacked/overlapping regions are obvious. Red when a text
              box is involved (worst case), amber for object-on-object. */}
          {overlaps.length > 0 && !isGenerating && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
              <defs>
                <pattern id="overlap-hatch-red" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <rect width="8" height="8" fill="rgba(239,68,68,0.10)" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239,68,68,0.55)" strokeWidth="1.5" />
                </pattern>
                <pattern id="overlap-hatch-amber" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <rect width="8" height="8" fill="rgba(245,158,11,0.08)" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(245,158,11,0.45)" strokeWidth="1.5" />
                </pattern>
              </defs>
              {overlaps.map((o, i) => (
                <rect
                  key={i}
                  x={o.rect.left}
                  y={o.rect.top}
                  width={o.rect.width}
                  height={o.rect.height}
                  fill={`url(#overlap-hatch-${o.text ? "red" : "amber"})`}
                  stroke={o.text ? "rgba(239,68,68,0.8)" : "rgba(245,158,11,0.7)"}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
              ))}
            </svg>
          )}

          {/* Overlap count badge */}
          {overlaps.length > 0 && !isGenerating && (
            <div
              className={`absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium pointer-events-none ${
                hasTextOverlap ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"
              }`}
              title={
                hasTextOverlap
                  ? "A text box overlaps another box. Ideogram renders text worst when zones overlap — give each text element its own non-overlapping box."
                  : "Some boxes overlap. Ideogram composes more reliably with non-overlapping boxes (a little overlap for depth is usually fine)."
              }
            >
              <AlertTriangle className="h-3 w-3" />
              {overlaps.length} overlap{overlaps.length > 1 ? "s" : ""}
              {hasTextOverlap && " · text"}
            </div>
          )}

          {/* Draw-capture layer — on top, only catches events when a draw tool
              is active. Renders live feedback for the shape being drawn. */}
          <div
            className="absolute inset-0 z-20"
            style={{
              pointerEvents: drawing && !isGenerating ? "auto" : "none",
              cursor: drawing ? "crosshair" : "default",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {draft && draftRect && (
              <svg className="absolute inset-0 w-full h-full overflow-visible">
                {tool === "ellipse" ? (
                  <ellipse
                    cx={draftRect.x + draftRect.w / 2}
                    cy={draftRect.y + draftRect.h / 2}
                    rx={draftRect.w / 2}
                    ry={draftRect.h / 2}
                    fill={draftStroke}
                    fillOpacity={0.12}
                    stroke={draftStroke}
                    strokeWidth={1.5}
                  />
                ) : tool === "lasso" ? (
                  <polyline
                    points={draftPath}
                    fill={draftStroke}
                    fillOpacity={0.12}
                    stroke={draftStroke}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                ) : (
                  <rect
                    x={draftRect.x}
                    y={draftRect.y}
                    width={draftRect.w}
                    height={draftRect.h}
                    fill={draftStroke}
                    fillOpacity={0.12}
                    stroke={draftStroke}
                    strokeWidth={1.5}
                  />
                )}
                {/* For ellipse/lasso, also show the box that will actually be sent */}
                {tool !== "box" && (
                  <rect
                    x={draftRect.x}
                    y={draftRect.y}
                    width={draftRect.w}
                    height={draftRect.h}
                    fill="none"
                    stroke={draftStroke}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.5}
                  />
                )}
              </svg>
            )}
          </div>

          {/* Empty state hint — tells you the actual next step, which differs
              depending on whether you have any elements to pin yet. */}
          {elementsWithBBox.length === 0 && !isGenerating && !drawing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 pointer-events-none z-10">
              <LayoutGrid className="h-8 w-8 text-zinc-600" />
              {elements.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center leading-relaxed">
                  Optional layout control.<br />
                  Add an <span className="text-zinc-300">object</span> or{" "}
                  <span className="text-zinc-300">text</span> element below, then
                  pin it here — or pick a <span className="text-zinc-300">draw tool</span>{" "}
                  above and sketch a region right on the frame.
                </p>
              ) : (
                <p className="text-xs text-zinc-500 text-center leading-relaxed inline-flex flex-wrap items-center justify-center gap-1">
                  Click the
                  <MapPin className="h-3.5 w-3.5 text-violet-400 inline" />
                  pin on an element to drop it onto the frame, then drag to position.
                </p>
              )}
            </div>
          )}

          {/* Draw-mode hint */}
          {drawing && !draft && !isGenerating && (
            <div className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none z-10">
              <p className="text-xs text-zinc-500 text-center leading-relaxed">
                Drag to sketch a{" "}
                <span className="text-zinc-300">{newType === "text" ? "text" : "object"}</span>{" "}
                region. {tool !== "box" && "It snaps to a bounding box. "}
                Switch to <MousePointer2 className="h-3 w-3 inline" /> to nudge or resize.
              </p>
            </div>
          )}

          {/* Resolution label */}
          <div className="absolute bottom-2 right-2 bg-black/50 text-zinc-500 text-[10px] px-1.5 py-0.5 rounded font-mono pointer-events-none z-10">
            {width} × {height}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolBtn({
  active, onClick, title, children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1.5 transition-colors ${
        active
          ? "bg-violet-500/20 text-violet-300"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
      }`}
    >
      {children}
    </button>
  )
}
