import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { HexInput } from "./HexInput"
import { isValidHex } from "@/lib/caption"

interface ColorSwatchProps {
  color: string
  onRemove: () => void
  onChange: (hex: string) => void
}

export function ColorSwatch({ color, onRemove, onChange }: ColorSwatchProps) {
  const [editing, setEditing] = useState(false)
  const valid = isValidHex(color)

  return (
    <div className="group relative flex items-center gap-1">
      {editing ? (
        <HexInput
          value={color}
          onChange={(hex) => { onChange(hex); setEditing(false) }}
          className="w-24"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "h-7 w-12 rounded border transition-all",
            valid ? "border-zinc-600 hover:border-zinc-400" : "border-red-500/60",
          )}
          style={valid ? { backgroundColor: color } : { backgroundColor: "#18181b" }}
          title={color}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-200"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
