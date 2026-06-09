import { useQuery } from "@tanstack/react-query"
import type { SystemInfoResponse, VariantAssessment } from "@/types/api"
import type { ModelVariant } from "@/types/caption"

async function fetchSystemInfo(): Promise<SystemInfoResponse> {
  const res = await fetch("/api/system")
  if (!res.ok) throw new Error("Could not read system info")
  return res.json()
}

/** Hardware report: GPU/RAM/disk + per-variant fit assessment. */
export function useSystemInfo() {
  return useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function variantAssessment(
  data: SystemInfoResponse | undefined,
  variant: ModelVariant,
): VariantAssessment | undefined {
  return data?.variants.find((v) => v.variant === variant)
}
