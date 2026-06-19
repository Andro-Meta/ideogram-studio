import { useCallback, useEffect, useState } from "react"
import {
  Hand, Square, Circle, Lasso, Brush, Wand2, Undo2, Redo2,
  Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown, X, Save,
  Loader2, SquareDashed, FlipHorizontal2, Layers, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useSaveEdit } from "@/hooks/useSaveEdit"
import { useInpaint } from "@/hooks/useInpaint"
import { useInsert } from "@/hooks/useInsert"
import { useReferenceEdit } from "@/hooks/useReferenceEdit"
import { useExtend, type Pads } from "@/hooks/useExtend"
import { OutpaintPanel } from "./OutpaintPanel"
import { useDescribeImage } from "@/hooks/useDescribeImage"
import { usePreviewCaption } from "@/hooks/usePreviewCaption"
import { useModelStatus } from "@/hooks/useModelStatus"
import { QualityControls } from "@/components/controls/QualityControls"
import { CaptionJsonPanel } from "@/components/controls/CaptionJsonPanel"
import { useEditorEngine } from "./useEditorEngine"
import { EditorStage } from "./EditorStage"
import type { Adjustments, ToolId } from "./editorTypes"
import { IDENTITY_ADJUSTMENTS } from "./editorTypes"

interface Props {
  open: boolean
  onClose: () => void
  jobId: string
  imageUrl: string
}

const TOOLS: { id: ToolId; icon: typeof Hand; label: string; key: string }[] = [
  { id: "pan",             icon: Hand,   label: "Pan / zoom",        key: "H" },
  { id: "marquee-rect",    icon: Square, label: "Rectangle select",  key: "M" },
  { id: "marquee-ellipse", icon: Circle, label: "Ellipse select",    key: "E" },
  { id: "lasso",           icon: Lasso,  label: "Lasso select",      key: "L" },
  { id: "brush",           icon: Brush,  label: "Brush select",      key: "B" },
  { id: "wand",            icon: Wand2,  label: "Magic wand",        key: "W" },
]

const ADJUSTMENT_SLIDERS: {
  key: keyof Adjustments; label: string; min: number; max: number; step: number; fmt: (v: number) => string
}[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: "contrast",   label: "Contrast",   min: 0.2, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: "saturation", label: "Saturation", min: 0,   max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: "hue",        label: "Hue shift",  min: -180, max: 180, step: 5,   fmt: (v) => `${v}°` },
  { key: "blur",       label: "Blur",       min: 0,   max: 20,  step: 0.5,  fmt: (v) => `${v}px` },
]

/**
 * Layered regional editor: make a selection (rectangle / ellipse / lasso /
 * brush / magic wand), turn it into a non-destructive adjustment layer, and
 * tune the layer. The canvas preview IS the saved output (client flatten).
 */
