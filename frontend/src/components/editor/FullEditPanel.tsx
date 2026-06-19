import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Loader2, Sparkles, Trash2, Square, Type, Download } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { uid } from "@/lib/uid"
import { useFullImageEdit } from "@/hooks/useFullImageEdit"
import type { EditResponse } from "@/types/api"

interface Box {
  id: string
  kind: "object" | "text"
  desc: string
  text: string
  // normalized 0–1000
  ymin: number; xmin: number; ymax: number; xmax: number
}

const MIN = 30 // min normalized extent so a box can't collapse to a sliver

/**
 * EXPERIMENTAL "Full image edit": draw object/text boxes directly on the image,
 * then regenerate the WHOLE frame — Ideogram conditioned on this image as a
 * reference, reusing the original caption (or one described from it) PLUS the new
 * boxed elements. Like generation, but with the image as the base. Self-contained
 * (its own mini-canvas) so it doesn't touch the mask-based editor tools.
 */
export function FullEditPanel({
  imageUrl, baseW, baseH, getBlob, sourcePromptJson, sourceJobId, busy, onResult,
}: {
  imageUrl: string
  baseW: number
  baseH: number
  getBlob: () => Promise<Blob>
  sourcePromptJson?: string | null
  sourceJobId: string
  busy: boolean
  onResult: (res: EditResponse) => void
}) {
  const fullEdit = useFullImageEdit()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [newKind, setNewKind] = useState<"object" | "text">("object")
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [layerUrl, setLayerUrl] = useState<string | null>(null)

  const running = busy || fullEdit.isPending

  // pointer → normalized 0–1000 within the image surface
  const toNorm = (e: ReactPointerEvent) => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)),
    }
  }

  const onDown = (e: ReactPointerEvent) => {
    if (running) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toNorm(e)
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!draft) return
    const p = toNorm(e)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }
  const onUp = () => {
    if (!draft) return
    let xmin = Math.round(Math.min(draft.x0, draft.x1))
    let ymin = Math.round(Math.min(draft.y0, draft.y1))
    let xmax = Math.round(Math.max(draft.x0, draft.x1))
    let ymax = Math.round(Math.max(draft.y0, draft.y1))
    if (xmax - xmin < MIN) xmax = Math.min(1000, xmin + MIN)
    if (ymax - ymin < MIN) ymax = Math.min(1000, ymin + MIN)
    setDraft(null)
    setBoxes((b) => [...b, { id: uid(), kind: newKind, desc: "", text: "", ymin, xmin, ymax, xmax }])
  }

  const update = (id: string, patch: Partial<Box>) =>
    setBoxes((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id: string) => setBoxes((b) => b.filter((x) => x.id !== id))

  const ready = boxes.length > 0 && boxes.every((b) => (b.kind === "text" ? b.text.trim() : b.desc.trim()))

  const generate = async () => {
    if (!ready || running) return
    try {
      const blob = await getBlob()
      fullEdit.mutate(
        {
          imageBlob: blob,
          basePromptJson: sourcePromptJson ?? null,
          elements: boxes.map((b) => ({
            kind: b.kind,
            desc: b.desc.trim(),
            text: b.text.trim(),
            bbox: [b.ymin, b.xmin, b.ymax, b.xmax],
          })),
          sourceJobId,
          keepOriginal,
        },
        {
          onSuccess: (res) => {
            const cov = res.change_coverage != null ? ` (changed ${Math.round(res.change_coverage * 100)}% of the frame)` : ""
            toast.success(keepOriginal ? `Added — rest of the image kept exact${cov}` : "Full re-render complete")
            if (res.grounded === false && !sourcePromptJson) {
              toast.warning("No source caption and no OpenRouter key — described loosely. Add a key for a richer base.")
            }
            setLayerUrl(res.layer_url ?? null)
            onResult(res)
          },
        },
      )
    } catch (err) {
      console.error(err)
      toast.error("Could not prepare the image")
    }
  }

  const pct = (b: Box) => ({
    left: `${b.xmin / 10}%`, top: `${b.ymin / 10}%`,
    width: `${(b.xmax - b.xmin) / 10}%`, height: `${(b.ymax - b.ymin) / 10}%`,
  })
  const draftPct = draft && {
    left: `${Math.min(draft.x0, draft.x1) / 10}%`, top: `${Math.min(draft.y0, draft.y1) / 10}%`,
    width: `${Math.abs(draft.x1 - draft.x0) / 10}%`, height: `${Math.abs(draft.y1 - draft.y0) / 10}%`,
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-500 leading-snug">
        Drag on the image to box where a new object or text goes, label each, then
        regenerate the whole frame — Ideogram uses this image as a reference and its
        original caption, plus your boxes. With “keep original” on, SAM segments the
        added object and pastes only it (+ its shadow) back onto the untouched original.
        Works best for clearly-visible additions; objects described as hidden/behind
        something often won’t render.
      </p>

      {/* Kind picker for the next box you draw */}
      <div className="grid grid-cols-2 gap-1">
        {([["object", "Object", Square], ["text", "Text", Type]] as const).map(([id, label, Icon]) => (
          <button
            key={id} type="button" onClick={() => setNewKind(id)}
            className={cn(
              "flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[10px] font-medium transition-all",
              newKind === id ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200",
            )}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {/* Draw surface — image with box overlay */}
      <div
        ref={surfaceRef}
        className="relative w-full overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 touch-none select-none cursor-crosshair"
        style={{ aspectRatio: `${baseW} / ${baseH}` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      >
        <img src={imageUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
        {boxes.map((b, i) => (
          <div key={b.id} className="absolute border-2 border-violet-400/90 bg-violet-500/10" style={pct(b)}>
            <span className="absolute -top-0.5 -left-0.5 bg-violet-500 text-white text-[9px] leading-none px-1 py-0.5 rounded-sm">
              {i + 1}
            </span>
          </div>
        ))}
        {draftPct && <div className="absolute border-2 border-dashed border-violet-300 bg-violet-500/10" style={draftPct} />}
      </div>

      {/* Box list */}
      {boxes.length === 0 ? (
        <p className="text-[10px] text-zinc-600 text-center py-1">No boxes yet — drag on the image above.</p>
      ) : (
        <div className="space-y-1.5">
          {boxes.map((b, i) => (
            <div key={b.id} className="rounded-md border border-zinc-700/70 bg-zinc-800/40 p-1.5 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="bg-violet-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-sm shrink-0">{i + 1}</span>
                <div className="flex gap-1">
                  {(["object", "text"] as const).map((k) => (
                    <button
                      key={k} type="button" onClick={() => update(b.id, { kind: k })}
                      className={cn("rounded px-1.5 py-0.5 text-[9px] border",
                        b.kind === k ? "border-violet-500 bg-violet-500/10 text-violet-300" : "border-zinc-700 text-zinc-500")}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => remove(b.id)} className="ml-auto text-zinc-500 hover:text-red-400">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <Textarea
                value={b.kind === "text" ? b.text : b.desc}
                onChange={(e) => update(b.id, b.kind === "text" ? { text: e.target.value } : { desc: e.target.value })}
                placeholder={b.kind === "text" ? "Exact text to render…" : "Describe the object (e.g. a golden retriever, sitting)…"}
                rows={2} disabled={running}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 text-xs resize-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* Keep-original compositing — the breakthrough: discard the global
          re-render drift, paste back only the change inside your boxes. */}
      <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={keepOriginal} disabled={running}
          onChange={(e) => setKeepOriginal(e.target.checked)} className="accent-violet-500 mt-0.5" />
        <span>
          Keep original (composite only the change)
          <span className="block text-[9px] text-zinc-600 leading-snug">
            Pastes just the added content back onto the untouched original — no whole-image
            “deep fry.” Off = return the raw re-render.
          </span>
        </span>
      </label>

      <button
        type="button" onClick={generate} disabled={!ready || running}
        className="w-full flex items-center justify-center gap-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium py-2 disabled:opacity-40"
      >
        {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Regenerating…</>
          : <><Sparkles className="h-4 w-4" /> Regenerate with {boxes.length || "no"} box{boxes.length === 1 ? "" : "es"}</>}
      </button>
      {layerUrl && (
        <a
          href={layerUrl} download
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/40 py-1.5 text-[11px] text-violet-300 hover:bg-violet-500/10"
        >
          <Download className="h-3 w-3" /> Download the added layer (transparent PNG)
        </a>
      )}
      {!sourcePromptJson && (
        <p className="text-[9px] text-zinc-600 leading-snug">
          No original caption found for this image — it'll be described to build a base. Best results come from images made in this app (their caption is reused).
        </p>
      )}
    </div>
  )
}
