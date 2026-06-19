import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore, cfgRequestFields, qualityRequestFields } from "@/stores/settingsStore"
import type { SamplerPreset } from "@/types/caption"
import { CfgPresetPicker } from "./CfgPresetPicker"

function NumIn({ label, value, onChange, placeholder, step, min, max }: {
  label: string; value: number | null; onChange: (v: number | null) => void
  placeholder?: string; step?: number; min?: number; max?: number
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase text-zinc-600">{label}</span>
      <input
        type="number" value={value ?? ""} placeholder={placeholder} step={step} min={min} max={max}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200"
      />
    </label>
  )
}

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
  const [adv, setAdv] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const {
    editQuality, setEditQuality,
    editSampler, setEditSampler,
    editDetail, setEditDetail,
    editSteps, editMu, editStd, editEisSteps, editEisStart, editEisEnd,
    setAdv: setAdvStore, resetAdv,
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

          {/* Advanced (ComfyUI-style) raw overrides */}
          <div className="rounded border border-zinc-800/80 bg-zinc-950/30">
            <button
              type="button" onClick={() => setAdv((a) => !a)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              {adv ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Advanced
            </button>
            {adv && (
              <div className="px-2 pb-2 space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  <NumIn label="steps" value={editSteps} placeholder="preset" step={1} min={4} max={60}
                    onChange={(v) => setAdvStore({ editSteps: v })} />
                  <NumIn label="mu" value={editMu} placeholder="auto" step={0.1}
                    onChange={(v) => setAdvStore({ editMu: v })} />
                  <NumIn label="std" value={editStd} placeholder="auto" step={0.05}
                    onChange={(v) => setAdvStore({ editStd: v })} />
                </div>
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">ExtendIntermediateSigmas</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <NumIn label="extra n" value={editEisSteps} step={1} min={1} max={8}
                    onChange={(v) => setAdvStore({ editEisSteps: v ?? 2 })} />
                  <NumIn label="σ start" value={editEisStart} step={0.01} min={0} max={1}
                    onChange={(v) => setAdvStore({ editEisStart: v ?? 1.0 })} />
                  <NumIn label="σ end" value={editEisEnd} step={0.01} min={0} max={1}
                    onChange={(v) => setAdvStore({ editEisEnd: v ?? 0.98 })} />
                </div>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setShowJson((s) => !s)}
                    className="text-[10px] text-violet-300/70 hover:text-violet-200">
                    {showJson ? "Hide" : "View"} request JSON
                  </button>
                  <button type="button" onClick={resetAdv} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                    Reset
                  </button>
                </div>
                {showJson && (
                  <pre className="text-[9px] leading-tight text-zinc-400 bg-zinc-950/60 rounded p-1.5 overflow-auto max-h-40">
                    {JSON.stringify({ ...cfgRequestFields(), ...qualityRequestFields() }, null, 2)}
                  </pre>
                )}
                <p className="text-[9px] text-zinc-600 leading-snug">
                  Empty = use the preset/default. Sampler/sigma overrides apply to the generative
                  modes (Insert/Reference) and generation; CFG &amp; steps apply everywhere.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
