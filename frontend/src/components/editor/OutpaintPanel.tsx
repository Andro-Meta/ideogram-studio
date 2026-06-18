import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Pads } from "@/hooks/useExtend"

const RATIOS = ["16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "1:1"]
const ANCHORS: { x: number; y: number; label: string }[] = [
  { x: 0, y: 0, label: "↖" }, { x: 0.5, y: 0, label: "↑" }, { x: 1, y: 0, label: "↗" },
  { x: 0, y: 0.5, label: "←" }, { x: 0.5, y: 0.5, label: "•" }, { x: 1, y: 0.5, label: "→" },
  { x: 0, y: 1, label: "↙" }, { x: 0.5, y: 1, label: "↓" }, { x: 1, y: 1, label: "↘" },
]

/** Growth (px) needed to reach a target ratio while fully containing the
 *  original — grows exactly one dimension. */
function ratioGrowth(ow: number, oh: number, ratio: string): { gw: number; gh: number } {
  const [tw, th] = ratio.split(":").map(Number)
  const target = tw / th
  const src = ow / oh
  if (Math.abs(target - src) < 1e-3) return { gw: 0, gh: 0 }
  if (target > src) return { gw: Math.round(oh * target - ow), gh: 0 }
  return { gw: 0, gh: Math.round(ow / target - oh) }
}

export function OutpaintPanel({
  baseW, baseH, imageSrc, busy, pending, onExtend,
}: {
  baseW: number; baseH: number; imageSrc?: string
  busy: boolean; pending: boolean; onExtend: (pads: Pads) => void
}) {
  const [pads, setPads] = useState<Pads>({ top: 0, right: 0, bottom: 0, left: 0 })
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 })
  const [ratio, setRatio] = useState<string | null>(null)

  // When a ratio + anchor are chosen, derive the per-side pads (the anchor sets
  // which side(s) grow). Manual edits below clear the ratio.
  useEffect(() => {
    if (!ratio) return
    const { gw, gh } = ratioGrowth(baseW, baseH, ratio)
    const left = Math.round(gw * anchor.x)
    const top = Math.round(gh * anchor.y)
    setPads({ left, right: gw - left, top, bottom: gh - top })
  }, [ratio, anchor, baseW, baseH])

  const setSide = (side: keyof Pads, v: number) => {
    setRatio(null)
    setPads((p) => ({ ...p, [side]: Math.max(0, Math.min(4096, Math.round(v || 0))) }))
  }

  const total = pads.top + pads.right + pads.bottom + pads.left
  const newW = baseW + pads.left + pads.right
  const newH = baseH + pads.top + pads.bottom

  // Preview scaled into a ~150px box.
  const scale = 150 / Math.max(newW, newH)
  const pw = Math.round(newW * scale)
  const ph = Math.round(newH * scale)
  const ix = Math.round(pads.left * scale)
  const iy = Math.round(pads.top * scale)
  const iw = Math.round(baseW * scale)
  const ih = Math.round(baseH * scale)

  return (
    <div className="space-y-2.5">
      {/* Ratio quick-fills */}
      <div>
        <p className="text-[11px] text-zinc-500 mb-1">Grow to a ratio</p>
        <div className="grid grid-cols-4 gap-1">
          {RATIOS.map((r) => (
            <button
              key={r} type="button" onClick={() => setRatio(r)}
              className={cn(
                "rounded-md border px-1 py-1 text-[10px] font-medium transition-all",
                ratio === r ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        {/* Anchor grid — where the original sits (sets growth direction) */}
        <div>
          <p className="text-[11px] text-zinc-500 mb-1">Anchor</p>
          <div className="grid grid-cols-3 gap-0.5 w-[66px]">
            {ANCHORS.map((a) => (
              <button
                key={`${a.x}-${a.y}`} type="button"
                onClick={() => setAnchor({ x: a.x, y: a.y })}
                title="Where the original sits — it grows on the opposite sides"
                className={cn(
                  "h-5 w-5 rounded-sm border text-[10px] leading-none transition-all",
                  anchor.x === a.x && anchor.y === a.y
                    ? "border-violet-500 bg-violet-500/20 text-violet-200"
                    : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview of the new canvas + grow area */}
        <div className="flex-1">
          <p className="text-[11px] text-zinc-500 mb-1">Preview {total > 0 && <span className="text-zinc-600">· {newW}×{newH}</span>}</p>
          <div className="flex items-center justify-center bg-zinc-950/40 rounded-md border border-zinc-800 h-[150px]">
            <svg width={pw} height={ph} className="overflow-visible">
              {/* new canvas (grow area shaded) */}
              <rect x={0} y={0} width={pw} height={ph} className="fill-violet-500/15 stroke-violet-500/40" strokeWidth={1} strokeDasharray="3 2" />
              {/* original */}
              {imageSrc
                ? <image href={imageSrc} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="none" />
                : <rect x={ix} y={iy} width={iw} height={ih} className="fill-zinc-700" />}
            </svg>
          </div>
        </div>
      </div>

      {/* Per-side fine control */}
      <div>
        <p className="text-[11px] text-zinc-500 mb-1">Add per side (px)</p>
        <div className="grid grid-cols-4 gap-1.5">
          {(["top", "right", "bottom", "left"] as (keyof Pads)[]).map((side) => (
            <label key={side} className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase text-zinc-600">{side[0]}</span>
              <input
                type="number" min={0} max={4096} step={16} value={pads[side]}
                onChange={(e) => setSide(side, Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200"
              />
            </label>
          ))}
        </div>
      </div>

      <Button
        className="w-full bg-violet-600 hover:bg-violet-500 text-white gap-2 disabled:opacity-40"
        disabled={busy || total === 0}
        onClick={() => onExtend(pads)}
        title={total === 0 ? "Pick a ratio or add an amount to a side" : "Outpaint the new area"}
      >
        {pending
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Working… (~1 min)</>
          : <><Sparkles className="h-4 w-4" /> Outpaint</>}
      </Button>
      <p className="text-[11px] text-zinc-600 leading-relaxed">
        Pick a ratio (the anchor sets which sides grow — e.g. anchor ← to extend right only),
        or set exact px per side. The shaded area is what gets generated; your original stays exact.
      </p>
    </div>
  )
}
