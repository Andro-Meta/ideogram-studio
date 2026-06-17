import { Slider } from "@/components/ui/slider"
import { useSettingsStore, CFG_MIN, CFG_MAX } from "@/stores/settingsStore"
import { CfgPresetPicker } from "./CfgPresetPicker"

/** CFG (guidance) controls: a row of preset curves plus, in Custom mode, the
 *  raw sliders. Ideogram 4 uses a "two CFG" dual-guidance — a main CFG for the
 *  first part of the run dropping to a lower override for the tail (smooths the
 *  result, reduces burn). The presets pick well-known curves; Custom exposes the
 *  exact values. Same control is also shown in the image editor. */
export function CfgControl() {
  const {
    cfgPreset, customCfg,
    cfg, setCfg,
    cfgOverride, setCfgOverride,
    cfgOverrideStart, setCfgOverrideStart,
  } = useSettingsStore()

  // "Override starts at 0.7" → the last 30% of steps run at the override CFG.
  const lastPct = Math.round((1 - cfgOverrideStart) * 100)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300">Guidance (CFG)</p>
      <CfgPresetPicker />

      {/* Live summary of what the selected preset does. */}
      {!customCfg ? (
        <p className="text-[10px] text-zinc-500 leading-snug">
          Using the sampler preset's built-in schedule.
        </p>
      ) : (
        cfgPreset !== "custom" && (
          <p className="text-[10px] text-zinc-500 leading-snug">
            {lastPct === 0
              ? `Constant CFG ${cfg.toFixed(1)}.`
              : `CFG ${cfg.toFixed(1)} for the first ${100 - lastPct}%, then ${cfgOverride.toFixed(1)} for the last ${lastPct}%.`}
          </p>
        )
      )}

      {/* Raw sliders only in Custom mode. */}
      {cfgPreset === "custom" && (
        <div className="space-y-3 border-l border-zinc-800 ml-1 pl-3 pt-1">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">CFG</span>
              <span className="text-[11px] font-mono text-zinc-300">{cfg.toFixed(1)}</span>
            </div>
            <Slider min={CFG_MIN} max={CFG_MAX} step={0.1} value={[cfg]}
              onValueChange={([v]) => setCfg(v)} aria-label="Main CFG" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Override CFG (tail)</span>
              <span className="text-[11px] font-mono text-zinc-300">{cfgOverride.toFixed(1)}</span>
            </div>
            <Slider min={CFG_MIN} max={CFG_MAX} step={0.1} value={[cfgOverride]}
              onValueChange={([v]) => setCfgOverride(v)} aria-label="Override CFG" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Drop point</span>
              <span className="text-[11px] font-mono text-zinc-300">last {lastPct}%</span>
            </div>
            <Slider min={0.3} max={1} step={0.05} value={[cfgOverrideStart]}
              onValueChange={([v]) => setCfgOverrideStart(v)} aria-label="CFG override start" />
            <p className="text-[10px] text-zinc-500 leading-snug">
              {lastPct === 0
                ? `Constant CFG ${cfg.toFixed(1)} (no drop).`
                : `CFG ${cfg.toFixed(1)} for the first ${100 - lastPct}%, then ${cfgOverride.toFixed(1)} for the last ${lastPct}%.`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
