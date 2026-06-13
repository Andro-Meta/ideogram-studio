import { useEffect, useState } from "react"
import {
  Download, Trash2, X, Clock, Hash, Maximize2, Copy, Heart,
  ChevronLeft, ChevronRight, Lock, SlidersHorizontal,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useGalleryItem, useDeleteGalleryItem, useToggleFavorite } from "@/hooks/useGallery"
import { useReusePrompt } from "@/hooks/useReusePrompt"
import { copyText } from "@/lib/clipboard"
import { toast } from "sonner"
import { EditorDialog } from "@/components/editor/EditorDialog"

interface Props {
  itemId: string | null
  onClose: () => void
  position?: number
  count?: number
  onPrev?: () => void
  onNext?: () => void
}

export function GalleryDetail({ itemId, onClose, position, count, onPrev, onNext }: Props) {
  const { data: item } = useGalleryItem(itemId)
  const deleteMutation = useDeleteGalleryItem()
  const toggleFavorite = useToggleFavorite()
  const reuse = useReusePrompt()
  const [editorOpen, setEditorOpen] = useState(false)

  // Arrow keys flip between images while the viewer is open (like ideogram.ai)
  useEffect(() => {
    if (!itemId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault()
        onPrev()
      } else if (e.key === "ArrowRight" && onNext) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [itemId, onPrev, onNext])

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

  const handleLoadPrompt = (lockSeed = false) => {
    if (reuse(item, lockSeed)) onClose()
  }

  const handleDelete = () => {
    deleteMutation.remove(item.id)   // one click; Undo toast for 5s
    onClose()
  }

  return (
    <Dialog open={!!itemId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
        <div className="flex h-[80vh]">
          {/* Image panel */}
          <div className="relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Generated"
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-zinc-600 text-sm">No image available</div>
            )}

            {onPrev && (
              <button
                type="button"
                onClick={onPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-zinc-300 hover:text-white rounded-full p-1.5 transition-colors"
                title="Previous image (←)"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-zinc-300 hover:text-white rounded-full p-1.5 transition-colors"
                title="Next image (→)"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            {position != null && count != null && count > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-zinc-400 text-[10px] px-2 py-0.5 rounded-full tabular-nums">
                {position} / {count}
              </div>
            )}
          </div>

          {/* Metadata panel */}
          <div className="w-64 border-l border-zinc-700 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="text-sm font-medium text-zinc-200">Details</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleFavorite.mutate({ id: item.id, favorite: !item.favorite })}
                  className={cn(
                    "transition-colors",
                    item.favorite ? "text-red-400 hover:text-red-300" : "text-zinc-500 hover:text-red-300",
                  )}
                  title={item.favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
                </button>
                <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {/* Stats */}
              <div className="space-y-2">
                {item.seed != null && (
                  <button
                    type="button"
                    className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors group/seed"
                    title="Copy seed to clipboard"
                    onClick={() => {
                      copyText(String(item.seed)).then((ok) =>
                        ok ? toast.success("Seed copied") : toast.error("Couldn't copy"))
                    }}
                  >
                    <Hash className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="font-mono text-xs">{item.seed}</span>
                    <span className="text-zinc-600 text-xs">seed</span>
                    <Copy className="h-3 w-3 text-zinc-700 opacity-0 group-hover/seed:opacity-100 transition-opacity" />
                  </button>
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
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Caption JSON</p>
                    <button
                      type="button"
                      className="text-zinc-600 hover:text-zinc-300 transition-colors"
                      title="Copy caption JSON"
                      onClick={() => {
                        copyText(item.prompt_json!).then((ok) =>
                          ok ? toast.success("Caption JSON copied") : toast.error("Couldn't copy"))
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
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
                onClick={() => handleLoadPrompt(false)}
                title="Restore the prompt, resolution, sampler, and model of this image"
              >
                Load into Editor
              </Button>
              {item.seed != null && (
                <Button
                  variant="outline"
                  className="w-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-8 gap-1.5"
                  onClick={() => handleLoadPrompt(true)}
                  title="Same as Load into Editor, plus lock this image's seed for an exact recreation"
                >
                  <Lock className="h-3 w-3" />
                  Recreate Exactly
                </Button>
              )}
              {imageUrl && (
                <Button
                  variant="outline"
                  className="w-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-8 gap-1.5"
                  onClick={() => setEditorOpen(true)}
                  title="Rotate, flip, and adjust brightness/contrast/saturation — saved as a copy"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Edit Image
                </Button>
              )}
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
                className="w-full text-xs h-8 gap-1.5 border-red-900 bg-transparent hover:bg-red-500/10 text-red-400"
                onClick={handleDelete}
                title="Delete (Undo available for 5s)"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
      {imageUrl && (
        <EditorDialog
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          jobId={item.id}
          imageUrl={imageUrl}
        />
      )}
    </Dialog>
  )
}
