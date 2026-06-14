import { useState } from "react"
import { Layers, Loader2, Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSplitLayers, type LayersResult } from "@/hooks/useSplitLayers"

interface Props {
  imageUrl: string
  /** The generation's structured caption — its element boxes drive the split. */
  promptJson?: string | null
  sourceJobId?: string
  className?: string
}

/**
 * "Split into layers" action + its result grid, shared by the Generate result
 * card and the Gallery detail panel. Each bounding-box element in the prompt is
 * matted onto its own transparent PNG (SAM box-prompt, rembg fallback) plus a
 * background layer; downloadable individually or as a ZIP.
 */
export function SplitLayersPanel({ imageUrl, promptJson, sourceJobId, className }: Props) {
  const [layers, setLayers] = useState<LayersResult | null>(null)
  const splitLayers = useSplitLayers()

  const handleSplit = () => {
    if (!imageUrl) return
    setLayers(null)
    splitLayers.mutate(
      { imageUrl, promptJson, sourceJobId },
      {
        onSuccess: (res) => {
          setLayers(res)
          toast.success(`${res.layers.length} layer${res.layers.length === 1 ? "" : "s"} created`)
        },
      },
    )
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        className="w-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-8 gap-1.5"
        onClick={handleSplit}
        disabled={splitLayers.isPending || !imageUrl}
        title="Cut each element onto its own transparent layer (uses the prompt's boxes) + a background layer"
      >
        {splitLayers.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
        {splitLayers.isPending ? "Splitting…" : "Split into layers"}
      </Button>

      {/* Layer results — transparent PNGs on a checkerboard so alpha shows */}
      {layers && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
              {layers.layers.length} layers
            </p>
            <a
              href={layers.zip_url}
              download
              className="flex items-center gap-1 text-[10px] text-violet-300 hover:text-violet-200"
            >
              <Download className="h-3 w-3" /> ZIP
            </a>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {layers.layers.map((ly) => (
              <a
                key={ly.image_url}
                href={ly.image_url}
                download
                title={`${ly.name} (${ly.kind}) — click to download`}
                className="group/ly block"
              >
                <div
                  className="aspect-square rounded border border-zinc-700 overflow-hidden"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg,#3f3f46 25%,transparent 25%),linear-gradient(-45deg,#3f3f46 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#3f3f46 75%),linear-gradient(-45deg,transparent 75%,#3f3f46 75%)",
                    backgroundSize: "10px 10px",
                    backgroundPosition: "0 0,0 5px,5px -5px,-5px 0",
                    backgroundColor: "#27272a",
                  }}
                >
                  <img src={ly.image_url} alt={ly.name} className="w-full h-full object-contain" />
                </div>
                <p className="mt-0.5 text-[9px] text-zinc-500 truncate group-hover/ly:text-zinc-300">{ly.name}</p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
