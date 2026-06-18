import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import type { SamplerPreset } from "@/types/caption"
import { CfgPresetPicker } from "./CfgPresetPicker"

const QUALITY: { id: SamplerPreset; label: string; hint: string }[] = [
  { id: "V4_TURBO_12", label: "Fast", hint: "12 steps · ~15s" },
  { id: "V4_DEFAULT_20", label: "Standard", hint: "20 steps · ~25s" },
  { id: "V4_QUALITY_48", label: "High", hint: "48 steps · ~60s" },
]

/** Collapsible quality/sampler controls for an edit tool. Recommended defaults
 *  are pre-selected; everything is customizable. `showSampler` is false for the
 *  RePaint tools (Fill/Outpaint), where the solver/detail don't apply. */
export function QualityControls({ showSampler = true, showCfg = true }: { showSampler?: boolean; showCfg?: boolean }) {
  const [open, setOpen] = useState(false)
  const {
    editQuality, setEditQuality,
    editSampler, setEditSampler,
    editDetail, setEditDetail,
  } = useSettingsStore()

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Quality
        <span className="ml-auto text-[10px] text-zinc-600">
          {QUALITY.find((q) => q.id === editQuality)?.label}
          {showSampler && editSampler === "euler" && " · Euler"}
        </span>
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-2.5">
          {/* Steps / quality preset */}
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-500">Steps</p>
            <div className="grid grid-cols-3 gap-1">
              {QUALITY.map((q) => (
                <button
                  key={q.id} type="button" onClick={() => setEditQuality(q.id)} title={q.hint}
                  className={cn(
                    "rounded-md border px-1 py-1 text-[10px] font-medium transition-all",
                    editQuality === q.id ? "border-violet-500 bg-violet-500/10 text-violet-300"
                      : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sampler + detail (generative tools only) */}
          {showSampler && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">Sampler</p>
              <div className="grid grid-cols-2 gap-1">
                {([["res_multistep", "Res-multistep"], ["euler", "Euler"]] as const).map(([id, label]) => (
                  <button
                    key={id} type="button" onClick={() => setEditSampler(id)}
                    title={id === "res_multistep" ? "Sharper (recommended)" : "Faster / reproducible"}
                    className={cn(
                      "rounded-md border px-1 py-1 text-[10px] font-medium transition-all",
                      editSampler === id ? "border-violet-500 bg-violet-500/10 text-violet-300"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-0.5">
                <input type="checkbox" checked={editDetail}
                  onChange={(e) => setEditDetail(e.target.checked)}
                  disabled={editSampler !== "res_multistep"} className="accent-violet-500" />
                Detail boost (steadier, avoids the "blocked" card)
              </label>
            </div>
          )}

          {/* CFG */}
          {showCfg && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">Guidance (CFG)</p>
              <CfgPresetPicker />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
