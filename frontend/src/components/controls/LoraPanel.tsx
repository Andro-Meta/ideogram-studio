import { useState } from "react"
import { toast } from "sonner"
import { Boxes, Loader2, Plus, RefreshCw, Trash2, Sparkles, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useModelStatus } from "@/hooks/useModelStatus"
import { useLoras, useLoraMutations } from "@/hooks/useLoras"
import { CURATED_LORAS, type CuratedLora, type LoraRecommended } from "@/lib/loraGallery"
import { useSettingsStore } from "@/stores/settingsStore"
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
  const setSamplerPreset = useSettingsStore((s) => s.setSamplerPreset)
  const setCfgPreset = useSettingsStore((s) => s.setCfgPreset)
  const [hfRepo, setHfRepo] = useState("")
  const [showCurated, setShowCurated] = useState(false)

  // Auto-apply a LoRA's recommended settings on add (sampler/CFG to the store),
  // with a one-click revert; surface trigger words to add to the prompt.
  function applyRecommended(rec?: LoraRecommended) {
    if (!rec) return
    const prev = {
      sampler: useSettingsStore.getState().samplerPreset,
      cfg: useSettingsStore.getState().cfgPreset,
    }
    if (rec.samplerPreset) setSamplerPreset(rec.samplerPreset)
    if (rec.cfgPreset) setCfgPreset(rec.cfgPreset)
    const changed = !!(rec.samplerPreset || rec.cfgPreset)
    const trig = rec.triggerWords?.length ? ` Add to prompt: ${rec.triggerWords.join(", ")}.` : ""
    if (changed) {
      toast.success("Recommended settings applied." + trig, {
        action: { label: "Revert", onClick: () => { setSamplerPreset(prev.sampler); setCfgPreset(prev.cfg) } },
      })
    } else if (trig) {
      toast.message("LoRA added", { description: trig.trim() })
    }
  }

  function addCurated(c: CuratedLora) {
    if (c.format && c.format !== "lora") return   // LoKr/LoHa: unsupported
    const repo = c.file ? `${c.repo}::${c.file}` : c.repo
    apply.mutate(
      { hf_repo: repo, weight: c.recommended?.weight ?? 1.0 },
      { onSuccess: () => applyRecommended(c.recommended) },
    )
  }

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

      {/* Curated gallery — vetted Ideogram 4 LoRAs from Hugging Face, one click */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40">
        <button
          type="button"
          onClick={() => setShowCurated((v) => !v)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-zinc-300 hover:text-violet-200 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-400/70" />
            Browse curated ({CURATED_LORAS.length})
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showCurated && "rotate-180")} />
        </button>
        {showCurated && (
          <div className="px-1.5 pb-1.5 space-y-1">
            {CURATED_LORAS.map((c) => {
              const loaded = data.loaded.some((l) => l.source === c.repo || l.source.startsWith(`${c.repo}::`))
              const unsupported = !!c.format && c.format !== "lora"
              const rec = c.recommended
              return (
                <button
                  key={c.repo}
                  type="button"
                  disabled={apply.isPending || loaded || unsupported}
                  onClick={() => addCurated(c)}
                  title={unsupported ? `${c.title} — ${c.format!.toUpperCase()} format, not supported on this model` : `${c.repo} — ${c.blurb}`}
                  className="w-full text-left rounded border border-zinc-700/70 bg-zinc-800/50 px-2 py-1.5 hover:border-violet-600/60 hover:bg-violet-500/5 disabled:opacity-50 disabled:hover:border-zinc-700/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-medium text-zinc-200 truncate">{c.title}</span>
                    {unsupported
                      ? <span className="text-[9px] uppercase tracking-wider text-amber-400/70 shrink-0">{c.format}</span>
                      : <span className="text-[9px] uppercase tracking-wider text-violet-300/60 shrink-0">{c.kind}</span>}
                  </div>
                  <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2">{c.blurb}</p>
                  {!unsupported && rec && (rec.weight || rec.triggerWords?.length) && (
                    <p className="text-[9px] text-violet-300/50 mt-0.5 truncate">
                      {rec.weight != null && `weight ${rec.weight}`}
                      {rec.weight != null && rec.triggerWords?.length ? " · " : ""}
                      {rec.triggerWords?.length ? `trigger: ${rec.triggerWords.join(", ")}` : ""}
                    </p>
                  )}
                </button>
              )
            })}
            <p className="text-[9px] text-zinc-600 px-1 pt-0.5">
              First use downloads the adapter from Hugging Face. Adding one applies its
              recommended weight/settings (you can revert). LoKr/LoHa adapters aren't supported.
            </p>
          </div>
        )}
      </div>

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
      {!!lora.triggers?.length && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {lora.triggers.map((t) => (
            <button
              key={t} type="button"
              onClick={() => { navigator.clipboard?.writeText(t); toast.message("Copied trigger word", { description: `“${t}” — add it to your prompt` }) }}
              title="Copy this trigger word to add to your prompt"
              className="rounded bg-violet-500/10 border border-violet-700/40 px-1.5 py-0.5 text-[9px] text-violet-300 hover:bg-violet-500/20"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
