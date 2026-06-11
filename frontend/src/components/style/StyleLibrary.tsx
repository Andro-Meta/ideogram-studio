import { useState } from "react"
import { ChevronDown, ChevronRight, Shuffle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { STYLE_PRESETS, STYLE_CATEGORIES, type StylePreset } from "@/lib/stylePresets"
import { PALETTE_MODES } from "@/lib/colorPalettes"
import { usePromptStore } from "@/stores/promptStore"

/**
 * The full style catalog, grouped into Photography / Rendered / Illustrated /
 * Weird & Wonderful. Lives at the top of the Style section in the prompt
 * column; categories collapse so the section stays compact. Clicking a chip
 * fills the style fields (mode, aesthetics, lighting, medium, photo/art_style).
 */
export function StyleLibrary() {
  const { style_description, setStyleField, setStyleMode } = usePromptStore()
  const [open, setOpen] = useState<Record<string, boolean>>({ photography: true })

  const apply = (preset: StylePreset) => {
    setStyleMode(preset.mode)
    for (const key of Object.keys(preset.fields) as Array<keyof typeof preset.fields>) {
      const value = preset.fields[key]
      if (value !== undefined) setStyleField(key, value)
    }
    // Clear the opposite mode's field so the caption (and the unified form's
    // mode indicator) stays unambiguous.
    if (preset.mode === "photo") setStyleField("art_style", "")
    else setStyleField("photo", "")
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Presets</p>
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
        const isOpen = !!open[key]
        const activeInCategory = presets.find((p) => p.id === activePreset?.id)
        return (
          <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/30">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
            >
              {isOpen
                ? <ChevronDown className="h-3 w-3 text-zinc-600" />
                : <ChevronRight className="h-3 w-3 text-zinc-600" />}
              <span className="text-[10px] text-zinc-400 uppercase tracking-widest">{label}</span>
              <span className="ml-auto text-[10px] text-zinc-700">
                {activeInCategory && !isOpen ? (
                  <span className="text-violet-400">{activeInCategory.label}</span>
                ) : (
                  presets.length
                )}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-wrap gap-1 px-2 pb-2">
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
            )}
          </div>
        )
      })}
    </div>
  )
}
