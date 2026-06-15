import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { isValidHex } from "@/lib/caption"
import { ColorPicker } from "./ColorPicker"

interface ColorSwatchProps {
  color: string
  onRemove: () => void
  onChange: (hex: string) => void
}

export function ColorSwatch({ color, onRemove, onChange }: ColorSwatchProps) {
  const [open, setOpen] = useState(false)
  const valid = isValidHex(color)

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
          <ColorPicker
            value={color}
            onPick={onChange}
            onClose={() => setOpen(false)}
            className="absolute top-9 left-0 z-50"
          />
        </>
      )}
    </div>
  )
}
