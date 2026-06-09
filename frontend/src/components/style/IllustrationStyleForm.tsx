import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { PaletteEditor } from "@/components/palette/PaletteEditor"
import { usePromptStore } from "@/stores/promptStore"

export function IllustrationStyleForm() {
  const style = usePromptStore((s) => s.style_description)
  const setStyleField = usePromptStore((s) => s.setStyleField)

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Aesthetics</Label>
        <Input
          value={style.aesthetics}
          onChange={(e) => setStyleField("aesthetics", e.target.value)}
          placeholder="clean, minimal, bold, playful..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Lighting</Label>
        <Input
          value={style.lighting}
          onChange={(e) => setStyleField("lighting", e.target.value)}
          placeholder="flat, even studio, dramatic..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Medium</Label>
        <Input
          value={style.medium}
          onChange={(e) => setStyleField("medium", e.target.value)}
          placeholder="illustration, graphic_design, 3d_render..."
          className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">Art Style</Label>
        <Input
          value={style.art_style}
          onChange={(e) => setStyleField("art_style", e.target.value)}
          placeholder="flat vector, bold outlines, geometric shapes..."
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
