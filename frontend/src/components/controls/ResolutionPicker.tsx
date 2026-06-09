import { useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ASPECT_RATIO_PRESETS, snapTo16 } from "@/lib/caption"
import { useSettingsStore } from "@/stores/settingsStore"

/** Tiny visual preview rectangle proportional to the aspect ratio. */
function RatioIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const MAX = 18
  const scale = MAX / Math.max(w, h)
  const pw = Math.max(4, Math.round(w * scale))
  const ph = Math.max(4, Math.round(h * scale))
  return (
    <div
      className={cn(
        "rounded-sm border",
        active ? "border-violet-400 bg-violet-500/20" : "border-zinc-500 bg-zinc-700/40"
      )}
      style={{ width: pw, height: ph }}
    />
  )
}

const GROUPS = [
  { key: "landscape", label: "Landscape" },
  { key: "square",    label: "Square"    },
  { key: "portrait",  label: "Portrait"  },
] as const

export function ResolutionPicker() {
  const { width, height, setResolution } = useSettingsStore()
  const [custom, setCustom] = useState(false)
  const [wInput, setWInput] = useState("")
  const [hInput, setHInput] = useState("")

  const activePreset = ASPECT_RATIO_PRESETS.find(
    (p) => p.width === width && p.height === height
  )

  const handlePreset = (w: number, h: number) => {
    setCustom(false)
    setResolution(w, h)
  }

  const handleCustomW = (raw: string) => {
    setWInput(raw)
    const n = snapTo16(parseInt(raw))
    if (!isNaN(n)) setResolution(n, height)
  }

  const handleCustomH = (raw: string) => {
    setHInput(raw)
    const n = snapTo16(parseInt(raw))
    if (!isNaN(n)) setResolution(width, n)
  }

  const commitW = () => {
    const snapped = snapTo16(parseInt(wInput) || width)
    setResolution(snapped, height)
    setWInput(String(snapped))
  }

  const commitH = () => {
    const snapped = snapTo16(parseInt(hInput) || height)
    setResolution(width, snapped)
    setHInput(String(snapped))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Resolution</p>

      {GROUPS.map(({ key, label }) => {
        const presets = ASPECT_RATIO_PRESETS.filter((p) => p.group === key)
        return (
          <div key={key} className="space-y-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</p>
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => {
                const active = !custom && p.width === width && p.height === height
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => handlePreset(p.width, p.height)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 transition-all min-w-[44px]",
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
            </div>
          </div>
        )
      })}

      {/* Custom */}
      <div className="space-y-1">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Custom</p>
        <button
          type="button"
          onClick={() => { setCustom(true); setWInput(String(width)); setHInput(String(height)) }}
          className={cn(
            "w-full rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-all text-left",
            custom
              ? "border-violet-500 bg-violet-500/10 text-violet-300"
              : "border-zinc-700 bg-zinc-800/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          )}
        >
          {custom ? `${width} × ${height} px` : "Enter custom size…"}
        </button>

        {custom && (
          <div className="flex gap-2 items-end pt-1">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-zinc-500">W (px)</Label>
              <Input
                type="number"
                value={wInput}
                min={256}
                max={2048}
                step={16}
                onChange={(e) => handleCustomW(e.target.value)}
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
                min={256}
                max={2048}
                step={16}
                onChange={(e) => handleCustomH(e.target.value)}
                onBlur={commitH}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7"
              />
            </div>
          </div>
        )}
      </div>

      {/* Active resolution readout */}
      <p className="text-[10px] text-zinc-600 font-mono">
        {width} × {height} px
        {activePreset && <span className="text-zinc-700 ml-1">({activePreset.label})</span>}
      </p>

      {/* Range reminder */}
      <p className="text-[10px] text-zinc-700 leading-relaxed">
        256–2048 px · multiples of 16 · max 6:1 ratio
      </p>
    </div>
  )
}
