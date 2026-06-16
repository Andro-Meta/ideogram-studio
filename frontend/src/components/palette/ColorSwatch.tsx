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
    <div className="group relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-6 w-6 rounded-md border transition-all",
          valid ? "border-zinc-600 hover:border-zinc-400" : "border-red-500/60",
          open && "ring-1 ring-violet-500",
        )}
        style={valid ? { backgroundColor: color } : { backgroundColor: "#18181b" }}
        title={color}
      />
      {/* Corner remove — overlaps the chip so there's no hover gap to fall into */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-400"
        title="Remove color"
      >
        <X className="h-2 w-2" />
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
            className="absolute top-7 left-0 z-50"
          />
        </>
      )}
    </div>
  )
}
