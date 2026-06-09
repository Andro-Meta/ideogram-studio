import { useState } from "react"
import { Trash2, Clock, Hash } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GalleryItem } from "@/types/gallery"

interface Props {
  item: GalleryItem
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

export function GalleryCard({ item, onOpen, onDelete }: Props) {
  const [hovered, setHovered] = useState(false)
  const imageUrl = item.image_path ? `/outputs/${item.image_path}` : null
  const durationSec = item.duration_ms ? (item.duration_ms / 1000).toFixed(1) : null
  const preset = item.sampler_preset?.replace("V4_", "").replace("_", " ") ?? null

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden bg-zinc-800 border cursor-pointer transition-all group",
        hovered ? "border-violet-500 shadow-lg shadow-violet-500/10" : "border-zinc-700"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(item.id)}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-zinc-900">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Generated image"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
            No image
          </div>
        )}
      </div>

      {/* Metadata bar */}
      <div className="px-2 py-1.5 flex items-center gap-2 text-[10px] text-zinc-500">
        {durationSec && (
          <span className="flex items-center gap-0.5">
            <Clock className="h-3 w-3" />
            {durationSec}s
          </span>
        )}
        {item.seed != null && (
          <span className="flex items-center gap-0.5 font-mono">
            <Hash className="h-3 w-3" />
            {item.seed}
          </span>
        )}
        {preset && <span className="ml-auto">{preset}</span>}
      </div>

      {/* Delete overlay button */}
      <button
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-red-500/80 text-white rounded p-1"
        onClick={(e) => { e.stopPropagation(); onDelete(item.id) }}
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* Model variant badge */}
      {item.model_variant && (
        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded font-mono">
          {item.model_variant.toUpperCase()}
        </div>
      )}
    </div>
  )
}
