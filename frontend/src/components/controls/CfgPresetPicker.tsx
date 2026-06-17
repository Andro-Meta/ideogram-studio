import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { CFG_PRESETS } from "@/lib/cfgPresets"

/** Row of CFG preset chips, shared by the generation settings and the image
 *  editor. Reads/writes the one shared CFG setting in the store. */
export function CfgPresetPicker({ className }: { className?: string }) {
  const cfgPreset = useSettingsStore((s) => s.cfgPreset)
  const setCfgPreset = useSettingsStore((s) => s.setCfgPreset)

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {CFG_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setCfgPreset(p.id)}
          title={p.hint}
          className={cn(
            "rounded-md border px-1.5 py-1 text-[10px] font-medium transition-all",
            cfgPreset === p.id
              ? "border-violet-500 bg-violet-500/10 text-violet-300"
              : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
