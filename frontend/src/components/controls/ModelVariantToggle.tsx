import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import type { ModelVariant } from "@/types/caption"

const VARIANTS: { value: ModelVariant; label: string; vram: string; desc: string }[] = [
  { value: "fp8",  label: "FP8",  vram: "~13 GB", desc: "Faster" },
  { value: "bf16", label: "BF16", vram: "~22 GB", desc: "Highest quality" },
]

export function ModelVariantToggle() {
  const { modelVariant, setModelVariant } = useSettingsStore()

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Model</p>
      <div className="grid grid-cols-2 gap-1.5">
        {VARIANTS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setModelVariant(v.value)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-center transition-all",
              modelVariant === v.value
                ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500"
            )}
          >
            <span className="text-xs font-bold">{v.label}</span>
            <span className="text-[10px] opacity-70">{v.vram}</span>
            <span className="text-[10px] opacity-50">{v.desc}</span>
          </button>
        ))}
      </div>
      {modelVariant === "bf16" && (
        <p className="text-[10px] text-amber-400/80">
          BF16 requires ~22 GB VRAM. Ensure sufficient GPU memory before generating.
        </p>
      )}
    </div>
  )
}
