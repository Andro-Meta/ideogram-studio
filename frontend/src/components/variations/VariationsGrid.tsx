import { Loader2 } from "lucide-react"
import type { VariationResult } from "@/hooks/useBatchGenerate"

interface Props {
  results: VariationResult[]
  current: number
  total: number
  isRunning: boolean
  onSelect: (r: VariationResult) => void
  onCancel: () => void
  onClear: () => void
}

export function VariationsGrid({ results, current, total, isRunning, onSelect, onCancel, onClear }: Props) {
  if (!results.length && !isRunning) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[11px] text-zinc-400">
          {isRunning
            ? `Generating image ${current} / ${total}…`
            : `${results.length} image${results.length !== 1 ? "s" : ""} — click to use`}
        </p>
        <div className="flex gap-2">
          {isRunning && (
            <button
              type="button"
              onClick={onCancel}
              className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          )}
          {!isRunning && results.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {results.map((r) => (
          <button
            key={r.seed}
            type="button"
            onClick={() => onSelect(r)}
            className="relative group rounded-lg overflow-hidden border border-zinc-700 hover:border-violet-500 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
            title={`Seed ${r.seed} — click to use`}
          >
            <img
              src={r.imageUrl}
              alt={`Batch image seed ${r.seed}`}
              className="w-full h-auto block"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-violet-500/0 group-hover:bg-violet-500/10 transition-colors pointer-events-none" />
            {/* Metadata on hover */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900/90 to-transparent px-2 py-1.5 flex justify-between text-[10px] text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <span className="font-mono">seed {r.seed}</span>
              <span>{(r.durationMs / 1000).toFixed(1)}s</span>
            </div>
          </button>
        ))}

        {/* Spinner placeholder while next variation is in-flight */}
        {isRunning && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 aspect-square flex items-center justify-center">
            <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
