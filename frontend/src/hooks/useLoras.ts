import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { LoraApplyRequest, LoraListResponse } from "@/types/api"

async function fetchLoras(): Promise<LoraListResponse> {
  const res = await fetch("/api/loras")
  if (!res.ok) throw new Error("Could not load LoRA list")
  return res.json()
}

async function post<T>(url: string, body: T): Promise<LoraListResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }))
    throw new Error(err.detail ?? "Request failed")
  }
  return res.json()
}

/**
 * LoRA adapter state for the currently loaded model. `supported` is false for
 * fp8/nf4 (no adapter hooks) — the panel hides itself in that case. The list
 * is keyed off the model-status query so it refreshes when the model changes.
 */
export function useLoras(enabled: boolean) {
  return useQuery({
    queryKey: ["loras"],
    queryFn: fetchLoras,
    enabled,
    refetchInterval: 15_000,
  })
}

export function useLoraMutations() {
  const qc = useQueryClient()
  const onData = (data: LoraListResponse) => qc.setQueryData(["loras"], data)

  const apply = useMutation({
    mutationFn: (body: LoraApplyRequest) => post("/api/loras/apply", body),
    onSuccess: (data, vars) => {
      onData(data)
      toast.success(`LoRA applied: ${vars.filename ?? vars.hf_repo}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const setWeight = useMutation({
    mutationFn: (vars: { name: string; weight: number }) => post("/api/loras/weight", vars),
    onSuccess: onData,
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (name: string) => post("/api/loras/remove", { name }),
    onSuccess: (data, name) => {
      onData(data)
      toast.info(`LoRA removed: ${name}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { apply, setWeight, remove }
}
