import { useCallback, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { GalleryItem, GalleryListResponse } from "@/types/gallery"

async function fetchGallery(
  page = 1,
  search = "",
  favoritesOnly = false,
): Promise<GalleryListResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: "24" })
  if (search) params.set("search", search)
  if (favoritesOnly) params.set("favorites", "true")
  const res = await fetch(`/api/gallery?${params}`)
  if (!res.ok) throw new Error("Failed to fetch gallery")
  return res.json()
}

async function setFavorite({ id, favorite }: { id: string; favorite: boolean }): Promise<void> {
  const res = await fetch(`/api/gallery/${id}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  })
  if (!res.ok) throw new Error("Could not update favorite")
}

async function fetchGalleryItem(id: string): Promise<GalleryItem> {
  const res = await fetch(`/api/gallery/${id}`)
  if (!res.ok) throw new Error("Not found")
  return res.json()
}

async function deleteGalleryItem(id: string): Promise<void> {
  const res = await fetch(`/api/gallery/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error("Delete failed")
}

export function useGallery(page = 1, search = "", favoritesOnly = false) {
  return useQuery({
    queryKey: ["gallery", page, search, favoritesOnly],
    queryFn: () => fetchGallery(page, search, favoritesOnly),
    staleTime: 10_000,
    // Keep showing the previous page while the next one loads (no flicker)
    placeholderData: (prev) => prev,
  })
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: setFavorite,
    onSuccess: (_, { favorite }) => {
      qc.invalidateQueries({ queryKey: ["gallery"] })
      qc.invalidateQueries({ queryKey: ["gallery-item"] })
      toast.success(favorite ? "Added to favorites" : "Removed from favorites")
    },
    onError: () => toast.error("Could not update favorite"),
  })
}

export function useGalleryItem(id: string | null) {
  return useQuery({
    queryKey: ["gallery-item", id],
    queryFn: () => fetchGalleryItem(id!),
    enabled: !!id,
  })
}

const UNDO_MS = 5000

/**
 * One-click delete with a 5s Undo. The item vanishes immediately
 * (optimistic), but the real DELETE (which removes the file from disk) is
 * deferred until the undo window passes — so "Undo" truly restores it and an
 * accident is recoverable, while a deliberate delete needs only one click.
 */
export function useDeleteGalleryItem() {
  const qc = useQueryClient()
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const undo = useCallback((id: string) => {
    const t = pending.current.get(id)
    if (t) { clearTimeout(t); pending.current.delete(id) }
    qc.invalidateQueries({ queryKey: ["gallery"] })   // still in the DB → reappears
  }, [qc])

  const remove = useCallback((id: string) => {
    // Optimistically drop it from every cached gallery page.
    qc.setQueriesData<GalleryListResponse>({ queryKey: ["gallery"] }, (old) =>
      old ? { ...old, items: old.items.filter((i) => i.id !== id), total: Math.max(0, old.total - 1) } : old,
    )
    const t = setTimeout(async () => {
      pending.current.delete(id)
      try {
        await deleteGalleryItem(id)
      } catch {
        toast.error("Delete failed")
        qc.invalidateQueries({ queryKey: ["gallery"] })
      }
    }, UNDO_MS)
    pending.current.set(id, t)
    toast("Image deleted", {
      action: { label: "Undo", onClick: () => undo(id) },
      duration: UNDO_MS,
    })
  }, [qc, undo])

  return { remove, undo }
}
