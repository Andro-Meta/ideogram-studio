import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { useSettingsStore, CFG_MIN, CFG_MAX } from "@/stores/settingsStore"

/** Custom CFG (guidance) controls.
 *
 *  The Banodoco / ComfyUI community found Ideogram 4's official CFG of 7.0 is
 *  too high — it burns and splotches photos — and that a "CFG override" (a high
 *  value early, dropping to a low value for the final stretch of steps) gives
 *  cleaner results and also reduces the model's out-of-distribution refusal
 *  collapse. This exposes that lever: a master toggle plus the main CFG, the
 *  tail CFG, and where in the run the drop happens.
 *
 *  When the toggle is off, generation uses the sampler preset's built-in
 *  schedule (CFG 7 → 3) unchanged. */
export function CfgControl() {
  const {
    customCfg, setCustomCfg,
    cfg, setCfg,
    cfgOverride, setCfgOverride,
    cfgOverrideStart, setCfgOverrideStart,
  } = useSettingsStore()

  // "Override starts at 0.7" → the last 30% of steps run at the override CFG.
  const lastPct = Math.round((1 - cfgOverrideStart) * 100)

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <Switch checked={customCfg} onCheckedChange={setCustomCfg} className="mt-0.5 scale-90" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-300">Custom guidance (CFG)</p>
          <p className="text-[10px] text-zinc-500 leading-snug">
            Lower CFG with a late drop — cleaner, less burnt/splotchy photos and fewer refusals. Off uses the preset's CFG&nbsp;7.
          </p>
        </div>
      </label>

      {customCfg && (
        <div className="space-y-3 border-l border-zinc-800 ml-1 pl-3">
          {/* Main CFG */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">CFG</span>
              <span className="text-[11px] font-mono text-zinc-300">{cfg.toFixed(1)}</span>
            </div>
            <Slider
              min={CFG_MIN} max={CFG_MAX} step={0.1}
              value={[cfg]}
              onValueChange={([v]) => setCfg(v)}
              aria-label="Main CFG"
            />
          </div>

          {/* Override (tail) CFG */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Override CFG (tail)</span>
              <span className="text-[11px] font-mono text-zinc-300">{cfgOverride.toFixed(1)}</span>
            </div>
            <Slider
              min={CFG_MIN} max={CFG_MAX} step={0.1}
              value={[cfgOverride]}
              onValueChange={([v]) => setCfgOverride(v)}
              aria-label="Override CFG"
            />
          </div>

          {/* Where the drop happens */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Drop point</span>
              <span className="text-[11px] font-mono text-zinc-300">last {lastPct}%</span>
            </div>
            <Slider
              min={0.3} max={1} step={0.05}
              value={[cfgOverrideStart]}
              onValueChange={([v]) => setCfgOverrideStart(v)}
              aria-label="CFG override start"
            />
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
