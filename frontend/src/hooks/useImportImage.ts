import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp"]
const MAX_FILE_MB = 64

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function validateImportFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `Unsupported file type (${file.type || "unknown"}). Use PNG, JPEG, WebP, or BMP.`
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return `File is too large (max ${MAX_FILE_MB} MB).`
  }
  return null
}

/** Upload an external image into the gallery so it can be edited/managed. */
export function useImportImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<EditResponse> => {
      const problem = validateImportFile(file)
      if (problem) throw new Error(problem)
      const image_b64 = await fileToBase64(file)
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64, filename: file.name }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `Import failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gallery"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
