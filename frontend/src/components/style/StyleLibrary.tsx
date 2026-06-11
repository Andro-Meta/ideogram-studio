import { Shuffle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { STYLE_PRESETS, STYLE_CATEGORIES, type StylePreset } from "@/lib/stylePresets"
import { PALETTE_MODES } from "@/lib/colorPalettes"
import { usePromptStore } from "@/stores/promptStore"

/**
 * The full style catalog, grouped into Photography / Rendered / Illustrated /
 * Weird & Wonderful. Lives in the settings column; clicking a chip fills the
 * prompt's style fields (mode, aesthetics, lighting, medium, photo/art_style).
 */
export function StyleLibrary() {
  const { style_description, setStyleField, setStyleMode } = usePromptStore()

  const apply = (preset: StylePreset) => {
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

  const surpriseMe = () => {
    const pool = STYLE_PRESETS.filter((p) => p.id !== activePreset?.id)
    const preset = pool[Math.floor(Math.random() * pool.length)] ?? STYLE_PRESETS[0]
    apply(preset)
    const palette = PALETTE_MODES[Math.floor(Math.random() * PALETTE_MODES.length)]
    setStyleField("color_palette", [...palette.colors])
    toast.success(`Style: ${preset.label} · Palette: ${palette.label}`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Style library</p>
        <button
          type="button"
          onClick={surpriseMe}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-violet-300 transition-colors"
          title="Random style + color palette"
        >
          <Shuffle className="h-3 w-3" />
          Random
        </button>
      </div>

      {STYLE_CATEGORIES.map(({ key, label }) => {
        const presets = STYLE_PRESETS.filter((p) => p.category === key)
        if (presets.length === 0) return null
        return (
          <div key={key} className="space-y-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</p>
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => apply(p)}
                  title={p.fields.aesthetics}
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
      })}

      <p className="text-[10px] text-zinc-700 leading-relaxed">
        A preset fills the Style fields in the prompt panel — tweak them
        freely afterwards.
      </p>
    </div>
  )
}
