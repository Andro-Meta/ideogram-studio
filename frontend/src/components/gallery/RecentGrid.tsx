import { useState } from "react"
import { Link } from "react-router-dom"
import { Images, Brush, Trash2 } from "lucide-react"
import { useGallery, useDeleteGalleryItem } from "@/hooks/useGallery"
import { useReusePrompt } from "@/hooks/useReusePrompt"
import { Lightbox } from "@/components/lightbox/Lightbox"
import type { GalleryItem } from "@/types/gallery"

function itemUrl(item: GalleryItem): string {
  return `/outputs/${item.image_path!.split("/").pop()}`
}

/**
 * Fills the Generate page's center with your recent generations instead of
 * empty space. Click a thumbnail to inspect it in the lightbox; hover for a
 * quick jump into the editor.
 */
export function RecentGrid() {
  const { data } = useGallery(1)
  const del = useDeleteGalleryItem()
  const reuse = useReusePrompt()
  const [viewing, setViewing] = useState<GalleryItem | null>(null)

  const items = (data?.items ?? []).filter((i) => i.image_path)

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-700 py-10">
        <Images className="h-8 w-8" />
        <p className="text-xs">Your generations will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
          Recent generations
        </p>
        <Link to="/gallery" className="text-[11px] text-zinc-500 hover:text-violet-300 transition-colors">
          Open gallery →
        </Link>
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {items.map((item) => (
          <div key={item.id} className="group relative aspect-square rounded-lg overflow-hidden border border-zinc-800 hover:border-violet-500/60 transition-all">
            <button
              type="button"
              onClick={() => setViewing(item)}
              className="absolute inset-0"
              title={item.prompt_text ?? "View"}
            >
              <img
                src={itemUrl(item)}
                alt={item.prompt_text ?? ""}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                draggable={false}
              />
              <span className="absolute inset-0 bg-zinc-950/0 group-hover:bg-zinc-950/25 transition-colors" />
            </button>
            <Link
              to={`/editor?job=${item.id}`}
              onClick={(e) => e.stopPropagation()}
              title="Open in Editor"
              className="absolute bottom-1.5 right-1.5 p-1.5 rounded-md bg-zinc-900/85 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity"
            >
              <Brush className="h-3.5 w-3.5" />
            </Link>
            {/* Delete — one click, with a 5s Undo toast */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); del.remove(item.id) }}
              title="Delete (Undo available for 5s)"
              className="absolute top-1.5 right-1.5 p-1.5 rounded-md transition-all text-white opacity-0 group-hover:opacity-100 bg-zinc-900/85 hover:bg-red-500/80"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {item.seed != null && (
              <span className="absolute bottom-1.5 left-1.5 text-[9px] font-mono text-zinc-300 bg-zinc-900/85 rounded px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                #{item.seed}
              </span>
            )}
          </div>
        ))}
      </div>

      {viewing && (() => {
        const idx = items.findIndex((i) => i.id === viewing.id)
        const at = (n: number) => setViewing(items[(n + items.length) % items.length])
        return (
          <Lightbox
            open
            onClose={() => setViewing(null)}
            imageUrl={itemUrl(viewing)}
            downloadName={`ideogram-${viewing.seed ?? viewing.id.slice(0, 8)}.png`}
            editJobId={viewing.id}
            onReuse={viewing.prompt_json ? () => { reuse(viewing); setViewing(null) } : undefined}
            position={idx + 1}
            count={items.length}
            onPrev={items.length > 1 ? () => at(idx - 1) : undefined}
            onNext={items.length > 1 ? () => at(idx + 1) : undefined}
            caption={[
              viewing.seed != null ? `seed ${viewing.seed}` : null,
              viewing.width && viewing.height ? `${viewing.width}×${viewing.height}` : null,
            ].filter(Boolean).join(" · ")}
          />
        )
      })()}
    </div>
  )
}
