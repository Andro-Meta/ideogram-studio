import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditResponse } from "@/types/api"

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // chunked conversion — String.fromCharCode(...bytes) overflows the stack on
  // multi-MB images
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Upload a flattened editor result; saved as a new derived gallery item. */
export function useSaveEdit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { sourceJobId: string; blob: Blob }): Promise<EditResponse> => {
      const image_b64 = await blobToBase64(args.blob)
      const res = await fetch("/api/edit/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_job_id: args.sourceJobId, image_b64 }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `Save failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gallery"] })
      toast.success("Edit saved as a new gallery copy")
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
