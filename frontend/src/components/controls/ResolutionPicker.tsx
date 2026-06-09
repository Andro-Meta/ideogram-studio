import { useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ASPECT_RATIO_PRESETS, snapTo16 } from "@/lib/caption"
import { useSettingsStore } from "@/stores/settingsStore"

export function ResolutionPicker() {
  const { width, height, setResolution } = useSettingsStore()
  const [custom, setCustom] = useState(false)

  const currentLabel = ASPECT_RATIO_PRESETS.find(
    (p) => p.width === width && p.height === height
  )?.label

  const handlePreset = (w: number, h: number) => {
    setCustom(false)
    setResolution(w, h)
  }

  const handleW = (v: string) => {
    const n = snapTo16(parseInt(v) || width)
    setResolution(n, height)
  }

  const handleH = (v: string) => {
    const n = snapTo16(parseInt(v) || height)
    setResolution(width, n)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Resolution</p>

      <div className="flex flex-wrap gap-1.5">
        {ASPECT_RATIO_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => handlePreset(p.width, p.height)}
            className={cn(
              "px-2 py-1 rounded text-xs border transition-all",
              !custom && currentLabel === p.label
                ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(true)}
          className={cn(
            "px-2 py-1 rounded text-xs border transition-all",
            custom
              ? "border-violet-500 bg-violet-500/10 text-violet-300"
              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
          )}
        >
          Custom
        </button>
      </div>

      {custom && (
        <div className="flex gap-2 items-center">
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] text-zinc-500">Width</Label>
            <Input
              type="number"
              value={width}
              min={256}
              max={2048}
              step={16}
              onBlur={(e) => handleW(e.target.value)}
              onChange={(e) => setResolution(parseInt(e.target.value) || width, height)}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7"
            />
          </div>
          <span className="text-zinc-600 text-xs mt-4">×</span>
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] text-zinc-500">Height</Label>
            <Input
              type="number"
              value={height}
              min={256}
              max={2048}
              step={16}
              onBlur={(e) => handleH(e.target.value)}
              onChange={(e) => setResolution(width, parseInt(e.target.value) || height)}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7"
            />
          </div>
        </div>
      )}

      {!custom && (
        <p className="text-[10px] text-zinc-500">{width} × {height} px</p>
      )}
    </div>
  )
}
