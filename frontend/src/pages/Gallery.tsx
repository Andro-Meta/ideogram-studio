import { GalleryGrid } from "@/components/gallery/GalleryGrid"

export function Gallery() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-4 border-b border-zinc-800 flex items-center gap-4">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Gallery</h1>
          <p className="text-xs text-zinc-500">All your generated images</p>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <GalleryGrid />
      </div>
    </div>
  )
}
