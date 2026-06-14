import { useState } from "react"
import { Boxes, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useModelStatus } from "@/hooks/useModelStatus"
import { useLoras, useLoraMutations } from "@/hooks/useLoras"
import type { LoraInfo } from "@/types/api"

/**
 * Settings-column section wrapper: renders a leading divider + the LoRA panel
 * only when a LoRA-capable model is loaded, so unsupported models leave no
 * dangling separator. The capability check lives in LoraPanel (returns null).
 */
export function LoraSection() {
  const { data: status } = useModelStatus()
  const { data } = useLoras(status?.status === "ready")
  if (status?.status !== "ready" || !data?.supported) return null
  return (
    <>
      <Separator className="bg-zinc-800" />
      <LoraPanel />
    </>
  )
}

/**
 * LoRA adapters for the loaded model. Renders ONLY when the current pipeline
 * supports adapters (the diffusers paths: NF4·D / BF16). For fp8/nf4 the whole
 * panel is absent — there is nothing to attach a LoRA to. Driven by
 * GET /api/loras, which reports `supported` from the live pipeline.
 */
export function LoraPanel() {
  const { data: status } = useModelStatus()
  const ready = status?.status === "ready"
  const { data, refetch, isRefetching } = useLoras(ready)
  const { apply, setWeight, remove } = useLoraMutations()
  const [hfRepo, setHfRepo] = useState("")

  // Hidden entirely unless a LoRA-capable model is actually loaded.
  if (!ready || !data?.supported) return null

  const loadedNames = new Set(data.loaded.map((l) => l.source.split(/[\\/]/).pop()))
  const unloadedFiles = data.available.filter((f) => !loadedNames.has(f))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <Boxes className="h-3.5 w-3.5 text-violet-400/70" />
          LoRA Adapters
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          title="Rescan the loras/ folder"
          className="text-zinc-500 hover:text-violet-300 transition-colors"
        >
          <RefreshCw className={cn("h-3 w-3", isRefetching && "animate-spin")} />
        </button>
      </div>

      {/* Loaded adapters — weight sliders + remove */}
      {data.loaded.length > 0 && (
        <div className="space-y-2">
          {data.loaded.map((l) => (
            <LoadedRow
              key={l.name}
              lora={l}
              onWeight={(w) => setWeight.mutate({ name: l.name, weight: w })}
              onRemove={() => remove.mutate(l.name)}
              busy={remove.isPending || setWeight.isPending}
            />
          ))}
        </div>
      )}

      {/* Available files not yet loaded */}
      {unloadedFiles.length > 0 && (
        <div className="space-y-1">
          {unloadedFiles.map((f) => (
            <button
              key={f}
              type="button"
              disabled={apply.isPending}
              onClick={() => apply.mutate({ filename: f, weight: 1.0 })}
              className="w-full flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:border-violet-600/60 hover:bg-violet-500/5 disabled:opacity-50 transition-colors"
              title={`Apply ${f}`}
            >
              {apply.isPending
                ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                : <Plus className="h-3 w-3 shrink-0 text-violet-400/70" />}
              <span className="truncate">{f.replace(/\.safetensors$/, "")}</span>
            </button>
          ))}
        </div>
      )}

      {/* Load from a Hugging Face repo id */}
      <div className="flex items-center gap-1.5">
        <input
          value={hfRepo}
          onChange={(e) => setHfRepo(e.target.value)}
          placeholder="HF repo id (optional)…"
          className="flex-1 min-w-0 h-7 rounded border border-zinc-700 bg-zinc-800 text-[11px] text-zinc-200 px-2 outline-none focus:border-violet-500"
        />
        <button
          type="button"
          disabled={!hfRepo.trim() || apply.isPending}
          onClick={() => {
            apply.mutate({ hf_repo: hfRepo.trim(), weight: 1.0 })
            setHfRepo("")
          }}
          className="shrink-0 h-7 px-2 rounded border border-violet-700/60 text-[11px] text-violet-300 hover:bg-violet-500/10 disabled:opacity-40 transition-colors"
        >
          Add
        </button>
      </div>

      {/* Empty state — tell the user where files go */}
      {data.available.length === 0 && data.loaded.length === 0 && (
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Drop <span className="text-zinc-500">.safetensors</span> LoRA files (e.g. from
          Civitai) into:
          <br />
          <code className="text-[9px] text-zinc-500 break-all">{data.loras_dir}</code>
          <br />
          then rescan. Adapters are applied unfused for inference.
        </p>
      )}

      <p className="text-[10px] text-zinc-600">
        {data.variant?.toUpperCase()} supports LoRA. Stack multiple — weights blend.
      </p>
    </div>
  )
}

function LoadedRow({
  lora, onWeight, onRemove, busy,
}: {
  lora: LoraInfo
  onWeight: (w: number) => void
  onRemove: () => void
  busy: boolean
}) {
  // Local optimistic value so the slider is smooth; commit on release.
  const [val, setVal] = useState(lora.weight)

  return (
    <div className="rounded-md border border-violet-900/40 bg-violet-500/[0.04] px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="flex-1 min-w-0 truncate text-[11px] text-violet-200" title={lora.source}>
          {lora.name}
        </span>
        <span className="text-[10px] tabular-nums text-zinc-400 w-8 text-right">
          {val.toFixed(2)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          title="Remove adapter"
          className="shrink-0 text-zinc-500 hover:text-red-400 disabled:opacity-40 transition-colors"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
      <Slider
        value={[val]}
        min={0}
        max={2}
        step={0.05}
        onValueChange={([v]) => setVal(v)}
        onValueCommit={([v]) => onWeight(v)}
      />
    </div>
  )
}
