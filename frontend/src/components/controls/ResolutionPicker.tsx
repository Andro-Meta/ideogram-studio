import { useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  NATIVE_ASPECT_RATIOS,
  resolutionForRatio,
  clampAspect,
  MAX_ASPECT_RATIO,
  MP_MIN,
  MP_MAX,
} from "@/lib/caption"
import { useSettingsStore } from "@/stores/settingsStore"

/** Tiny visual preview rectangle proportional to the aspect ratio. */
function RatioIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const MAX = 14
  const scale = MAX / Math.max(w, h)
  const pw = Math.max(4, Math.round(w * scale))
  const ph = Math.max(4, Math.round(h * scale))
  return (
    <div
      className={cn(
        "rounded-[2px] border",
        active ? "border-violet-400 bg-violet-500/20" : "border-zinc-500 bg-zinc-700/40"
      )}
      style={{ width: pw, height: ph }}
    />
  )
}

/**
 * Resolution picker: the full set of Ideogram 4 native aspect ratios plus a
 * megapixel budget slider that derives W×H (snapped to ×16). This replaces the
 * old fixed SD/HD preset table — pick a shape, dial the size. Custom W/H stays
 * available behind a chip. Ports the ComfyUI "Resolution Selector" idea locally,
 * snapping to ×16 (our pipeline's requirement) rather than ×8.
 */
export function ResolutionPicker() {
  const {
    width, height, setResolution,
    megapixels, setMegapixels,
    ratioLabel, setRatioLabel,
  } = useSettingsStore()
  const [custom, setCustom] = useState(false)
  const [wInput, setWInput] = useState("")
  const [hInput, setHInput] = useState("")
  const [aspectNotice, setAspectNotice] = useState(false)
  // `megapixels` is read straight from the store (no local shadow state) so a
  // scene/template load that writes it is reflected immediately, instead of the
  // slider/chip sizes going stale.

  const pickRatio = (r: { label: string; w: number; h: number }) => {
    setCustom(false)
    setAspectNotice(false)
    setRatioLabel(r.label)
    const res = resolutionForRatio(r.w, r.h, megapixels)
    setResolution(res.width, res.height)
  }

  // Live-update the readout while dragging; recompute the current ratio's size
  // and commit on release.
  const onMpChange = (v: number) => {
    setMegapixels(v)
    const r = NATIVE_ASPECT_RATIOS.find((x) => x.label === ratioLabel)
    if (r && !custom) {
      const res = resolutionForRatio(r.w, r.h, v)
      setResolution(res.width, res.height)
    }
  }

  const commitW = () => {
    const res = clampAspect(parseInt(wInput) || width, height, "w")
    setResolution(res.width, res.height)
    setWInput(String(res.width))
    setHInput(String(res.height))
    setAspectNotice(res.changed)
  }

  const commitH = () => {
    const res = clampAspect(width, parseInt(hInput) || height, "h")
    setResolution(res.width, res.height)
    setWInput(String(res.width))
    setHInput(String(res.height))
    setAspectNotice(res.changed)
  }

  const mpActual = ((width * height) / 1_000_000).toFixed(2)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Resolution</p>
        <span className="text-[10px] text-zinc-600 font-mono">{mpActual} MP</span>
      </div>

      {/* One wrapped row of native ratio chips (tall → square → wide) */}
      <div className="flex flex-wrap gap-1">
        {NATIVE_ASPECT_RATIOS.map((r) => {
          const active = !custom && r.label === ratioLabel
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => pickRatio(r)}
              title={`${r.label} · ${(() => { const x = resolutionForRatio(r.w, r.h, megapixels); return `${x.width}×${x.height}` })()}`}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-all",
                active
                  ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-zinc-700 bg-zinc-800/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              )}
            >
              <RatioIcon w={r.w} h={r.h} active={active} />
              <span className="text-[10px] font-medium leading-none">{r.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setCustom(true); setAspectNotice(false); setRatioLabel(""); setWInput(String(width)); setHInput(String(height)) }}
          className={cn(
            "rounded-md border px-1.5 py-1 text-[10px] font-medium transition-all",
            custom
              ? "border-violet-500 bg-violet-500/10 text-violet-300"
              : "border-zinc-700 bg-zinc-800/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          )}
        >
          Custom…
        </button>
      </div>

      {/* Megapixel budget — only meaningful in ratio mode */}
      {!custom && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-zinc-500">Size (megapixels)</Label>
            <span className="text-[10px] tabular-nums text-zinc-400">{megapixels.toFixed(2)} MP</span>
          </div>
          <Slider
            value={[megapixels]}
            min={MP_MIN}
            max={MP_MAX}
            step={0.05}
            onValueChange={([v]) => onMpChange(v)}
          />
          <div className="flex justify-between text-[9px] text-zinc-600">
            <span>fast · 0.25</span>
            <span>~2K · 4.0</span>
          </div>
        </div>
      )}

      {custom && (
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] text-zinc-500">W (px)</Label>
            <Input
              type="number"
              value={wInput}
              min={256} max={2048} step={16}
              onChange={(e) => setWInput(e.target.value)}
              onBlur={commitW}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7"
            />
          </div>
          <span className="text-zinc-600 text-xs pb-1.5">×</span>
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] text-zinc-500">H (px)</Label>
            <Input
              type="number"
              value={hInput}
              min={256} max={2048} step={16}
              onChange={(e) => setHInput(e.target.value)}
              onBlur={commitH}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7"
            />
          </div>
        </div>
      )}

      {custom && aspectNotice && (
        <p className="text-[10px] text-amber-400/90">
          Adjusted to keep the aspect ratio within {MAX_ASPECT_RATIO}:1 — Ideogram 4's supported range.
        </p>
      )}

      {/* Single-line readout: active size + constraints */}
      <p className="text-[10px] text-zinc-600 font-mono">
        {width} × {height}
        {!custom && ratioLabel && ` · ${ratioLabel}`}
        <span className="text-zinc-700 font-sans"> · 256–2048, ×16, ≤{MAX_ASPECT_RATIO}:1</span>
      </p>
    </div>
  )
}
