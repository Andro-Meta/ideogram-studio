import { cn } from "@/lib/utils"
import { PRESET_LABELS } from "@/lib/caption"
import { useSettingsStore } from "@/stores/settingsStore"
import type { SamplerPreset } from "@/types/caption"

const PRESETS: SamplerPreset[] = ["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"]

export function SamplerPresetPicker() {
  const { samplerPreset, setSamplerPreset } = useSettingsStore()

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Quality</p>
      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map((preset) => {
          const label = PRESET_LABELS[preset]
          const active = samplerPreset === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() => setSamplerPreset(preset)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition-all",
                active
                  ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
              )}
            >
              <span className="text-xs font-semibold">{label.name}</span>
              <span className="text-[10px] opacity-70">{label.steps}</span>
              <span className="text-[10px] opacity-50">{label.time}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
