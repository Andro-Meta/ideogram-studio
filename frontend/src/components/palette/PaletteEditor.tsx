import { useState } from "react"
import { Plus, Palette, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { PALETTE_MODES } from "@/lib/colorPalettes"
import { ColorSwatch } from "./ColorSwatch"

interface PaletteEditorProps {
  colors: string[]
  maxColors: number
  onChange: (colors: string[]) => void
  label?: string
  className?: string
}

export function PaletteEditor({ colors, maxColors, onChange, label, className }: PaletteEditorProps) {
  const [showPresets, setShowPresets] = useState(false)

  const addColor = () => {
    if (colors.length >= maxColors) return
    const defaults = ["#6366F1", "#06B6D4", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"]
    const next = defaults[colors.length % defaults.length]
    onChange([...colors, next])
  }

  const applyPreset = (presetColors: string[]) => {
    onChange(presetColors.slice(0, maxColors))
    setShowPresets(false)
  }

  const removeColor = (i: number) => onChange(colors.filter((_, idx) => idx !== i))
  const updateColor = (i: number, hex: string) =>
    onChange(colors.map((c, idx) => (idx === i ? hex : c)))

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <p className="text-xs text-zinc-400">
          {label} <span className="text-zinc-600">({colors.length}/{maxColors})</span>
        </p>
      )}

      {/* Swatches + the presets disclosure, all on one compact row */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {colors.map((color, i) => (
          <ColorSwatch
            key={i}
            color={color}
            onChange={(hex) => updateColor(i, hex)}
            onRemove={() => removeColor(i)}
          />
        ))}
        {colors.length < maxColors && (
          <button
            type="button"
            onClick={addColor}
            className="h-6 w-6 rounded-md border border-dashed border-zinc-600 hover:border-violet-500 flex items-center justify-center text-zinc-500 hover:text-violet-400 transition-colors"
            title="Add color"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Presets are tucked behind a disclosure so the 40 combinations don't
            clutter the row until you want them. */}
        <button
          type="button"
          onClick={() => setShowPresets((v) => !v)}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 h-6 text-[10px] transition-colors",
            showPresets
              ? "border-violet-500/60 text-violet-300"
              : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500",
          )}
          title="Apply a preset palette"
        >
          <Palette className="h-3 w-3" />
          Palettes
          <ChevronDown className={cn("h-3 w-3 transition-transform", showPresets && "rotate-180")} />
        </button>
      </div>

      {/* Preset palettes — only when opened */}
      {showPresets && (
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-1.5">
          {PALETTE_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => applyPreset(mode.colors)}
              title={`${mode.label} — apply`}
              className="flex items-center gap-0.5 rounded border border-zinc-700 px-1.5 py-0.5 hover:border-violet-500 transition-colors"
            >
              <span className="text-[9px] text-zinc-500 mr-0.5">{mode.label}</span>
              {mode.colors.map((c) => (
                <span
                  key={c}
                  className="h-2.5 w-2.5 rounded-sm inline-block shrink-0"
                  style={{ backgroundColor: c }}
                />
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
