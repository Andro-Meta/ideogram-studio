import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { GalleryItem, GalleryListResponse } from "@/types/gallery"

async function fetchGallery(page = 1): Promise<GalleryListResponse> {
  const res = await fetch(`/api/gallery?page=${page}&per_page=24`)
  if (!res.ok) throw new Error("Failed to fetch gallery")
  return res.json()
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

export function useGallery(page = 1) {
  return useQuery({
    queryKey: ["gallery", page],
    queryFn: () => fetchGallery(page),
    staleTime: 10_000,
  })
}

export function useGalleryItem(id: string | null) {
  return useQuery({
    queryKey: ["gallery-item", id],
    queryFn: () => fetchGalleryItem(id!),
    enabled: !!id,
  })
}

export function useDeleteGalleryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteGalleryItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery"] })
      toast.success("Deleted")
    },
    onError: () => toast.error("Delete failed"),
  })
}
