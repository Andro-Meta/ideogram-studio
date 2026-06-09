import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EditRequest, EditResponse } from "@/types/api"

async function editImage(req: EditRequest): Promise<EditResponse> {
  const res = await fetch("/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Edit failed" }))
    throw new Error(err.detail)
  }
  return res.json()
}

export function useEditImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: editImage,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery"] })
      toast.success("Edited copy saved to gallery")
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
