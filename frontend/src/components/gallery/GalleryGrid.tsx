import { useState } from "react"
import { ImageOff, Loader2 } from "lucide-react"
import { GalleryCard } from "./GalleryCard"
import { GalleryDetail } from "./GalleryDetail"
import { useGallery, useDeleteGalleryItem } from "@/hooks/useGallery"
import { Button } from "@/components/ui/button"

export function GalleryGrid() {
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading, isError } = useGallery(page)
  const deleteMutation = useDeleteGalleryItem()

  const PER_PAGE = 24
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        Failed to load gallery. Is the server running?
      </div>
    )
  }

  const items = data?.items ?? []

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
        <ImageOff className="h-10 w-10" />
        <p className="text-sm">No images yet — generate your first!</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
        {items.map((item) => (
          <GalleryCard
            key={item.id}
            item={item}
            onOpen={setSelectedId}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          >
            Previous
          </Button>
          <span className="text-sm text-zinc-500">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          >
            Next
          </Button>
        </div>
      )}

      {/* Detail modal */}
      <GalleryDetail
        itemId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  )
}
