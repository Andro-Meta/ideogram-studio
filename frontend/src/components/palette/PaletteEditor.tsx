import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { ColorSwatch } from "./ColorSwatch"

interface PaletteEditorProps {
  colors: string[]
  maxColors: number
  onChange: (colors: string[]) => void
  label?: string
  className?: string
}

export function PaletteEditor({ colors, maxColors, onChange, label, className }: PaletteEditorProps) {
  const addColor = () => {
    if (colors.length >= maxColors) return
    // Pick a random pleasant color to start with
    const defaults = ["#6366F1", "#06B6D4", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"]
    const next = defaults[colors.length % defaults.length]
    onChange([...colors, next])
  }

  const removeColor = (i: number) => {
    onChange(colors.filter((_, idx) => idx !== i))
  }

  const updateColor = (i: number, hex: string) => {
    onChange(colors.map((c, idx) => (idx === i ? hex : c)))
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <p className="text-xs text-zinc-400">
          {label} <span className="text-zinc-600">({colors.length}/{maxColors})</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2 items-center">
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
            className={cn(
              "h-7 w-7 rounded border border-dashed border-zinc-600 hover:border-violet-500",
              "flex items-center justify-center text-zinc-500 hover:text-violet-400 transition-colors"
            )}
            title="Add color"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
