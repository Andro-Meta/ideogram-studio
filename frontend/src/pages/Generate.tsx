import { useEffect, useState } from "react"
import {
  Zap, Square, RotateCcw, AlertTriangle, Loader2, Power,
  ArrowUpCircle, Layers, Copy, ExternalLink,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { PromptBar } from "@/components/prompt/PromptBar"
import { HighLevelDescription } from "@/components/prompt/HighLevelDescription"
import { StylePanel } from "@/components/style/StylePanel"
import { ElementList } from "@/components/elements/ElementList"
import { BBoxCanvas } from "@/components/canvas/BBoxCanvas"
import { ModelVariantToggle } from "@/components/controls/ModelVariantToggle"
import { SamplerPresetPicker } from "@/components/controls/SamplerPresetPicker"
import { ResolutionPicker } from "@/components/controls/ResolutionPicker"
import { SeedControl } from "@/components/controls/SeedControl"
import { VariationsGrid } from "@/components/variations/VariationsGrid"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { useGenerationStore } from "@/stores/generationStore"
import { useGenerate } from "@/hooks/useGenerate"
import { useModelStatus, useLoadModel } from "@/hooks/useModelStatus"
import { useUpscale, useUpscaleModels } from "@/hooks/useUpscale"
import { useBatchGenerate, type VariationResult } from "@/hooks/useBatchGenerate"
import { buildCaption, validatePromptState, estimateTokens } from "@/lib/caption"

// ── Model status panel ────────────────────────────────────────────────────────

function ModelStatusPanel() {
  const { data } = useModelStatus()
  const { modelVariant } = useSettingsStore()
  const loadModel = useLoadModel()

  const status = data?.status ?? "unloaded"
  const variant = data?.variant
  const vramMb = data?.vram_used_mb
  const vramGb = vramMb ? (vramMb / 1024).toFixed(1) : null

  const statusColors: Record<string, string> = {
    ready:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
    loading:     "bg-amber-500/20  text-amber-300  border-amber-500/50",
    downloading: "bg-sky-500/20    text-sky-300    border-sky-500/50",
    unloaded:    "bg-zinc-700/50   text-zinc-400   border-zinc-600",
    error:       "bg-red-500/20    text-red-300    border-red-500/50",
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Model</p>
      <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded border text-[11px]", statusColors[status])}>
        {(status === "loading" || status === "downloading") && <Loader2 className="h-3 w-3 animate-spin" />}
        <span className="capitalize">{status}</span>
        {variant && <span className="opacity-60">({variant.toUpperCase()})</span>}
        {vramGb && <span className="ml-auto opacity-60">{vramGb} GB</span>}
      </div>
      {(status === "unloaded" || status === "error") && (
        <Button
          size="sm"
          variant="outline"
          className="w-full border-zinc-700 bg-zinc-800/60 hover:bg-violet-500/10 hover:border-violet-500/50 hover:text-violet-300 text-zinc-400 text-xs h-7 gap-1.5"
          disabled={loadModel.isPending}
          onClick={() => loadModel.mutate({ variant: modelVariant })}
        >
          {loadModel.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
          Pre-load {modelVariant.toUpperCase()}
        </Button>
      )}
      {status === "downloading" && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${data?.download_pct ?? 5}%` }}
            />
          </div>
          <p className="text-[10px] text-sky-400/80">
            {data?.progress_message ?? "Downloading weights — first time only"}
          </p>
        </div>
      )}
      {status === "loading" && (
        <p className="text-[10px] text-amber-400/70">
          {data?.progress_message ?? "Loading weights into GPU memory — 20–40s"}
        </p>
      )}
      {data?.error && (
        <p className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{data.error}</p>
      )}
    </div>
  )
}

// ── Background textarea ───────────────────────────────────────────────────────

function BackgroundField() {
  const { background, setBackground } = usePromptStore()
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Background</p>
      <Textarea
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        placeholder="Describe the background environment, setting, or scenery…"
        rows={2}
        className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none"
      />
    </div>
  )
}

// ── Upscale strip ─────────────────────────────────────────────────────────────

interface UpscaleStripProps {
  jobId: string | null
  onUpscaled: (url: string, w: number, h: number) => void
}

function UpscaleStrip({ jobId, onUpscaled }: UpscaleStripProps) {
  const { data: models } = useUpscaleModels()
  const upscale = useUpscale()

  if (!models?.length || !jobId) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ArrowUpCircle className="h-3 w-3 text-zinc-600 shrink-0" />
      <span className="text-[10px] text-zinc-600 shrink-0">4× Upscale:</span>
      {models.map((m) => {
        const active = upscale.isPending && upscale.variables?.model_name === m.name
        return (
          <button
            key={m.name}
            type="button"
            disabled={upscale.isPending}
            onClick={() =>
              upscale.mutate(
                { job_id: jobId, model_name: m.name },
                { onSuccess: (d) => onUpscaled(d.image_url, d.upscaled_width, d.upscaled_height) },
              )
            }
            className={cn(
              "flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border transition-all",
              active
                ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
              upscale.isPending && !active && "opacity-40 cursor-not-allowed",
            )}
            title={m.description}
          >
            {active && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Generate() {
  const promptState = usePromptStore()
  const { modelVariant, samplerPreset, width, height, fixedSeed, seed, variationCount } = useSettingsStore()
  const { status, progress, resultImageUrl, resultSeed, resultDurationMs, errorMessage, jobId } =
    useGenerationStore()
  const { generate, cancel } = useGenerate()
  const batch = useBatchGenerate()

  // Upscale state — local to this render, resets on new generation
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null)
  const [upscaledSize, setUpscaledSize] = useState<{ w: number; h: number } | null>(null)

  // Variation selection state
  const [selectedVariation, setSelectedVariation] = useState<VariationResult | null>(null)

  // Reset upscale and variation state when a new single generation starts
  useEffect(() => {
    if (status === "running") {
      setUpscaledUrl(null)
      setUpscaledSize(null)
      setSelectedVariation(null)
    }
  }, [status])

  const warnings = validatePromptState(promptState)
  const tokenCount = estimateTokens(promptState)
  const isRunning = status === "running" || status === "loading-model"
  const isDone = status === "done"

  // An effectively empty prompt produces garbage — require at least one of
  // description / background / elements before allowing generation.
  const canGenerate =
    promptState.high_level_description.trim().length > 0 ||
    promptState.background.trim().length > 0 ||
    promptState.elements.length > 0

  // What to show in the result area
  const displayImageUrl = selectedVariation?.imageUrl ?? upscaledUrl ?? resultImageUrl
  const displaySeed = selectedVariation?.seed ?? resultSeed
  const displayDurationMs = selectedVariation?.durationMs ?? resultDurationMs

  const buildReq = () => ({
    prompt_json: buildCaption(promptState),
    height,
    width,
    sampler_preset: samplerPreset,
    seed: fixedSeed ? seed : null,
    model_variant: modelVariant,
  })

  const handleGenerate = () => {
    batch.cancel()
    batch.clear()
    setSelectedVariation(null)
    generate(buildReq())
  }

  const handleVariations = () => {
    batch.run(buildReq(), variationCount)
  }

  const handleSelectVariation = (r: VariationResult) => {
    setSelectedVariation(r)
    setUpscaledUrl(null)
    setUpscaledSize(null)
  }

  // Ctrl/Cmd+Enter anywhere (outside text fields) starts a generation.
  // Inside the Quick Prompt textarea the same shortcut runs Magic Prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return
      if (isRunning || batch.isRunning || !canGenerate) return
      e.preventDefault()
      handleGenerate()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const progressPct = progress ? Math.round((progress.step / progress.total) * 100) : 0

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left panel: Prompt building ────────────────────────────────── */}
      <div className="w-80 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/30">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            <PromptBar />
            <Separator className="bg-zinc-800" />
            <HighLevelDescription />
            <BackgroundField />
            <StylePanel />
            <Separator className="bg-zinc-800" />
            <ElementList />
          </div>
        </ScrollArea>
      </div>

      {/* ── Center: Canvas + results ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Canvas */}
          <BBoxCanvas />

          {/* Result: single image */}
          {isDone && displayImageUrl && !batch.results.length && (
            <>
              {/* Metadata strip */}
              <div className="flex items-center gap-3 px-1 flex-wrap">
                {displaySeed != null && (
                  <span className="text-xs text-zinc-500 font-mono">Seed: {displaySeed}</span>
                )}
                {displayDurationMs != null && (
                  <span className="text-xs text-zinc-500">{(displayDurationMs / 1000).toFixed(1)}s</span>
                )}
                {upscaledSize && (
                  <span className="text-xs text-violet-400/80">
                    {upscaledSize.w}×{upscaledSize.h} upscaled
                  </span>
                )}
                <a
                  href={displayImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-xs text-zinc-400 hover:text-zinc-200 underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Full size
                </a>
                <a
                  href={displayImageUrl}
                  download={`ideogram-${displaySeed ?? "output"}.png`}
                  className="text-xs text-violet-400 hover:text-violet-300 underline"
                >
                  Download PNG
                </a>
              </div>

              {/* Upscale controls */}
              <UpscaleStrip
                jobId={jobId}
                onUpscaled={(url, w, h) => {
                  setUpscaledUrl(url)
                  setUpscaledSize({ w, h })
                }}
              />
            </>
          )}

          {/* Result: variation selected */}
          {selectedVariation && (
            <div className="flex items-center gap-3 px-1 flex-wrap">
              <span className="text-xs text-zinc-500 font-mono">Seed: {selectedVariation.seed}</span>
              <span className="text-xs text-zinc-500">{(selectedVariation.durationMs / 1000).toFixed(1)}s</span>
              <span className="text-xs text-violet-400/70">variation selected</span>
              <button
                type="button"
                onClick={() => setSelectedVariation(null)}
                className="text-xs text-zinc-600 hover:text-zinc-400 ml-auto"
              >
                Back to main
              </button>
            </div>
          )}

          {/* Variations grid */}
          {(batch.results.length > 0 || batch.isRunning) && (
            <VariationsGrid
              results={batch.results}
              current={batch.current}
              total={batch.total}
              isRunning={batch.isRunning}
              onSelect={handleSelectVariation}
              onCancel={batch.cancel}
              onClear={() => { batch.clear(); setSelectedVariation(null) }}
            />
          )}

          {/* Error */}
          {status === "error" && errorMessage && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Validation warnings */}
          {warnings.length > 0 && status === "idle" && (
            <div className="space-y-1">
              {warnings.slice(0, 3).map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400/80">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Generate controls — pinned to bottom */}
        <div className="shrink-0 p-4 border-t border-zinc-800 bg-zinc-900/50 space-y-3">
          {/* Token budget meter */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-zinc-700 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  tokenCount < 256   ? "bg-zinc-500" :
                  tokenCount < 1792  ? "bg-emerald-500" :
                  tokenCount < 2048  ? "bg-amber-500" :
                                       "bg-red-500",
                )}
                style={{ width: `${Math.min(100, (tokenCount / 2048) * 100)}%` }}
              />
            </div>
            <span className={cn(
              "text-[10px] tabular-nums shrink-0",
              tokenCount < 256   ? "text-zinc-600" :
              tokenCount < 1792  ? "text-zinc-500" :
              tokenCount < 2048  ? "text-amber-400" :
                                   "text-red-400",
            )}>
              {tokenCount} / 2048
            </span>
            <button
              type="button"
              title="Copy caption JSON to clipboard"
              className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(buildCaption(promptState))
                toast.success("Caption JSON copied")
              }}
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>

          {/* Single-gen progress */}
          {isRunning && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>{status === "loading-model" ? "Loading model…" : "Generating…"}</span>
                {progress && <span>{progress.step} / {progress.total} steps</span>}
              </div>
              <Progress
                value={status === "loading-model" ? undefined : progressPct}
                className="h-1.5 bg-zinc-700"
              />
            </div>
          )}

          {/* Batch progress */}
          {batch.isRunning && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3 w-3" />
                  Variation {batch.current} / {batch.total}
                </span>
              </div>
              <Progress
                value={Math.round(((batch.current - 1) / batch.total) * 100)}
                className="h-1.5 bg-zinc-700"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {isRunning ? (
              <Button
                variant="outline"
                className="flex-1 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 gap-2"
                onClick={cancel}
              >
                <Square className="h-4 w-4" />
                Cancel
              </Button>
            ) : batch.isRunning ? (
              <Button
                variant="outline"
                className="flex-1 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 gap-2"
                onClick={batch.cancel}
              >
                <Square className="h-4 w-4" />
                Stop Variations
              </Button>
            ) : (
              <>
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold gap-2 shadow-lg shadow-violet-500/20 disabled:opacity-40"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  title={canGenerate ? "Generate (Ctrl+Enter)" : "Describe your image first"}
                >
                  <Zap className="h-4 w-4" />
                  {isDone ? "Regenerate" : "Generate"}
                </Button>
                {isDone && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                    onClick={() => {
                      useGenerationStore.getState().reset()
                      setUpscaledUrl(null)
                      setUpscaledSize(null)
                      setSelectedVariation(null)
                      batch.clear()
                    }}
                    title="Clear result"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Variations launch row — only when not running */}
          {!isRunning && !batch.isRunning && (
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[10px] text-zinc-600 shrink-0">Variations:</span>
              {([2, 4, 8] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => useSettingsStore.getState().setVariationCount(n)}
                  className={cn(
                    "text-[10px] w-6 h-5 rounded border transition-all",
                    variationCount === n
                      ? "border-violet-500/50 text-violet-400 bg-violet-500/10"
                      : "border-zinc-700 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400",
                  )}
                >
                  {n}
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 px-2 text-[10px] border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 gap-1.5 disabled:opacity-40"
                onClick={handleVariations}
                disabled={!canGenerate}
                title={canGenerate ? `Generate ${variationCount} variations` : "Describe your image first"}
              >
                <Layers className="h-3 w-3" />
                Run
              </Button>
            </div>
          )}

          {!canGenerate && !isRunning && !batch.isRunning && (
            <p className="text-[10px] text-zinc-600 text-center">
              Add a description, background, or element to enable Generate · Ctrl+Enter to run
            </p>
          )}
        </div>
      </div>

      {/* ── Right panel: Generation settings ────────────────────────────── */}
      <div className="w-60 shrink-0 border-l border-zinc-800 bg-zinc-900/30 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            <ModelStatusPanel />
            <Separator className="bg-zinc-800" />
            <ModelVariantToggle />
            <Separator className="bg-zinc-800" />
            <SamplerPresetPicker />
            <Separator className="bg-zinc-800" />
            <ResolutionPicker />
            <Separator className="bg-zinc-800" />
            <SeedControl />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
