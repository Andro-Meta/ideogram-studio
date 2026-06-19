import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Zap, Square, RotateCcw, AlertTriangle, Loader2, Power,
  ArrowUpCircle, Layers, Copy, Brush, LayoutGrid, X, Info, Minus, Plus,
} from "lucide-react"
import {
  Popover, PopoverTrigger, PopoverContent,
  PopoverHeader, PopoverTitle, PopoverDescription,
} from "@/components/ui/popover"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Rail } from "@/components/ui/rail"
import { cn } from "@/lib/utils"
import { PromptBar } from "@/components/prompt/PromptBar"
import { HighLevelDescription } from "@/components/prompt/HighLevelDescription"
import { StylePanel } from "@/components/style/StylePanel"
import { ElementList } from "@/components/elements/ElementList"
import { SplitLayersPanel } from "@/components/layers/SplitLayersPanel"
import { BBoxCanvas } from "@/components/canvas/BBoxCanvas"
import { ModelVariantToggle } from "@/components/controls/ModelVariantToggle"
import { LoraSection } from "@/components/controls/LoraPanel"
import { QualityControls } from "@/components/controls/QualityControls"
import { ArtifactSuppression } from "@/components/controls/ArtifactSuppression"
import { PromptToolbar } from "@/components/prompt/PromptToolbar"
import { ResolutionPicker } from "@/components/controls/ResolutionPicker"
import { SeedControl } from "@/components/controls/SeedControl"
import { VariationsGrid } from "@/components/variations/VariationsGrid"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore, MIN_BATCH, MAX_BATCH, cfgRequestFields, qualityRequestFields } from "@/stores/settingsStore"
import { useGenerationStore } from "@/stores/generationStore"
import { useSourceImageStore } from "@/stores/sourceImageStore"
import { useRemixFromImage } from "@/hooks/useRemixFromImage"
import { useQueryClient } from "@tanstack/react-query"
import { useGenerate } from "@/hooks/useGenerate"
import { useModelStatus, useLoadModel } from "@/hooks/useModelStatus"
import { useUpscale, useUpscaleModels } from "@/hooks/useUpscale"
import { useBatchGenerate, type VariationResult } from "@/hooks/useBatchGenerate"
import { Lightbox } from "@/components/lightbox/Lightbox"
import { RecentGrid } from "@/components/gallery/RecentGrid"
import { buildCaption, validatePromptState, estimateTokens } from "@/lib/caption"
import { buildConstraintClause } from "@/lib/constraintPresets"
import { copyText } from "@/lib/clipboard"

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
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Status</p>
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

// ── Flow section card ─────────────────────────────────────────────────────────
// Gives the prompt column its visual rhythm: numbered steps the eye can walk
// (1 Style → 2 Describe → 3 Elements), each in its own card. Style leads
// because Magic Prompt (in Describe) reads it — set the look, then describe.

