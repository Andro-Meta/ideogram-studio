import { CheckCircle2, AlertTriangle, HardDriveDownload } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { useSystemInfo, variantAssessment } from "@/hooks/useSystemInfo"
import type { ModelVariant } from "@/types/caption"

// VRAM figures follow the official ideogram-oss/ideogram4 guidance:
// nf4 is built for single 24 GB consumer GPUs; fp8 targets A100/H100-class.
const VARIANTS: { value: ModelVariant; label: string; vram: string; desc: string }[] = [
  { value: "nf4",  label: "NF4",  vram: "24 GB GPU",  desc: "RTX 3090/4090" },
  { value: "fp8",  label: "FP8",  vram: "32 GB+ GPU", desc: "A100 / H100" },
  { value: "bf16", label: "BF16", vram: "32 GB+ GPU", desc: "Community" },
]

export function ModelVariantToggle() {
  const { modelVariant, setModelVariant } = useSettingsStore()
  const { data: sys } = useSystemInfo()

  const selected = variantAssessment(sys, modelVariant)
  const blocked = (selected?.blockers.length ?? 0) > 0

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Model</p>
      <div className="grid grid-cols-3 gap-1.5">
        {VARIANTS.map((v) => {
          const a = variantAssessment(sys, v.value)
          const isBlocked = (a?.blockers.length ?? 0) > 0
          const isSelected = modelVariant === v.value
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => setModelVariant(v.value)}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-all",
                isSelected
                  ? isBlocked
                    ? "border-amber-500 bg-amber-500/10 text-amber-300"
                    : "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500",
              )}
            >
              {a?.recommended && (
                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-emerald-500 text-[8px] font-bold text-zinc-950 px-1 leading-3 py-0.5">
                  ★
                </span>
              )}
              <span className="text-xs font-bold flex items-center gap-1">
                {v.label}
                {a?.cached && <HardDriveDownload className="h-2.5 w-2.5 opacity-60" />}
              </span>
              <span className="text-[10px] opacity-70">{v.vram}</span>
              <span className="text-[10px] opacity-50">{v.desc}</span>
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
