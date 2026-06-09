import { useState } from "react"
import { Trash2, ChevronDown, ChevronUp, MapPin, MapPinOff } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { elementColor } from "@/lib/caption"
import { defaultBBoxForIndex } from "@/lib/bbox"
import { ElementTypeBadge } from "./ElementTypeBadge"
import { PaletteEditor } from "@/components/palette/PaletteEditor"
import { usePromptStore } from "@/stores/promptStore"
import type { AnyElement } from "@/types/caption"

interface Props {
  element: AnyElement
  index: number
  onFocus?: () => void
}

export function ElementCard({ element, index, onFocus }: Props) {
  const [expanded, setExpanded] = useState(true)
  const { updateElement, removeElement } = usePromptStore()
  const colors = elementColor(index)

  const hasBBox = !!element.bbox
  const toggleBBox = () => {
    if (hasBBox) {
      updateElement(element.id, { bbox: undefined })
    } else {
      updateElement(element.id, { bbox: defaultBBoxForIndex(index) })
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        colors.border,
        "bg-zinc-900"
      )}
      onClick={onFocus}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn("h-2 w-2 rounded-full shrink-0", colors.border.replace("border-", "bg-"))} />
        <ElementTypeBadge type={element.type} />
        <span className="text-xs text-zinc-400 flex-1 truncate">
          {element.type === "text"
            ? (element.text || "Empty text")
            : (element.desc || "No description").slice(0, 40)}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleBBox() }}
          className={cn(
            "text-zinc-500 hover:text-zinc-300 transition-colors",
            hasBBox && "text-violet-400"
          )}
          title={hasBBox ? "Remove from canvas" : "Add to canvas"}
        >
          {hasBBox ? <MapPin className="h-3.5 w-3.5" /> : <MapPinOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); removeElement(element.id) }}
          className="text-zinc-600 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-zinc-800">
          {/* Text field (text elements only) */}
          {element.type === "text" && (
            <div className="pt-3 space-y-1">
              <Label className="text-xs text-zinc-400">Text to render</Label>
              <Input
                value={element.text}
                onChange={(e) => updateElement(element.id, { text: e.target.value })}
                placeholder="Exact text to appear in the image..."
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
              />
            </div>
          )}

          {/* Description */}
          <div className={cn("space-y-1", element.type === "text" ? "" : "pt-3")}>
            <Label className="text-xs text-zinc-400">
              Description <span className="text-zinc-600">(30–60 words)</span>
            </Label>
            <Textarea
              value={element.desc}
              onChange={(e) => updateElement(element.id, { desc: e.target.value })}
              placeholder={
                element.type === "text"
                  ? "Font style, color, size, placement details..."
                  : "Visual appearance, material, lighting, pose, details..."
              }
              rows={3}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none"
            />
          </div>

          {/* Palette */}
          <PaletteEditor
            colors={element.color_palette}
            maxColors={5}
            label="Element colors"
            onChange={(palette) => updateElement(element.id, { color_palette: palette })}
          />

          {/* BBox info */}
          {hasBBox && element.bbox && (
            <p className="text-[10px] text-zinc-500 font-mono">
              bbox [{element.bbox.ymin}, {element.bbox.xmin}, {element.bbox.ymax}, {element.bbox.xmax}]
            </p>
          )}
        </div>
      )}
    </div>
  )
}
