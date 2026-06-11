import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { PaletteEditor } from "@/components/palette/PaletteEditor"
import { usePromptStore } from "@/stores/promptStore"
import { cn } from "@/lib/utils"

/**
 * Unified style fields — replaces the Photo/Illustration tab pair.
 * The caption's `mode` is derived instead of asked for: presets set it, and
 * typing in "Photo / Camera" vs "Art Style" flips it automatically. The
 * little dot shows which of the two currently drives the caption.
 */
export function StyleForm() {
  const style = usePromptStore((s) => s.style_description)
  const setStyleField = usePromptStore((s) => s.setStyleField)
  const setStyleMode = usePromptStore((s) => s.setStyleMode)

  const modeDot = (active: boolean) => (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full ml-1.5 align-middle",
        active ? "bg-violet-400" : "bg-zinc-700",
      )}
      title={active ? "This field drives the caption" : "Inactive — type here to switch"}
    />
  )

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Aesthetics</Label>
        <Input
          value={style.aesthetics}
          onChange={(e) => setStyleField("aesthetics", e.target.value)}
          placeholder="warm, cinematic, moody..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Lighting</Label>
        <Input
          value={style.lighting}
          onChange={(e) => setStyleField("lighting", e.target.value)}
          placeholder="golden hour, rim light from upper left..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Medium</Label>
        <Input
          value={style.medium}
          onChange={(e) => setStyleField("medium", e.target.value)}
          placeholder="photograph, illustration, 3d render..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-zinc-400">
            Photo / Camera{modeDot(style.mode === "photo")}
          </Label>
          <Input
            value={style.photo ?? ""}
            onChange={(e) => {
              setStyleField("photo", e.target.value)
              if (e.target.value) setStyleMode("photo")
            }}
            placeholder="35mm, f/1.4, bokeh..."
            className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-zinc-400">
            Art Style{modeDot(style.mode === "illustration")}
          </Label>
          <Input
            value={style.art_style ?? ""}
            onChange={(e) => {
              setStyleField("art_style", e.target.value)
              if (e.target.value) setStyleMode("illustration")
            }}
            placeholder="flat vector, bold outlines..."
            className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
          />
        </div>
      </div>

      <PaletteEditor
        colors={style.color_palette}
        maxColors={16}
        label="Color palette"
        onChange={(palette) => setStyleField("color_palette", palette)}
      />
    </div>
  )
}
