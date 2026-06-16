import { useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ASPECT_RATIO_PRESETS, clampAspect, MAX_ASPECT_RATIO } from "@/lib/caption"
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

const SD_PRESETS = ASPECT_RATIO_PRESETS.filter((p) => !p.group.startsWith("hd"))
const HD_PRESETS = ASPECT_RATIO_PRESETS.filter((p) => p.group.startsWith("hd"))

/**
 * Compact resolution picker: one wrapped row of aspect-ratio chips plus an
 * HD toggle, instead of six stacked preset groups. Same presets, ~1/4 the
 * vertical space (progressive disclosure: custom size stays behind a chip).
 */
export function ResolutionPicker() {
  const { width, height, setResolution } = useSettingsStore()
  const [custom, setCustom] = useState(false)
  const [wInput, setWInput] = useState("")
  const [hInput, setHInput] = useState("")
  const [aspectNotice, setAspectNotice] = useState(false)

  const activePreset = ASPECT_RATIO_PRESETS.find(
    (p) => p.width === width && p.height === height
  )
  const hd = activePreset ? activePreset.group.startsWith("hd") : false
  const tier = hd ? HD_PRESETS : SD_PRESETS

  const pickRatio = (label: string, fromTier = tier) => {
    const preset = fromTier.find((p) => p.label === label)
    if (!preset) return
    setCustom(false)
    setAspectNotice(false)
    setResolution(preset.width, preset.height)
  }

  const toggleHd = (on: boolean) => {
    // Re-pick the current ratio in the other tier (every ratio exists in both)
    const label = activePreset?.label ?? "1:1"
    pickRatio(label, on ? HD_PRESETS : SD_PRESETS)
  }

  // Commit a custom dimension: snap to 16, clamp to 256–2048, then clamp the
  // pair to ≤ 6:1. The just-edited side is the anchor, so the OTHER side is the
  // one nudged when the ratio would be too extreme.
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Resolution</p>
        <label className="flex items-center gap-1.5 cursor-pointer" title="HD presets — up to 2048 px, needs more VRAM">
          <span className={cn("text-[10px]", hd ? "text-amber-400" : "text-zinc-600")}>HD</span>
          <Switch checked={hd} onCheckedChange={toggleHd} className="scale-75 -my-1" />
        </label>
      </div>

      {/* One wrapped row of ratio chips (landscape → square → portrait) */}
      <div className="flex flex-wrap gap-1">
        {tier.map((p) => {
          const active = !custom && p.width === width && p.height === height
          return (
            <button
              key={`${p.group}-${p.label}`}
              type="button"
              onClick={() => pickRatio(p.label)}
              title={`${p.width} × ${p.height}`}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-all",
                active
                  ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-zinc-700 bg-zinc-800/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              )}
            >
              <RatioIcon w={p.width} h={p.height} active={active} />
              <span className="text-[10px] font-medium leading-none">{p.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setCustom(true); setAspectNotice(false); setWInput(String(width)); setHInput(String(height)) }}
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
        {activePreset && ` · ${activePreset.label}${hd ? " HD" : ""}`}
        <span className="text-zinc-700 font-sans"> · 256–2048, ×16, ≤{MAX_ASPECT_RATIO}:1</span>
      </p>
    </div>
  )
}
