import { useRef, useState, useEffect } from "react"
import { LayoutGrid } from "lucide-react"
import { BBoxRect } from "./BBoxRect"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { useGenerationStore } from "@/stores/generationStore"
import type { BBox } from "@/lib/bbox"

export function BBoxCanvas() {
  const elements = usePromptStore((s) => s.elements)
  const updateElement = usePromptStore((s) => s.updateElement)
  const { width, height } = useSettingsStore()
  const { status } = useGenerationStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

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

  return (
    // Composition tool, not an image viewer: cap the canvas at ~36vh tall.
    // aspect-ratio (not the padding-bottom hack — % padding resolves against
    // the PARENT width, which is what made the old canvas enormous).
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
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
              <p className="text-xs text-zinc-300">Generating…</p>
            </div>
          </div>
        )}

        {/* BBox rect overlays */}
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

        {/* Empty state hint */}
        {elementsWithBBox.length === 0 && !isGenerating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <LayoutGrid className="h-8 w-8 text-zinc-600" />
            <p className="text-xs text-zinc-600 text-center px-4">
              Pin elements to position them here
            </p>
          </div>
        )}

        {/* Resolution label */}
        <div className="absolute bottom-2 right-2 bg-black/50 text-zinc-500 text-[10px] px-1.5 py-0.5 rounded font-mono pointer-events-none">
          {width} × {height}
        </div>
      </div>
    </div>
  )
}
