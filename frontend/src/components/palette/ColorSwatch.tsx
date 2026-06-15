import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { HexInput } from "./HexInput"
import { isValidHex } from "@/lib/caption"
import { SWATCHES } from "@/lib/colorPalettes"

interface ColorSwatchProps {
  color: string
  onRemove: () => void
  onChange: (hex: string) => void
}

export function ColorSwatch({ color, onRemove, onChange }: ColorSwatchProps) {
  const [open, setOpen] = useState(false)
  const valid = isValidHex(color)
  // The native colour input needs a valid #rrggbb; fall back to black.
  const wheelValue = valid ? color : "#000000"

  return (
    <div className="group relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-7 w-12 rounded border transition-all",
          valid ? "border-zinc-600 hover:border-zinc-400" : "border-red-500/60",
          open && "ring-1 ring-violet-500",
        )}
        style={valid ? { backgroundColor: color } : { backgroundColor: "#18181b" }}
        title={color}
      />
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-200"
        title="Remove color"
      >
        <X className="h-3 w-3" />
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <button
            type="button"
            aria-label="Close color picker"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-9 left-0 z-50 w-[280px] rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-xl space-y-2.5">
            {/* Wheel + hex */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={wheelValue}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-zinc-700 bg-transparent p-0.5"
                title="Color wheel — pick any color"
                aria-label="Color wheel"
              />
              <HexInput value={color} onChange={onChange} className="w-28" />
              <span className="text-[10px] text-zinc-500 leading-tight">
                Wheel for any shade,<br />or tap a swatch below.
              </span>
            </div>

            {/* Quick swatch grid */}
            <div className="grid grid-cols-12 gap-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false) }}
                  title={c}
                  className={cn(
                    "h-4 w-4 rounded-sm border transition-transform hover:scale-110",
                    c.toUpperCase() === color.toUpperCase()
                      ? "border-white ring-1 ring-violet-400"
                      : "border-black/20",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
