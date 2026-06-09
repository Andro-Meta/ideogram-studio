import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { SettingsResponse, SettingsUpdateRequest } from "@/types/api"

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings")
  if (!res.ok) throw new Error("Failed to fetch settings")
  return res.json()
}

async function updateSettings(body: SettingsUpdateRequest): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Update failed" }))
    throw new Error(err.detail ?? "Settings update failed")
  }
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] })
      toast.success("Settings saved")
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
