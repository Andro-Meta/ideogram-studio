import { Zap, Square, RotateCcw, AlertTriangle, Loader2 } from "lucide-react"
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
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { useGenerationStore } from "@/stores/generationStore"
import { useGenerate } from "@/hooks/useGenerate"
import { useModelStatus } from "@/hooks/useModelStatus"
import { buildCaption, validatePromptState } from "@/lib/caption"

function ModelStatusBadge() {
  const { data } = useModelStatus()
  const status = data?.status ?? "unloaded"
  const variant = data?.variant

  const colors: Record<string, string> = {
    ready:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
    loading:  "bg-amber-500/20  text-amber-300  border-amber-500/50",
    unloaded: "bg-zinc-700/50   text-zinc-400   border-zinc-600",
    error:    "bg-red-500/20    text-red-300    border-red-500/50",
  }

  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded border text-[11px]", colors[status])}>
      {status === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="capitalize">{status}</span>
      {variant && <span className="opacity-60">({variant.toUpperCase()})</span>}
    </div>
  )
}

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

export function Generate() {
  const promptState = usePromptStore()
  const { modelVariant, samplerPreset, width, height, fixedSeed, seed } = useSettingsStore()
  const { status, progress, resultImageUrl, resultSeed, resultDurationMs, errorMessage } = useGenerationStore()
  const { generate, cancel } = useGenerate()

  const warnings = validatePromptState(promptState)
  const isRunning = status === "running" || status === "loading-model"
  const isDone = status === "done"

  const handleGenerate = () => {
    const promptJson = buildCaption(promptState)
    generate({
      prompt_json: promptJson,
      height,
      width,
      sampler_preset: samplerPreset,
      seed: fixedSeed ? seed : null,
      model_variant: modelVariant,
    })
  }

  const progressPct = progress ? Math.round((progress.step / progress.total) * 100) : 0

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left panel: Prompt building ── */}
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

      {/* ── Center: Canvas + Generate controls ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Canvas */}
          <BBoxCanvas />

          {/* Result metadata strip */}
          {isDone && resultImageUrl && (
            <div className="flex items-center gap-3 px-1">
              {resultSeed != null && (
                <span className="text-xs text-zinc-500 font-mono">Seed: {resultSeed}</span>
              )}
              {resultDurationMs != null && (
                <span className="text-xs text-zinc-500">
                  {(resultDurationMs / 1000).toFixed(1)}s
                </span>
              )}
              <a
                href={resultImageUrl}
                download={`ideogram-${resultSeed ?? "output"}.png`}
                className="ml-auto text-xs text-violet-400 hover:text-violet-300 underline"
              >
                Download PNG
              </a>
            </div>
          )}

          {/* Error message */}
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

        {/* Generate button + progress — pinned to bottom */}
        <div className="shrink-0 p-4 border-t border-zinc-800 bg-zinc-900/50 space-y-3">
          {isRunning && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>{status === "loading-model" ? "Loading model…" : "Generating…"}</span>
                {progress && (
                  <span>{progress.step} / {progress.total} steps</span>
                )}
              </div>
              <Progress
                value={status === "loading-model" ? null : progressPct}
                className="h-1.5 bg-zinc-700"
              />
            </div>
          )}

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
            ) : (
              <>
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold gap-2 shadow-lg shadow-violet-500/20"
                  onClick={handleGenerate}
                >
                  <Zap className="h-4 w-4" />
                  {isDone ? "Regenerate" : "Generate"}
                </Button>
                {isDone && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                    onClick={() => useGenerationStore.getState().reset()}
                    title="Clear result"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Right panel: Generation settings ── */}
      <div className="w-60 shrink-0 border-l border-zinc-800 bg-zinc-900/30 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Model status */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Status</p>
              <ModelStatusBadge />
            </div>

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
