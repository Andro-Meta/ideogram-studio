import { useState } from "react"
import {
  ChevronDown, ChevronRight, Dices, FlaskConical, Loader2, Shuffle, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  STYLE_PRESETS, STYLE_CATEGORIES, mashupStyles, type StylePreset,
} from "@/lib/stylePresets"
import { PALETTE_MODES } from "@/lib/colorPalettes"
import { usePromptStore } from "@/stores/promptStore"
import { useFuseStyles } from "@/hooks/useFuseStyles"
import type { StyleFuseSide } from "@/types/api"

/**
 * The full style catalog, grouped into Photography / Rendered / Illustrated /
 * Weird & Wonderful. Lives at the top of the Style section in the prompt
 * column; categories collapse so the section stays compact. Clicking a chip
 * fills the style fields (mode, aesthetics, lighting, medium, photo/art_style).
 */
export function StyleLibrary() {
  const { style_description, setStyleField, setStyleMode } = usePromptStore()
  const [open, setOpen] = useState<Record<string, boolean>>({ photography: true })
  // One object (not two states) so taps update atomically — two taps in the
  // same React batch can't both land on Form. setMash always uses a functional
  // updater, which React applies in sequence even within a single batch.
  const [mash, setMash] = useState<{ form: string; mood: string }>({ form: "", mood: "" })
  // Pick mode: tapping presets fills the Form/Mood slots instead of applying.
  const [pickMode, setPickMode] = useState(false)

  // Which mash-up slot a preset currently occupies (for chip highlighting).
  const pickRole = (id: string): "form" | "mood" | null =>
    mash.form === id ? "form" : mash.mood === id ? "mood" : null

  // Tap a preset while picking: 1st → Form, 2nd → Mood. Tapping a picked one
  // clears it. With both full, a new tap swaps the Mood (Form stays put, so you
  // can lock a technique and try different moods) — and we surface that so it's
  // never a silent change.
  const togglePick = (p: StylePreset) => {
    if (mash.form && mash.mood && mash.form !== p.id && mash.mood !== p.id) {
      toast.info(`Mood → ${p.label} (tap it again to undo)`)
    }
    setMash((prev) => {
      if (prev.form === p.id) return { ...prev, form: "" }
      if (prev.mood === p.id) return { ...prev, mood: "" }
      if (!prev.form) return { ...prev, form: p.id }
      return { ...prev, mood: p.id }   // fills empty Mood, or swaps a full one
    })
  }

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

  // ── Mash-up: FORM (technique) × MOOD (feel) ─────────────────────────────
  const applyMashup = (form: StylePreset, mood: StylePreset) => {
    const { mode, fields } = mashupStyles(form, mood)
    setStyleMode(mode)
    setStyleField("aesthetics", fields.aesthetics ?? "")
    setStyleField("lighting", fields.lighting ?? "")
    setStyleField("medium", fields.medium ?? "")
    if (mode === "photo") {
      setStyleField("photo", fields.photo ?? "")
      setStyleField("art_style", "")
    } else {
      setStyleField("art_style", fields.art_style ?? "")
      setStyleField("photo", "")
    }
    toast.success(`Mash-up: ${form.label} × ${mood.label}`)
  }

  const handleMashup = () => {
    const form = STYLE_PRESETS.find((p) => p.id === mash.form)
    const mood = STYLE_PRESETS.find((p) => p.id === mash.mood)
    if (!form || !mood) return
    applyMashup(form, mood)
  }

  const randomMashup = () => {
    const form = STYLE_PRESETS[Math.floor(Math.random() * STYLE_PRESETS.length)]
    let mood = form
    while (mood.id === form.id) {
      mood = STYLE_PRESETS[Math.floor(Math.random() * STYLE_PRESETS.length)]
    }
    setMash({ form: form.id, mood: mood.id })
    applyMashup(form, mood)
  }

  // ── AI Fuse: the LLM invents one hybrid style (slower, smarter than Mix) ──
  const fuse = useFuseStyles()

  const toFuseSide = (p: StylePreset): StyleFuseSide => ({
    label: p.label,
    mode: p.mode,
    aesthetics: p.fields.aesthetics ?? "",
    lighting: p.fields.lighting ?? "",
    medium: p.fields.medium ?? "",
    photo: p.fields.photo ?? "",
    art_style: p.fields.art_style ?? "",
  })

  const handleAiFuse = () => {
    const form = STYLE_PRESETS.find((p) => p.id === mash.form)
    const mood = STYLE_PRESETS.find((p) => p.id === mash.mood)
    if (!form || !mood || fuse.isPending) return
    toast.info(`AI Fuse: blending ${form.label} × ${mood.label}… (~20s)`)
    fuse.mutate(
      { form: toFuseSide(form), mood: toFuseSide(mood) },
      {
        onSuccess: (fused) => {
          setStyleMode(fused.mode)
          setStyleField("aesthetics", fused.aesthetics)
          setStyleField("lighting", fused.lighting)
          setStyleField("medium", fused.medium)
          if (fused.mode === "photo") {
            setStyleField("photo", fused.photo)
            setStyleField("art_style", "")
          } else {
            setStyleField("art_style", fused.art_style)
            setStyleField("photo", "")
          }
          toast.success(`AI Fuse: ${form.label} × ${mood.label}`)
        },
      },
    )
  }

  const formPreset = STYLE_PRESETS.find((p) => p.id === mash.form)
  const moodPreset = STYLE_PRESETS.find((p) => p.id === mash.mood)

  // A read-only slot pill: shows the picked Form/Mood, clearable with ×.
  const slot = (
    role: "Form" | "Mood",
    preset: StylePreset | undefined,
    onClear: () => void,
    accent: string,
  ) => (
    <div
      className={cn(
        "flex-1 min-w-0 h-6 rounded border px-1.5 flex items-center gap-1 text-[10px]",
        preset ? accent : "border-zinc-700 text-zinc-600 border-dashed",
      )}
    >
      <span className="opacity-50 shrink-0">{role}</span>
      <span className="truncate flex-1">
        {preset?.label ?? (pickMode ? "tap a preset" : "—")}
      </span>
      {preset && (
        <button type="button" onClick={onClear} className="shrink-0 opacity-60 hover:opacity-100">×</button>
      )}
    </div>
  )

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

      {/* Mash-up lab: technique from one style, feel from another. Works
          because the caption fields are orthogonal — medium/art_style say
          HOW it's made, aesthetics/lighting say how it FEELS. */}
      <div className={cn(
        "rounded-lg border px-2 py-1.5 space-y-1.5 transition-colors",
        pickMode ? "border-violet-500/60 bg-violet-500/[0.07]" : "border-violet-900/40 bg-violet-500/[0.04]",
      )}>
        <div className="flex items-center gap-1.5">
          <FlaskConical className="h-3 w-3 text-violet-400/70" />
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest">Mash-up</span>
          <button
            type="button"
            onClick={() => setPickMode((v) => !v)}
            title="Tap two presets to pick Form + Mood"
            className={cn(
              "ml-auto text-[10px] px-1.5 h-5 rounded border transition-colors",
              pickMode
                ? "border-violet-500/70 text-violet-200 bg-violet-500/15"
                : "border-zinc-700 text-zinc-400 hover:border-violet-600/60 hover:text-violet-300",
            )}
          >
            {pickMode ? "Picking…" : "Tap to pick"}
          </button>
          <button
            type="button"
            onClick={() => { setPickMode(true); randomMashup() }}
            title="Random form × random mood"
            className="text-zinc-500 hover:text-violet-300 transition-colors"
          >
            <Dices className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Form × Mood slots — filled by tapping presets in pick mode */}
        <div className="flex items-center gap-1.5">
          {slot("Form", formPreset, () => setMash((m) => ({ ...m, form: "" })),
            "border-violet-500/60 text-violet-200 bg-violet-500/10")}
          <span className="text-[10px] text-zinc-600 shrink-0">×</span>
          {slot("Mood", moodPreset, () => setMash((m) => ({ ...m, mood: "" })),
            "border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-500/10")}
        </div>

        <div className="flex items-center gap-1.5">
          {pickMode && (
            <span className="text-[10px] text-zinc-500 flex-1">
              {!mash.form ? "Tap a preset → Form" : !mash.mood ? "Tap another → Mood" : "Ready — Mix or Fuse"}
            </span>
          )}
          <button
            type="button"
            onClick={handleMashup}
            disabled={!mash.form || !mash.mood}
            className="shrink-0 text-[10px] px-2.5 h-6 rounded border border-violet-700/60 text-violet-300 hover:bg-violet-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Mix
          </button>
          <button
            type="button"
            onClick={handleAiFuse}
            disabled={!mash.form || !mash.mood || fuse.isPending}
            title="AI Fuse — an LLM invents one hybrid style (slower, smarter than Mix)"
            className="shrink-0 flex items-center gap-1 text-[10px] px-2.5 h-6 rounded border border-fuchsia-700/60 text-fuchsia-300 hover:bg-fuchsia-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {fuse.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Sparkles className="h-3 w-3" />}
            Fuse
          </button>
        </div>
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
                {presets.map((p) => {
                  const role = pickMode ? pickRole(p.id) : null
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => (pickMode ? togglePick(p) : apply(p))}
                      title={pickMode ? `Pick "${p.label}" for the mash-up` : p.fields.aesthetics}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded border transition-all flex items-center gap-1",
                        role === "form"
                          ? "border-violet-500/70 text-violet-200 bg-violet-500/15"
                          : role === "mood"
                            ? "border-fuchsia-500/70 text-fuchsia-200 bg-fuchsia-500/15"
                            : !pickMode && activePreset?.id === p.id
                              ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                              : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      {role && (
                        <span className={cn(
                          "inline-flex items-center justify-center h-3 w-3 rounded-full text-[8px] font-bold",
                          role === "form" ? "bg-violet-500/40 text-violet-100" : "bg-fuchsia-500/40 text-fuchsia-100",
                        )}>
                          {role === "form" ? "1" : "2"}
                        </span>
                      )}
                      {p.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
