import { cn } from "@/lib/utils"
import { STYLE_PRESETS } from "@/lib/stylePresets"
import { usePromptStore } from "@/stores/promptStore"

export function StylePresets() {
  const { style_description, setStyleField, setStyleMode } = usePromptStore()

  const apply = (presetId: string) => {
    const preset = STYLE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setStyleMode(preset.mode)
    for (const key of Object.keys(preset.fields) as Array<keyof typeof preset.fields>) {
      const value = preset.fields[key]
      if (value !== undefined) setStyleField(key, value)
    }
  }

  const activePreset = STYLE_PRESETS.find((p) => {
    if (p.mode !== style_description.mode) return false
    return Object.entries(p.fields).every(
      ([k, v]) => style_description[k as keyof typeof style_description] === v
    )
  })

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Quick presets</p>
      <div className="flex flex-wrap gap-1">
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => apply(p.id)}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded border transition-all",
              activePreset?.id === p.id
                ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
