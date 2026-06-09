import { useState } from "react"
import { RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Undo2, Save, Loader2, X } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useEditImage } from "@/hooks/useEditImage"

interface Props {
  open: boolean
  onClose: () => void
  jobId: string
  imageUrl: string
}

const DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, sharpness: 1 }

/** Local image editor — rotate / flip / tone adjustments, saved as a new copy.
 *  (The Ideogram 4 open release is text-to-image only; AI inpainting like
 *  ideogram.ai's Magic Fill is a server-side product without public weights.) */
export function ImageEditor({ open, onClose, jobId, imageUrl }: Props) {
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [adjust, setAdjust] = useState(DEFAULTS)
  const edit = useEditImage()

  const dirty =
    rotate !== 0 || flipH || flipV ||
    Object.entries(DEFAULTS).some(([k, v]) => adjust[k as keyof typeof DEFAULTS] !== v)

  const resetAll = () => {
    setRotate(0)
    setFlipH(false)
    setFlipV(false)
    setAdjust(DEFAULTS)
  }

  const handleSave = () => {
    edit.mutate(
      {
        job_id: jobId,
        rotate,
        flip_h: flipH,
        flip_v: flipV,
        brightness: adjust.brightness,
        contrast: adjust.contrast,
        saturation: adjust.saturation,
        sharpness: adjust.sharpness,
      },
      { onSuccess: () => { resetAll(); onClose() } },
    )
  }

  const sliders: { key: keyof typeof DEFAULTS; label: string; note?: string }[] = [
    { key: "brightness", label: "Brightness" },
    { key: "contrast",   label: "Contrast" },
    { key: "saturation", label: "Saturation" },
    { key: "sharpness",  label: "Sharpness", note: "applied on save" },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
        <div className="flex h-[70vh]">
          {/* Live preview (CSS approximation; sharpness applies on save) */}
          <div className="flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden p-4">
            <img
              src={imageUrl}
              alt="Editing preview"
              className="max-w-full max-h-full object-contain transition-transform"
              style={{
                filter: `brightness(${adjust.brightness}) contrast(${adjust.contrast}) saturate(${adjust.saturation})`,
                transform: `rotate(${rotate}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
              }}
            />
          </div>

          {/* Controls */}
          <div className="w-64 border-l border-zinc-700 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="text-sm font-medium text-zinc-200">Edit Image</h3>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Transform */}
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Transform</p>
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRotate(((rotate + 270) % 360) as 0 | 90 | 180 | 270)}
                    className="flex items-center justify-center h-8 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all"
                    title="Rotate left 90°"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)}
                    className="flex items-center justify-center h-8 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all"
                    title="Rotate right 90°"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlipH((v) => !v)}
                    className={cn(
                      "flex items-center justify-center h-8 rounded border transition-all",
                      flipH
                        ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
                    )}
                    title="Flip horizontally"
                  >
                    <FlipHorizontal2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlipV((v) => !v)}
                    className={cn(
                      "flex items-center justify-center h-8 rounded border transition-all",
                      flipV
                        ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
                    )}
                    title="Flip vertically"
                  >
                    <FlipVertical2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {rotate !== 0 && (
                  <p className="text-[10px] text-zinc-600">Rotated {rotate}° clockwise</p>
                )}
              </div>

              {/* Adjustments */}
              <div className="space-y-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Adjustments</p>
                {sliders.map(({ key, label, note }) => (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-300">
                        {label}
                        {note && <span className="text-zinc-600"> · {note}</span>}
                      </span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {adjust[key].toFixed(2)}×
                      </span>
                    </div>
                    <Slider
                      value={[adjust[key]]}
                      min={0.2}
                      max={2.0}
                      step={0.05}
                      onValueChange={([v]) => setAdjust((a) => ({ ...a, [key]: v }))}
                    />
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Edits are saved as a new gallery copy — the original stays untouched.
                AI inpainting (Magic Fill) isn't included in Ideogram's open-weights
                release; these are classic local adjustments.
              </p>
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-zinc-700 space-y-2">
              <Button
                className="w-full bg-violet-600 hover:bg-violet-500 text-white text-xs h-8 gap-1.5 disabled:opacity-40"
                disabled={!dirty || edit.isPending}
                onClick={handleSave}
              >
                {edit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save as Copy
              </Button>
              <Button
                variant="outline"
                className="w-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-8 gap-1.5 disabled:opacity-40"
                disabled={!dirty}
                onClick={resetAll}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
