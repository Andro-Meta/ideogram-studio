import { useRef, useState } from "react"
import { LayoutTemplate, Download, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { uid } from "@/lib/uid"
import { usePromptStore } from "@/stores/promptStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { PROMPT_TEMPLATES, TEMPLATE_CATEGORIES, type PromptTemplate } from "@/lib/promptTemplates"
import { buildScene, parseScene, downloadScene } from "@/lib/scenePreset"
import type { AnyElement } from "@/types/caption"

/** Assign fresh client ids to template/scene elements so they never collide. */
function withFreshIds(elements: AnyElement[]): AnyElement[] {
  return elements.map((el) => ({ ...el, id: uid() }) as AnyElement)
}

function TemplateGrid({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<string>("All")
  const list = cat === "All" ? PROMPT_TEMPLATES : PROMPT_TEMPLATES.filter((t) => t.category === cat)

  const load = (t: PromptTemplate) => {
    usePromptStore.getState().reset()
    usePromptStore.getState().loadFromParsed({
      ...t.state,
      elements: withFreshIds(t.state.elements),
    })
    if (t.resolution) {
      useSettingsStore.setState({
        width: t.resolution.width,
        height: t.resolution.height,
        ratioLabel: "",
      })
    }
    toast.success(`Loaded “${t.title}”`)
    onClose()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {["All", ...TEMPLATE_CATEGORIES].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-all",
              cat === c
                ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => load(t)}
            className="text-left rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 hover:border-violet-600/60 hover:bg-violet-500/5 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-100">{t.title}</span>
              <span className="text-[9px] uppercase tracking-wider text-violet-300/70 border border-violet-700/40 rounded px-1.5 py-0.5">
                {t.category}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">{t.summary}</p>
            <p className="mt-1.5 text-[10px] text-zinc-600">
              {t.state.elements.length} element{t.state.elements.length === 1 ? "" : "s"}
              {t.resolution && ` · ${t.resolution.width}×${t.resolution.height}`}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Toolbar above the prompt: a built-in template library plus scene save/load.
 * Templates seed a complete scene; Save/Load round-trip the whole scene (prompt
 * + layout + generation settings) as a portable `.ideoscene.json` file.
 */
export function PromptToolbar() {
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const saveScene = () => {
    const p = usePromptStore.getState()
    const s = useSettingsStore.getState()
    const scene = buildScene(
      {
        high_level_description: p.high_level_description,
        style_description: p.style_description,
        background: p.background,
        elements: p.elements,
      },
      {
        width: s.width, height: s.height, samplerPreset: s.samplerPreset,
        megapixels: s.megapixels, ratioLabel: s.ratioLabel,
        customCfg: s.customCfg, cfg: s.cfg, cfgOverride: s.cfgOverride,
        cfgOverrideStart: s.cfgOverrideStart,
        fixedSeed: s.fixedSeed, seed: s.seed,
      },
      {
        artifactSuppression: s.artifactSuppression,
        artifactCategoryIds: s.artifactCategoryIds,
        artifactCustom: s.artifactCustom,
      },
    )
    const name = p.high_level_description.trim().slice(0, 40) || "scene"
    downloadScene(scene, name)
    toast.success("Scene saved")
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-loading the same file
    if (!file) return
    try {
      const scene = parseScene(await file.text())
      usePromptStore.getState().reset()
      usePromptStore.getState().loadFromParsed({
        ...scene.prompt,
        elements: withFreshIds(scene.prompt.elements),
      })
      const g = scene.generation ?? {}
      const c = scene.constraints ?? {}
      useSettingsStore.setState({
        ...(g.width ? { width: g.width } : {}),
        ...(g.height ? { height: g.height } : {}),
        ...(g.samplerPreset ? { samplerPreset: g.samplerPreset } : {}),
        ...(typeof g.megapixels === "number" ? { megapixels: g.megapixels } : {}),
        ...(typeof g.ratioLabel === "string" ? { ratioLabel: g.ratioLabel } : {}),
        ...(typeof g.customCfg === "boolean" ? { customCfg: g.customCfg } : {}),
        ...(typeof g.cfg === "number" ? { cfg: g.cfg } : {}),
        ...(typeof g.cfgOverride === "number" ? { cfgOverride: g.cfgOverride } : {}),
        ...(typeof g.cfgOverrideStart === "number" ? { cfgOverrideStart: g.cfgOverrideStart } : {}),
        ...(typeof g.fixedSeed === "boolean" ? { fixedSeed: g.fixedSeed } : {}),
        ...(typeof g.seed === "number" ? { seed: g.seed } : {}),
        ...(typeof c.artifactSuppression === "boolean" ? { artifactSuppression: c.artifactSuppression } : {}),
        // Only overwrite the category selection when the scene actually carries
        // one — a legacy/partial scene must not silently reset it to defaults.
        ...(Array.isArray(c.artifactCategoryIds) ? { artifactCategoryIds: c.artifactCategoryIds } : {}),
        ...(typeof c.artifactCustom === "string" ? { artifactCustom: c.artifactCustom } : {}),
      })
      toast.success("Scene loaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load scene file")
    }
  }

  const btn =
    "flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-violet-600/60 hover:text-violet-200 transition-colors"

  return (
    <div className="flex items-center gap-1.5">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className={btn} title="Start from a built-in template">
            <LayoutTemplate className="h-3.5 w-3.5 text-violet-400/80" />
            Templates
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Template library</DialogTitle>
            <DialogDescription>
              Start from a ready-made structured caption — edit anything after loading.
            </DialogDescription>
          </DialogHeader>
          <TemplateGrid onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>

      <button type="button" className={btn} onClick={saveScene} title="Save this scene to a file">
        <Download className="h-3.5 w-3.5" />
        Save
      </button>

      <button type="button" className={btn} onClick={() => fileRef.current?.click()} title="Load a saved scene file">
        <Upload className="h-3.5 w-3.5" />
        Load
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.ideoscene.json,application/json"
        onChange={onFile}
        className="hidden"
      />
    </div>
  )
}
