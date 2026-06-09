import { Download, Trash2, X, Clock, Hash, Maximize2 } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useGalleryItem, useDeleteGalleryItem } from "@/hooks/useGallery"
import { usePromptStore } from "@/stores/promptStore"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

interface Props {
  itemId: string | null
  onClose: () => void
}

export function GalleryDetail({ itemId, onClose }: Props) {
  const { data: item } = useGalleryItem(itemId)
  const deleteMutation = useDeleteGalleryItem()
  const loadFromParsed = usePromptStore((s) => s.loadFromParsed)
  const navigate = useNavigate()

  if (!item) return null

  const imageUrl = item.image_path ? `/outputs/${item.image_path}` : null
  const durationSec = item.duration_ms ? (item.duration_ms / 1000).toFixed(1) : null

  const handleDownload = () => {
    if (!imageUrl) return
    const a = document.createElement("a")
    a.href = imageUrl
    a.download = `ideogram-${item.seed ?? "unknown"}.png`
    a.click()
  }

  const handleLoadPrompt = () => {
    if (!item.prompt_json) {
      toast.error("No prompt data saved for this image")
      return
    }
    try {
      const parsed = JSON.parse(item.prompt_json)
      const style = parsed.style_description ?? {}
      const comp  = parsed.compositional_deconstruction ?? {}
      const mode  = "photo" in style ? "photo" : "illustration"
      loadFromParsed({
        high_level_description: parsed.high_level_description ?? "",
        style_description: {
          mode,
          aesthetics:    style.aesthetics   ?? "",
          lighting:      style.lighting     ?? "",
          medium:        style.medium       ?? "",
          photo:         style.photo        ?? "",
          art_style:     style.art_style    ?? "",
          color_palette: style.color_palette ?? [],
        },
        background: comp.background ?? "",
        elements: (comp.elements ?? []).map((el: Record<string, unknown>) => {
          const bbox = Array.isArray(el.bbox) && el.bbox.length === 4
            ? { ymin: el.bbox[0] as number, xmin: el.bbox[1] as number, ymax: el.bbox[2] as number, xmax: el.bbox[3] as number }
            : undefined
          return {
            id: crypto.randomUUID(),
            type: el.type as "obj" | "text",
            bbox,
            text: (el.text as string) ?? "",
            desc: (el.desc as string) ?? "",
            color_palette: (el.color_palette as string[]) ?? [],
          }
        }),
      })
      toast.success("Prompt loaded into editor")
      onClose()
      navigate("/generate")
    } catch {
      toast.error("Could not parse saved prompt")
    }
  }

  const handleDelete = () => {
    deleteMutation.mutate(item.id, {
      onSuccess: () => onClose(),
    })
  }

  return (
    <Dialog open={!!itemId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
        <div className="flex h-[80vh]">
          {/* Image panel */}
          <div className="flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Generated"
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-zinc-600 text-sm">No image available</div>
            )}
          </div>

          {/* Metadata panel */}
          <div className="w-64 border-l border-zinc-700 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="text-sm font-medium text-zinc-200">Details</h3>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {/* Stats */}
              <div className="space-y-2">
                {item.seed != null && (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Hash className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="font-mono text-xs">{item.seed}</span>
                    <span className="text-zinc-600 text-xs">seed</span>
                  </div>
                )}
                {durationSec && (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Clock className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="text-xs">{durationSec}s</span>
                  </div>
                )}
                {item.width && item.height && (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Maximize2 className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="text-xs">{item.width} × {item.height}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {item.model_variant && (
                  <Badge variant="outline" className="text-[10px] border-zinc-600 text-zinc-400">
                    {item.model_variant.toUpperCase()}
                  </Badge>
                )}
                {item.sampler_preset && (
                  <Badge variant="outline" className="text-[10px] border-zinc-600 text-zinc-400">
                    {item.sampler_preset.replace("V4_", "").replace("_", " ")}
                  </Badge>
                )}
              </div>

              <Separator className="bg-zinc-700" />

              {/* Prompt JSON preview */}
              {item.prompt_json && (
                <div className="space-y-1">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Caption JSON</p>
                  <pre className="text-[10px] text-zinc-500 bg-zinc-800 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {JSON.stringify(JSON.parse(item.prompt_json), null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-zinc-700 space-y-2">
              <Button
                className="w-full bg-violet-600 hover:bg-violet-500 text-white text-xs h-8"
                onClick={handleLoadPrompt}
              >
                Load into Editor
              </Button>
              {imageUrl && (
                <Button
                  variant="outline"
                  className="w-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-8 gap-1.5"
                  onClick={handleDownload}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PNG
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full border-red-900 bg-transparent hover:bg-red-500/10 text-red-400 text-xs h-8 gap-1.5"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