function FlowSection({
  step, title, hint, children,
}: {
  step: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center h-[18px] w-[18px] rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold shrink-0">
          {step}
        </span>
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest">{title}</span>
        {hint && <span className="text-[10px] text-zinc-600 ml-auto">{hint}</span>}
      </div>
      {children}
    </section>
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
  const {
    modelVariant, samplerPreset, width, height, fixedSeed, seed, batchCount,
    setBatchCount, canvasOpen, setCanvasOpen,
  } = useSettingsStore()
  const { status, progress, resultImageUrl, resultSeed, resultDurationMs, errorMessage, jobId } =
    useGenerationStore()
  const { generate, cancel } = useGenerate()
  const batch = useBatchGenerate()
  const remix = useRemixFromImage()
  const queryClient = useQueryClient()

  // Upscale state — local to this render, resets on new generation
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null)
  const [upscaledSize, setUpscaledSize] = useState<{ w: number; h: number } | null>(null)

  // Lightbox for viewing results up close
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
  // Artifact-suppression clause (pseudo–negative-prompt), recomputed reactively
  // when the toggles change. Empty when suppression is off. Threaded into every
  // buildCaption() call below so the preview, copy, and generation all match.
  const constraintClause = useSettingsStore((s) =>
    s.artifactSuppression ? buildConstraintClause(s.artifactCategoryIds, s.artifactCustom) : ""
  )
  const captionOpts = { constraintClause }
  const tokenCount = estimateTokens(promptState, captionOpts)
  const isRunning = status === "running" || status === "loading-model"
  const isDone = status === "done"

  // Layout canvas: opt-in. Pinned elements force it open (hiding them would
  // misrepresent what will be generated).
  const hasPinnedElements = promptState.elements.some((el) => !!el.bbox)
  const showCanvas = canvasOpen || hasPinnedElements

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
    prompt_json: buildCaption(promptState, captionOpts),
    height,
    width,
    seed: fixedSeed ? seed : null,
    model_variant: modelVariant,
    ...qualityRequestFields(),   // sampler · detail · sampler_preset · advanced overrides
    ...cfgRequestFields(),
  })

  const handleGenerate = () => {
    batch.cancel()
    batch.clear()
    setSelectedVariation(null)

    // "Generate from image" with the blend slider above 0 routes through the
    // local Remix (img2img) so the result keeps some of the original image.
    const src = useSourceImageStore.getState()
    if (src.imageB64 && src.blendPct > 0) {
      const gen = useGenerationStore.getState()
      gen.reset()
      gen.setStatus("running", `Remixing — keeping ~${src.blendPct}% of your image…`)
      remix.mutate(
        {
          imageB64: src.imageB64,
          prompt: buildCaption(promptState, captionOpts),
          blendPct: src.blendPct,
          width,
          height,
          sampler_preset: samplerPreset,
          seed: fixedSeed ? seed : null,
          ...cfgRequestFields(),
        },
        {
          onSuccess: (res) => {
            // Use the real seed + duration the backend reports (it resolves a
            // random seed when none is locked) instead of fabricating 0/0.
            gen.setDone(res.image_url, res.seed ?? (fixedSeed ? seed : 0), res.duration_ms ?? 0)
            queryClient.invalidateQueries({ queryKey: ["gallery"] })
          },
          onError: (e: Error) => gen.setError(e.message),
        },
      )
      return
    }

    generate(buildReq())
  }

  const handleBatch = () => {
    batch.run(buildReq(), batchCount)
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
    // The workspace is BOUNDED (max 1480px) and centered: on very wide
    // windows the leftover width becomes gutters outside the app instead of
    // an oversized output column inside it. Within the workspace the input
    // panels get the generous widths (they're what the user works in); the
    // output column is the remainder (~800px at full size).
    <div className="h-full flex justify-center overflow-y-auto lg:overflow-hidden">
      <div className="min-h-full lg:h-full w-full max-w-[1480px] flex flex-col lg:flex-row overflow-visible lg:overflow-hidden border-x border-zinc-900">
      {/* ── 1. Settings — configure first (ordered by frequency of use) ──
           On phones it drops below the prompt (order-2): sensible defaults
           mean you rarely touch it before a first generation. */}
      <div className="order-2 lg:order-none w-full lg:w-[280px] shrink-0 border-t lg:border-t-0 lg:border-r border-zinc-800 flex flex-col bg-zinc-900/30 min-h-0">
        <Rail>
          <div className="p-4 space-y-4">
            <ModelStatusPanel />
            <Separator className="bg-zinc-800" />
            {/* Unified quality controls — the same component (steps · sampler ·
                CFG · Advanced) used in the editor's edit tabs, in "generate"
                mode (all controls apply here). Open by default on Generate. */}
            <QualityControls mode="generate" defaultOpen />

            <Separator className="bg-zinc-800" />
            {/* Artifact suppression — the on-model pseudo–negative-prompt. */}
            <ArtifactSuppression />

            <Separator className="bg-zinc-800" />
            <ResolutionPicker />
            <Separator className="bg-zinc-800" />
            <ModelVariantToggle />
            <LoraSection />
            <Separator className="bg-zinc-800" />
            <SeedControl />
          </div>
        </Rail>
      </div>

      {/* ── 2. Prompt — the primary work area, with the Generate bar.
           First thing on phones (order-1). ───── */}
      <div className="order-1 lg:order-none w-full lg:flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        <Rail>
          <div className="max-w-[620px] mx-auto p-5 space-y-4">
            {/* Templates + scene save/load */}
            <div className="flex justify-end">
              <PromptToolbar />
            </div>

            <FlowSection step={1} title="Style" hint="how should it look?">
              <StylePanel />
            </FlowSection>

            <FlowSection step={2} title="Describe" hint="what is the image?">
              <PromptBar />
              <Separator className="bg-zinc-800" />
              <HighLevelDescription />
              <BackgroundField />
            </FlowSection>

            <FlowSection step={3} title="Elements" hint="optional — exact objects & text">
              <ElementList />
            </FlowSection>

            {/* Validation warnings live with the prompt they describe */}
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
        </Rail>

        {/* Generate controls — pinned to the column bottom on desktop, and
            stuck to the viewport bottom on phones so Generate is always a thumb
            away while you work on the prompt. */}
        <div className="shrink-0 sticky bottom-0 z-20 lg:static px-4 py-2.5 border-t border-zinc-800 bg-zinc-900/95 lg:bg-zinc-900/50 backdrop-blur lg:backdrop-blur-none space-y-2">
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
                copyText(buildCaption(promptState, captionOpts)).then((ok) =>
                  ok ? toast.success("Caption JSON copied") : toast.error("Couldn't copy"))
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

          {/* Batch progress — surfaces model-loading status and per-image steps */}
          {batch.isRunning && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3 w-3" />
                  Image {batch.current} / {batch.total}
                </span>
                <span>
                  {batch.note
                    ? batch.note
                    : batch.stepTotal
                      ? `${batch.step} / ${batch.stepTotal} steps`
                      : "starting…"}
                </span>
              </div>
              <Progress
                value={
                  // Blend finished images with the current image's step progress
                  // so the bar always moves while a batch runs.
                  batch.stepTotal
                    ? Math.round(
                        ((batch.current - 1 + batch.step / batch.stepTotal) / batch.total) * 100,
                      )
                    : Math.round(((batch.current - 1) / batch.total) * 100)
                }
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
                Stop batch
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

          {/* Batch launch row — only when not running */}
          {!isRunning && !batch.isRunning && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-600 shrink-0">Batch:</span>

                {/* In-tool explanation of what Batch does */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="What is batch generation?"
                      className="text-zinc-600 hover:text-violet-300 transition-colors"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 bg-zinc-900 border-zinc-700 text-zinc-300">
                    <PopoverHeader>
                      <PopoverTitle className="text-zinc-100 text-sm flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-violet-400" />
                        Batch
                      </PopoverTitle>
                      <PopoverDescription className="text-zinc-400 text-xs leading-relaxed">
                        Renders several images from the <span className="text-zinc-200">same prompt and settings</span>,
                        each with a <span className="text-zinc-200">different random seed</span> — so you get a
                        spread of options to choose from instead of just one.
                      </PopoverDescription>
                    </PopoverHeader>
                    <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
                      <li>• Set <span className="text-zinc-200">how many</span> (1–{MAX_BATCH}) with the stepper, then press <span className="text-zinc-200">Run</span>.</li>
                      <li>• They render <span className="text-zinc-200">one at a time</span> — N images ≈ N× a single image's time.</li>
                      <li>• Click any result to make it the <span className="text-zinc-200">main image</span> (then upscale or edit it).</li>
                      <li>• Different from <span className="text-zinc-200">Generate</span>, which makes a single image using your seed setting.</li>
                    </ul>
                  </PopoverContent>
                </Popover>

                {/* Flexible count stepper — any value from 1 to MAX_BATCH */}
                <div className="flex items-center rounded border border-zinc-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setBatchCount(batchCount - 1)}
                    disabled={batchCount <= MIN_BATCH}
                    title="Fewer"
                    className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-violet-300 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <input
                    type="number"
                    min={MIN_BATCH}
                    max={MAX_BATCH}
                    value={batchCount}
                    onChange={(e) => setBatchCount(Number(e.target.value))}
                    className="w-8 h-5 bg-zinc-900 text-center text-[10px] text-violet-300 outline-none border-x border-zinc-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    aria-label="Batch size"
                  />
                  <button
                    type="button"
                    onClick={() => setBatchCount(batchCount + 1)}
                    disabled={batchCount >= MAX_BATCH}
                    title="More"
                    className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-violet-300 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-6 px-2 text-[10px] border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 gap-1.5 disabled:opacity-40"
                  onClick={handleBatch}
                  disabled={!canGenerate}
                  title={canGenerate
                    ? `Render ${batchCount} image${batchCount !== 1 ? "s" : ""} from this prompt, each with a different seed`
                    : "Describe your image first"}
                >
                  <Layers className="h-3 w-3" />
                  Run
                </Button>
              </div>
              <p className="text-[10px] text-zinc-600">
                Same prompt, {batchCount} different seed{batchCount !== 1 ? "s" : ""} — pick your favorite.
              </p>
            </div>
          )}

          {!canGenerate && !isRunning && !batch.isRunning && (
            <p className="text-[10px] text-zinc-600 text-center">
              Add a description, background, or element to enable Generate · Ctrl+Enter to run
            </p>
          )}
        </div>
      </div>

      {/* ── 3. Output — compact preview pane, never the dominant column.
           Drops to the bottom on phones (order-3). ── */}
      <div className="order-3 lg:order-none w-full lg:w-[400px] shrink-0 border-t lg:border-t-0 lg:border-l border-zinc-800 bg-zinc-900/20 flex flex-col min-h-0">
        <Rail>
          <div className="p-3 flex flex-col gap-3">
            {/* Layout canvas — opt-in (most generations never pin elements) */}
            {showCanvas ? (
              <div className="space-y-1.5">
                <BBoxCanvas />
                {hasPinnedElements && (
                  <p className="text-[10px] text-zinc-600 leading-snug px-1">
                    Tip: a <span className="text-zinc-400">wide</span> box zooms in on the subject;
                    a <span className="text-zinc-400">tall, narrow</span> box gives a full body.
                  </p>
                )}
                {!hasPinnedElements && (
                  <button
                    type="button"
                    onClick={() => setCanvasOpen(false)}
                    className="mx-auto flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Hide layout canvas
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCanvasOpen(true)}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 hover:border-zinc-600 text-zinc-600 hover:text-zinc-400 text-xs py-2 transition-colors"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Layout canvas
              </button>
            )}

            {/* Result: compact preview card — click for the lightbox */}
            {isDone && displayImageUrl && !batch.results.length && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-3 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="group relative block mx-auto"
                  title="Click to view full size"
                >
                  <img
                    src={displayImageUrl}
                    alt="Generated result"
                    className="max-h-[38vh] max-w-full rounded-lg object-contain shadow-lg"
                    draggable={false}
                  />
                  <span className="absolute inset-0 rounded-lg bg-zinc-950/0 group-hover:bg-zinc-950/30 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-zinc-200 bg-zinc-900/90 rounded-full px-3 py-1">
                      Click to enlarge
                    </span>
                  </span>
                </button>

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
                    download={`ideogram-${displaySeed ?? "output"}.png`}
                    className="ml-auto text-xs text-violet-400 hover:text-violet-300 underline"
                  >
                    Download PNG
                  </a>
                  {jobId && (
                    <Link
                      to={`/editor?job=${jobId}`}
                      className="text-xs text-violet-400 hover:text-violet-300 underline inline-flex items-center gap-1"
                    >
                      <Brush className="h-3 w-3" />
                      Edit
                    </Link>
                  )}
                </div>

                {/* Upscale controls */}
                <UpscaleStrip
                  jobId={jobId}
                  onUpscaled={(url, w, h) => {
                    setUpscaledUrl(url)
                    setUpscaledSize({ w, h })
                  }}
                />

                {/* Split into transparent layers (uses the prompt's boxes) */}
                <SplitLayersPanel
                  imageUrl={displayImageUrl}
                  promptJson={buildCaption(promptState, captionOpts)}
                  sourceJobId={jobId ?? undefined}
                />
              </div>
            )}

            {/* Result: variation selected */}
            {selectedVariation && (
              <div className="flex items-center gap-3 px-1 flex-wrap">
                <span className="text-xs text-zinc-500 font-mono">Seed: {selectedVariation.seed}</span>
                <span className="text-xs text-zinc-500">{(selectedVariation.durationMs / 1000).toFixed(1)}s</span>
                <span className="text-xs text-violet-400/70">batch image selected</span>
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

            {/* Recent generations fill the rest of the pane */}
            <RecentGrid />
          </div>
        </Rail>
      </div>

      {/* ── Lightbox for the current result ─────────────────────────────── */}
      {displayImageUrl && (
        <Lightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          imageUrl={displayImageUrl}
          downloadName={`ideogram-${displaySeed ?? "output"}.png`}
          editJobId={jobId}
          caption={[
            displaySeed != null ? `seed ${displaySeed}` : null,
            displayDurationMs != null ? `${(displayDurationMs / 1000).toFixed(1)}s` : null,
            upscaledSize ? `${upscaledSize.w}×${upscaledSize.h}` : null,
          ].filter(Boolean).join(" · ")}
        />
      )}
      </div>
    </div>
  )
}