export function EditorDialog({ open, onClose, jobId, imageUrl }: Props) {
  // Editing the live URL lets an AI fill swap the canvas to its result.
  const [liveUrl, setLiveUrl] = useState(imageUrl)
  useEffect(() => setLiveUrl(imageUrl), [imageUrl])
  const engine = useEditorEngine(liveUrl, open)
  const save = useSaveEdit()
  const inpaint = useInpaint()
  const insert = useInsert()
  const reference = useReferenceEdit()
  const extend = useExtend()
  const describe = useDescribeImage()
  const preview = usePreviewCaption()
  const { data: modelStatus } = useModelStatus()
  const canInpaint = modelStatus?.status === "ready" && !!modelStatus?.supports_inpaint

  const [tool, setTool] = useState<ToolId>("marquee-rect")
  const [brushSize, setBrushSize] = useState(48)
  const [brushSoftness, setBrushSoftness] = useState(0.5)
  const [brushErase, setBrushErase] = useState(false)
  const [wandTolerance, setWandTolerance] = useState(32)
  const [feather, setFeather] = useState(4)
  const [zoom, setZoom] = useState(1)
  const [fillPrompt, setFillPrompt] = useState("")
  // Hand-edited caption JSON — sent verbatim instead of the instruction text.
  const [editCaptionOverride, setEditCaptionOverride] = useState<string | null>(null)
  // A run is valid with either an instruction OR an edited-JSON override.
  const hasPrompt = !!editCaptionOverride || !!fillPrompt.trim()
  const [fillStrength, setFillStrength] = useState(0.6)
  const [insertBlend, setInsertBlend] = useState(0.45)
  // Which AI edit tool is active. Each does a different job (see the tab copy):
  // fill = change/restyle/remove existing content; insert = add a NEW object;
  // extend = outpaint to a new ratio; reference = experimental LoRA edit.
  const [editMode, setEditMode] = useState<"fill" | "insert" | "extend" | "reference">("fill")
  // Off by default — Ideogram's own guidance is not to let Magic Prompt rewrite
  // an edit instruction. When off, the backend builds a grounded JSON caption.
  const [magicPrompt, setMagicPrompt] = useState(false)

  // Suggest a starting prompt by describing the current image (the same
  // grounding the backend applies automatically), so the user can edit it.
  const handleSuggestPrompt = async () => {
    if (describe.isPending || !engine.base) return
    try {
      const blob = await engine.flatten()
      const prompt = await describe.mutateAsync(blob)
      if (prompt) setFillPrompt(prompt)
    } catch (err) {
      console.error(err)
    }
  }

  // Build the exact JSON caption this edit would send (for the CaptionJsonPanel),
  // via the same grounded path the backend uses — so view == send.
  const rebuildCaption = async () => {
    if (!engine.base || preview.isPending) return
    try {
      const blob = await engine.flatten()
      const buf = await blob.arrayBuffer()
      let bin = ""
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      preview.mutate({
        image_b64: btoa(bin),
        prompt: editCaptionOverride ?? fillPrompt.trim(),
        width: engine.base.width,
        height: engine.base.height,
        preserve: !!engine.selection,        // a selection has surroundings to blend into
        ground: true,
        magic_prompt: magicPrompt,
      })
    } catch (err) {
      console.error(err)
    }
  }

  const handleInpaint = async () => {
    if (!hasPrompt || inpaint.isPending || !engine.base) return
    // With a selection → Magic Fill that region. Without → Remix the whole
    // image (a full-white mask makes the entire image editable).
    let maskCanvas = engine.selection
    if (!maskCanvas) {
      maskCanvas = document.createElement("canvas")
      maskCanvas.width = engine.base.width
      maskCanvas.height = engine.base.height
      const c = maskCanvas.getContext("2d")!
      c.fillStyle = "#ffffff"
      c.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
    }
    const whole = !engine.selection
    try {
      const blob = await engine.flatten()
      inpaint.mutate(
        { imageBlob: blob, maskCanvas, prompt: editCaptionOverride ?? fillPrompt.trim(),
          strength: fillStrength, sourceJobId: jobId, magicPrompt },
        {
          onSuccess: (res) => {
            toast.success(whole ? "Image remixed" : "Region filled")
            if (res.grounded === false) {
              toast.warning("Fill wasn't grounded in your image — add an OpenRouter key in Settings for the region to match its surroundings.")
            }
            setLiveUrl(`${res.image_url}?t=${res.job_id}`)   // reload editor with the result
          },
        },
      )
    } catch (err) {
      console.error(err)
      toast.error("Could not prepare the image")
    }
  }

  const handleInsert = async () => {
    if (!hasPrompt || insert.isPending || !engine.base) return
    // Insert REQUIRES a selection — it places the object inside that region.
    if (!engine.selection) {
      toast.error("Select where the object should go first (draw a region).")
      return
    }
    try {
      const blob = await engine.flatten()
      insert.mutate(
        { imageBlob: blob, maskCanvas: engine.selection, prompt: editCaptionOverride ?? fillPrompt.trim(),
          blend: insertBlend, sourceJobId: jobId },
        {
          onSuccess: (res) => {
            toast.success("Object inserted")
            if (res.grounded === false) {
              toast.warning("Insert wasn't grounded — add an OpenRouter key in Settings so the object matches the scene's lighting.")
            }
            setLiveUrl(`${res.image_url}?t=${res.job_id}`)
          },
        },
      )
    } catch (err) {
      console.error(err)
      toast.error("Could not prepare the image")
    }
  }

  const handleReference = async () => {
    if (!hasPrompt || reference.isPending || !engine.base) return
    if (!engine.selection) {
      toast.error("Select the region to edit first (draw a selection).")
      return
    }
    try {
      const blob = await engine.flatten()
      reference.mutate(
        { imageBlob: blob, maskCanvas: engine.selection, prompt: editCaptionOverride ?? fillPrompt.trim(), sourceJobId: jobId },
        {
          onSuccess: (res) => {
            toast.success("Reference edit applied")
            if (res.grounded === false) {
              toast.warning("Edit wasn't grounded — add an OpenRouter key in Settings so it matches the scene.")
            }
            setLiveUrl(`${res.image_url}?t=${res.job_id}`)
          },
        },
      )
    } catch (err) {
      console.error(err)
      toast.error("Could not prepare the image")
    }
  }

  const busy = inpaint.isPending || insert.isPending || reference.isPending || extend.isPending
  const handleExtend = async (pads: Pads) => {
    if (busy || !engine.base) return
    try {
      const blob = await engine.flatten()
      extend.mutate(
        { imageBlob: blob, pads, prompt: editCaptionOverride ?? fillPrompt.trim(), sourceJobId: jobId },
        {
          onSuccess: (res) => {
            toast.success("Canvas outpainted")
            if (res.grounded === false) {
              toast.warning("Extend wasn't grounded in your image — add an OpenRouter key in Settings for the new area to match the scene.")
            }
            setLiveUrl(`${res.image_url}?t=${res.job_id}`)
          },
        },
      )
    } catch (err) {
      console.error(err)
      toast.error("Could not prepare the image")
    }
  }

  // ── keyboard shortcuts ──────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const inInput = (e.target as HTMLElement).tagName === "INPUT"
    if (inInput) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); engine.undo(); return }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); engine.redo(); return }
    if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); engine.deselect(); return }
    if ((e.ctrlKey || e.metaKey) && k === "i") { e.preventDefault(); engine.invertSelection(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const toolHit = TOOLS.find((t) => t.key.toLowerCase() === k)
    if (toolHit) { setTool(toolHit.id) }
  }, [engine])

  // reset transient tool state when (re)opened
  useEffect(() => {
    if (open) { setTool("marquee-rect"); setBrushErase(false) }
  }, [open])

  const handleSave = async () => {
    try {
      const blob = await engine.flatten()
      save.mutate(
        { sourceJobId: jobId, blob },
        { onSuccess: () => onClose() },
      )
    } catch (err) {
      console.error(err)
    }
  }

  const active = engine.activeLayer

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="!max-w-[96vw] !w-[96vw] !h-[92vh] bg-zinc-900 border-zinc-700 p-0 overflow-hidden flex flex-col gap-0"
        onKeyDown={onKeyDown}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-medium text-zinc-200">Image Editor</h3>
            <span className="text-[11px] text-zinc-600">
              {engine.base ? `${engine.base.width} × ${engine.base.height}px` : "loading…"}
              {" · "}{Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
              disabled={!engine.canUndo}
              onClick={engine.undo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
              disabled={!engine.canRedo}
              onClick={engine.redo}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-5 bg-zinc-700 mx-1" />
            <Button
              size="sm"
              className="h-7 bg-violet-600 hover:bg-violet-500 text-white text-xs gap-1.5 disabled:opacity-40"
              disabled={!engine.dirty || save.isPending || !engine.base}
              onClick={handleSave}
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save as Copy
            </Button>
            <button onClick={onClose} className="ml-1 text-zinc-500 hover:text-zinc-300" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* ── Tool rail ── */}
          <div className="w-12 border-r border-zinc-700 flex flex-col items-center py-2 gap-1 shrink-0">
            {TOOLS.map(({ id, icon: Icon, label, key }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                title={`${label} (${key})`}
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center transition-all",
                  tool === id
                    ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/50"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <div className="w-6 h-px bg-zinc-700 my-1" />
            <button
              type="button"
              onClick={engine.invertSelection}
              disabled={!engine.base}
              title="Invert selection (Ctrl+I)"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
            >
              <FlipHorizontal2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={engine.deselect}
              disabled={!engine.hasSelection}
              title="Deselect (Ctrl+D)"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
            >
              <SquareDashed className="h-4 w-4" />
            </button>
          </div>

          {/* ── Stage ── */}
          {engine.loadError ? (
            <div className="flex-1 flex items-center justify-center text-sm text-red-400">
              {engine.loadError}
            </div>
          ) : (
            <EditorStage
              composite={engine.compositeCanvas}
              selection={engine.selection}
              tool={tool}
              brushSize={brushSize}
              brushSoftness={brushSoftness}
              brushErase={brushErase}
              wandTolerance={wandTolerance}
              onSelectionShape={engine.applySelectionShape}
              onZoomChange={setZoom}
            />
          )}

          {/* ── Right panel ── */}
          <div className="w-72 border-l border-zinc-700 flex flex-col shrink-0 overflow-y-auto">
            {/* Tool options */}
            <div className="p-3 border-b border-zinc-800 space-y-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Tool options</p>
              {tool === "brush" && (
                <>
                  <LabeledSlider label="Brush size" value={brushSize} min={4} max={300} step={2}
                    fmt={(v) => `${v}px`} onChange={setBrushSize} />
                  <LabeledSlider label="Softness" value={brushSoftness} min={0} max={1} step={0.05}
                    fmt={(v) => `${Math.round(v * 100)}%`} onChange={setBrushSoftness} />
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={brushErase} onChange={(e) => setBrushErase(e.target.checked)}
                      className="accent-violet-500" />
                    Erase mode (remove from selection)
                  </label>
                </>
              )}
              {tool === "wand" && (
                <LabeledSlider label="Tolerance" value={wandTolerance} min={4} max={120} step={2}
                  fmt={(v) => `${v}`} onChange={setWandTolerance} />
              )}
              {(tool === "marquee-rect" || tool === "marquee-ellipse" || tool === "lasso") && (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Drag to select. <kbd className="text-zinc-400">Shift</kbd> adds,{" "}
                  <kbd className="text-zinc-400">Alt</kbd> subtracts.
                </p>
              )}
              {tool === "pan" && (
                <p className="text-[11px] text-zinc-500">Drag to pan · scroll to zoom (works with any tool)</p>
              )}
              <LabeledSlider label="Feather (on layer create)" value={feather} min={0} max={50} step={1}
                fmt={(v) => `${v}px`} onChange={setFeather} />
            </div>

            {/* AI Edit — tabbed: Fill / Insert / Extend / Reference. Each is a
                different tool because the base model is text-to-image only, so no
                single mechanism does everything well (see each tab's copy). */}
            <div className="p-3 border-b border-zinc-800 space-y-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-400" />
                AI Edit
              </p>
              {canInpaint ? (
                <>
                  {/* Sub-tabs */}
                  <div className="grid grid-cols-4 gap-1">
                    {([["fill", "Fill"], ["insert", "Insert"], ["extend", "Outpaint"], ["reference", "Reference"]] as const).map(([id, label]) => (
                      <button
                        key={id} type="button" onClick={() => setEditMode(id)}
                        className={cn(
                          "rounded-md border px-1 py-1 text-[10px] font-medium transition-all",
                          editMode === id
                            ? "border-violet-500 bg-violet-500/10 text-violet-300"
                            : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* What this tool is for */}
                  <p className="text-[10px] text-zinc-500 leading-snug">
                    {editMode === "fill" && "Change or restyle what's already in the selection, or remove something (fills with the surroundings). Best for editing existing content — not adding brand-new objects."}
                    {editMode === "insert" && "Add a NEW object into the selection (a dog, a tree, a car). Generates the object and blends it in. Best when the thing isn't there yet."}
                    {editMode === "extend" && "Outpaint: grow the canvas to a new aspect ratio and continue the scene outward. Your original stays exact."}
                    {editMode === "reference" && "Precise in-place edit (experimental). Regenerates the frame faithful to the original and changes the selection — the rest stays. Best for altering an existing thing (a dog's breed, a shirt's colour). Uses a community LoRA; results can be rough."}
                  </p>

                  {/* Shared prompt (all modes use it; optional continuation for Extend) */}
                  {(
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-500">
                          {editMode === "extend" ? "Continuation prompt (optional)" : editMode === "insert" ? "What to add" : editMode === "reference" ? "What to change it to" : "Edit prompt"}
                        </span>
                        <button
                          type="button" onClick={handleSuggestPrompt}
                          disabled={describe.isPending || !engine.base}
                          className="text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40 flex items-center gap-1"
                          title="Describe the current image to seed a prompt you can edit"
                        >
                          {describe.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          Suggest from image
                        </button>
                      </div>
                      <Textarea
                        value={fillPrompt}
                        onChange={(e) => setFillPrompt(e.target.value)}
                        placeholder={
                          editMode === "insert" ? "Describe the object to add (e.g. a golden retriever sitting)…"
                          : editMode === "extend" ? "Optional: what the new area should contain…"
                          : editMode === "reference" ? "Describe what the selection should become (e.g. a black border collie)…"
                          : engine.hasSelection ? "Describe how to change the selected area…"
                          : "Describe how to change the whole image…"}
                        rows={3} disabled={busy}
                        className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none"
                      />
                      {/* The exact caption JSON this edit will send — same panel as
                          Generate. Rebuild grounds it in the image; Edit overrides it. */}
                      <CaptionJsonPanel
                        caption={preview.data?.caption ?? ""}
                        loading={preview.isPending}
                        override={editCaptionOverride}
                        onOverride={setEditCaptionOverride}
                        onRefresh={rebuildCaption}
                      />
                    </>
                  )}

                  {/* FILL */}
                  {editMode === "fill" && (
                    <>
                      <LabeledSlider
                        label="Change amount" value={fillStrength}
                        min={0.2} max={1} step={0.05}
                        fmt={(v) => v >= 0.95 ? "full regen" : `${Math.round(v * 100)}%`}
                        onChange={setFillStrength}
                      />
                      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                        <input type="checkbox" checked={magicPrompt}
                          onChange={(e) => setMagicPrompt(e.target.checked)} className="accent-violet-500" />
                        Magic Prompt (rewrite my instruction)
                      </label>
                      <QualityControls mode="fill" />
                      <Button
                        className="w-full bg-violet-600 hover:bg-violet-500 text-white gap-2 disabled:opacity-40"
                        disabled={!hasPrompt || busy || !engine.base}
                        onClick={handleInpaint}
                        title={engine.hasSelection ? "Regenerate the selected area" : "Remix the whole image from your prompt"}
                      >
                        {inpaint.isPending
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Working… (~30-60s)</>
                          : <><Sparkles className="h-4 w-4" /> {engine.hasSelection ? "Generate Fill" : "Remix Whole Image"}</>}
                      </Button>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        {engine.hasSelection
                          ? "Only the selection changes; the rest is kept exactly. Low change amount = subtle edit; high = reinvents freely."
                          : "No selection → the whole image is reimagined. Select an area to change only part of it."}
                      </p>
                    </>
                  )}

                  {/* INSERT */}
                  {editMode === "insert" && (
                    <>
                      <LabeledSlider
                        label="Blend into scene" value={insertBlend}
                        min={0.3} max={0.7} step={0.05}
                        fmt={(v) => `${Math.round(v * 100)}%`}
                        onChange={setInsertBlend}
                      />
                      <QualityControls mode="insert" />
                      <Button
                        className="w-full bg-violet-600 hover:bg-violet-500 text-white gap-2 disabled:opacity-40"
                        disabled={!hasPrompt || busy || !engine.base || !engine.hasSelection}
                        onClick={handleInsert}
                        title={engine.hasSelection ? "Generate the object and place it in the selection" : "Select where the object should go first"}
                      >
                        {insert.isPending
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Working… (~1-2 min)</>
                          : <><Sparkles className="h-4 w-4" /> Insert Object</>}
                      </Button>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        {engine.hasSelection
                          ? "The object is generated, cut out, dropped into the selection (resting on the ground), then refined to match the scene's light. Higher blend reworks it more to fit."
                          : "Draw a selection where the object should go — Insert needs a place to put it."}
                      </p>
                    </>
                  )}

                  {/* EXTEND */}
                  {editMode === "extend" && engine.base && (
                    <>
                      <OutpaintPanel
                        baseW={engine.base.width} baseH={engine.base.height} imageSrc={liveUrl}
                        busy={busy} pending={extend.isPending} onExtend={handleExtend}
                      />
                      <QualityControls mode="outpaint" />
                    </>
                  )}

                  {/* REFERENCE — precise in-place edit via the inpaint LoRA */}
                  {editMode === "reference" && (
                    <>
                      <QualityControls mode="reference" />
                      <Button
                        className="w-full bg-violet-600 hover:bg-violet-500 text-white gap-2 disabled:opacity-40"
                        disabled={!hasPrompt || busy || !engine.base || !engine.hasSelection}
                        onClick={handleReference}
                        title={engine.hasSelection ? "Edit the selection in place, keeping the rest faithful" : "Select the region to edit first"}
                      >
                        {reference.isPending
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Working… (~2-3 min)</>
                          : <><Sparkles className="h-4 w-4" /> Reference Edit</>}
                      </Button>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        {engine.hasSelection
                          ? "Regenerates the frame conditioned on your image (via the BitPoet inpaint LoRA) and changes the selection; the rest is kept from the original. Loads the LoRA on demand, so the first run is slower. Experimental — results can be rough."
                          : "Draw a selection around the thing you want to change — Reference edits that region in place."}
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  AI editing needs a diffusers model in memory. Load <span className="text-zinc-400">NF4·D</span> or
                  BF16 on the Generate tab, then come back.
                </p>
              )}
            </div>

            {/* Layers */}
            <div className="p-3 border-b border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Layers</p>
                <Button
                  size="sm" variant="outline"
                  className="h-6 text-[11px] gap-1 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2"
                  disabled={!engine.base}
                  onClick={() => engine.addLayer(feather)}
                  title={engine.hasSelection
                    ? "New adjustment layer from the current selection"
                    : "New adjustment layer covering the whole image"}
                >
                  <Plus className="h-3 w-3" />
                  {engine.hasSelection ? "From selection" : "Whole image"}
                </Button>
              </div>

              {engine.layers.length === 0 && (
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  Make a selection, then add a layer — adjustments only apply
                  inside it. Without a selection the layer covers everything.
                </p>
              )}

              <div className="space-y-1">
                {[...engine.layers].reverse().map((layer) => {
                  const isActive = layer.id === engine.activeLayerId
                  return (
                    <div
                      key={layer.id}
                      onClick={() => engine.setActiveLayerId(layer.id)}
                      className={cn(
                        "group flex items-center gap-1.5 rounded-md border px-2 py-1.5 cursor-pointer transition-all",
                        isActive
                          ? "border-violet-500/60 bg-violet-500/10"
                          : "border-zinc-700/60 bg-zinc-800/40 hover:border-zinc-600",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); engine.patchLayer(layer.id, { visible: !layer.visible }) }}
                        className="text-zinc-500 hover:text-zinc-200"
                        title={layer.visible ? "Hide layer" : "Show layer"}
                      >
                        {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <span className={cn("flex-1 text-[11px] truncate", isActive ? "text-violet-200" : "text-zinc-300")}>
                        {layer.name}
                      </span>
                      <span className="text-[10px] text-zinc-600">{Math.round(layer.opacity * 100)}%</span>
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <button type="button" title="Move up"
                          onClick={(e) => { e.stopPropagation(); engine.moveLayer(layer.id, 1) }}
                          className="text-zinc-500 hover:text-zinc-200"><ChevronUp className="h-3 w-3" /></button>
                        <button type="button" title="Move down"
                          onClick={(e) => { e.stopPropagation(); engine.moveLayer(layer.id, -1) }}
                          className="text-zinc-500 hover:text-zinc-200"><ChevronDown className="h-3 w-3" /></button>
                        <button type="button" title="Delete layer"
                          onClick={(e) => { e.stopPropagation(); engine.removeLayer(layer.id) }}
                          className="text-zinc-500 hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Active layer adjustments */}
            <div className="p-3 space-y-3 flex-1">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                {active ? `Adjustments — ${active.name}` : "Adjustments"}
              </p>
              {!active && (
                <p className="text-[11px] text-zinc-600">Select or create a layer to adjust it.</p>
              )}
              {active && (
                <>
                  {ADJUSTMENT_SLIDERS.map(({ key, label, min, max, step, fmt }) => (
                    <LabeledSlider
                      key={key}
                      label={label}
                      value={active.adjustments[key]}
                      min={min} max={max} step={step} fmt={fmt}
                      onChange={(v) =>
                        engine.previewAdjustments(active.id, { ...active.adjustments, [key]: v })}
                      onCommit={(v) =>
                        engine.commitAdjustments(active.id, { ...active.adjustments, [key]: v })}
                    />
                  ))}
                  <LabeledSlider
                    label="Layer opacity"
                    value={active.opacity}
                    min={0} max={1} step={0.05}
                    fmt={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => engine.previewLayerPatch(active.id, { opacity: v })}
                    onCommit={(v) => engine.patchLayer(active.id, { opacity: v })}
                  />
                  <Button
                    size="sm" variant="outline"
                    className="w-full h-7 text-[11px] border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                    onClick={() =>
                      engine.commitAdjustments(active.id, { ...IDENTITY_ADJUSTMENTS })}
                  >
                    Reset adjustments
                  </Button>
                </>
              )}

              <p className="text-[10px] text-zinc-600 leading-relaxed pt-2">
                Saved as a new gallery copy — the original stays untouched.
                These adjustment layers are exact, local pixel edits; use AI Edit
                above for generative region fills and Extend for outpainting.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LabeledSlider({
  label, value, min, max, step, fmt, onChange, onCommit,
}: {
  label: string
  value: number
  min: number; max: number; step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
  onCommit?: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">{label}</span>
        <span className="text-[10px] text-zinc-500 tabular-nums">{fmt(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={onCommit ? ([v]) => onCommit(v) : undefined}
      />
    </div>
  )
}
