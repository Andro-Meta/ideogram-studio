import { useEffect } from "react"
import { CheckCircle2, AlertTriangle, HardDriveDownload, Lock, Recycle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { useSystemInfo, variantAssessment } from "@/hooks/useSystemInfo"
import { useFreeGpu } from "@/hooks/useFreeGpu"
import type { ModelVariant } from "@/types/caption"

// VRAM figures follow the official ideogram-oss/ideogram4 guidance:
// nf4/nf4d are built for single 24 GB consumer GPUs; fp8 targets A100/H100.
const VARIANTS: { value: ModelVariant; label: string; vram: string; desc: string }[] = [
  { value: "nf4",  label: "NF4",   vram: "24 GB GPU",  desc: "RTX 3090/4090" },
  { value: "nf4d", label: "NF4·D", vram: "24 GB GPU",  desc: "Live progress" },
  { value: "fp8",  label: "FP8",   vram: "32 GB+ GPU", desc: "A100 / H100" },
  { value: "bf16", label: "BF16",  vram: "40 GB+ GPU", desc: "Community" },
]

export function ModelVariantToggle() {
  const { modelVariant, setModelVariant } = useSettingsStore()
  const { data: sys } = useSystemInfo()
  const freeGpu = useFreeGpu()

  const selected = variantAssessment(sys, modelVariant)
  const blocked = (selected?.blockers.length ?? 0) > 0
  const gpuOccupied = (sys?.gpu_processes.length ?? 0) > 0

  // If a previously-saved selection is blocked on this hardware, move off it
  // automatically so the user can never sit on an unusable variant.
  useEffect(() => {
    if (!sys || !blocked) return
    const fallback = sys.recommended_variant
    if (fallback && fallback !== modelVariant) {
      setModelVariant(fallback)
      toast.info(
        `${modelVariant.toUpperCase()} can't run on this machine — switched to ${fallback.toUpperCase()}.`
      )
    }
  }, [sys, blocked, modelVariant, setModelVariant])

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Model</p>
      <div className="grid grid-cols-2 gap-1.5">
        {VARIANTS.map((v) => {
          const a = variantAssessment(sys, v.value)
          // Only hard-block once system info has loaded — never on first paint.
          const isBlocked = sys != null && (a?.blockers.length ?? 0) > 0
          const isSelected = modelVariant === v.value
          return (
            <button
              key={v.value}
              type="button"
              disabled={isBlocked}
              title={isBlocked ? a!.blockers[0] : a?.requirements.label}
              onClick={() => !isBlocked && setModelVariant(v.value)}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-all",
                isBlocked
                  ? "border-zinc-800 bg-zinc-900/60 text-zinc-600 cursor-not-allowed opacity-60"
                  : isSelected
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500",
              )}
            >
              {a?.recommended && !isBlocked && (
                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-emerald-500 text-[8px] font-bold text-zinc-950 px-1 leading-3 py-0.5">
                  ★
                </span>
              )}
              <span className="text-xs font-bold flex items-center gap-1">
                {isBlocked && <Lock className="h-2.5 w-2.5" />}
                {v.label}
                {a?.cached && !isBlocked && <HardDriveDownload className="h-2.5 w-2.5 opacity-60" />}
              </span>
              <span className="text-[10px] opacity-70">{v.vram}</span>
              <span className="text-[10px] opacity-50">{isBlocked ? "Not enough hardware" : v.desc}</span>
            </button>
          )
        })}
      </div>

      {sys?.recommended_variant && (
        <p className="text-[10px] text-zinc-500 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/70 shrink-0" />
          {sys.gpu_name
            ? `${sys.gpu_name} detected — ${sys.recommended_variant.toUpperCase()} recommended`
            : `${sys.recommended_variant.toUpperCase()} recommended for this machine`}
        </p>
      )}

      {blocked && (
        <div className="space-y-1">
          {selected!.blockers.map((b, i) => (
            <p key={i} className="text-[10px] text-amber-400/90 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
              {b}
            </p>
          ))}
        </div>
      )}

      {gpuOccupied && (
        <button
          type="button"
          onClick={() => freeGpu.mutate()}
          disabled={freeGpu.isPending}
          className="w-full flex items-center justify-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] py-1.5 transition-colors disabled:opacity-50"
          title={`Unload other apps' models from the GPU (${sys!.gpu_processes.join(", ")}). Their servers keep running.`}
        >
          {freeGpu.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Recycle className="h-3 w-3" />}
          Free GPU memory ({sys!.gpu_processes.join(", ")})
        </button>
      )}

      {!blocked && (selected?.warnings.length ?? 0) > 0 && (
        <div className="space-y-1">
          {selected!.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-yellow-500/70 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
              {w}
            </p>
          ))}
        </div>
      )}

      {!blocked && selected?.requirements.label && (
        <p className="text-[10px] text-zinc-600">{selected.requirements.label}</p>
      )}
    </div>
  )
}
