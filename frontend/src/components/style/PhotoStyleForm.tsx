import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { PaletteEditor } from "@/components/palette/PaletteEditor"
import { usePromptStore } from "@/stores/promptStore"

export function PhotoStyleForm() {
  const style = usePromptStore((s) => s.style_description)
  const setStyleField = usePromptStore((s) => s.setStyleField)

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
        <Label className="text-xs text-zinc-400">Photo / Camera</Label>
        <Input
          value={style.photo}
          onChange={(e) => setStyleField("photo", e.target.value)}
          placeholder="35mm, f/1.4, bokeh, film grain..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Medium</Label>
        <Input
          value={style.medium}
          onChange={(e) => setStyleField("medium", e.target.value)}
          placeholder="photograph, editorial, product shot..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
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
