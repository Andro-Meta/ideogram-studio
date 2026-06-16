import { ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { useSettingsStore } from "@/stores/settingsStore"
import { CONSTRAINT_CATEGORIES, buildConstraintClause } from "@/lib/constraintPresets"

/**
 * Artifact suppression — the on-model substitute for a negative prompt.
 *
 * Ideogram 4 has no negative-prompt field, so instead of "no blur" we append
 * POSITIVE quality constraints ("sharp focus, no motion blur") to the caption.
 * Master toggle + category chips + an optional free-text addition. Off by
 * default. Lives in the settings rail beside the CFG controls.
 */
export function ArtifactSuppression() {
  const {
    artifactSuppression, setArtifactSuppression,
    artifactCategoryIds, toggleArtifactCategory,
    artifactCustom, setArtifactCustom,
  } = useSettingsStore()

  const clause = buildConstraintClause(artifactCategoryIds, artifactCustom)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-violet-400/70" />
          Quality constraints
        </p>
        <Switch
          checked={artifactSuppression}
          onCheckedChange={setArtifactSuppression}
          className="scale-75 -my-1"
        />
      </div>

      <p className="text-[10px] text-zinc-600 leading-relaxed">
        Ideogram has no negative prompt. These append positive constraints
        (e.g. “sharp focus, no motion blur”) to your caption.
      </p>

      {artifactSuppression && (
        <>
          <div className="flex flex-wrap gap-1">
            {CONSTRAINT_CATEGORIES.map((c) => {
              const active = artifactCategoryIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleArtifactCategory(c.id)}
                  title={c.hint}
                  className={cn(
                    "rounded-md border px-1.5 py-1 text-[10px] font-medium transition-all",
                    active
                      ? "border-violet-500 bg-violet-500/10 text-violet-300"
                      : "border-zinc-700 bg-zinc-800/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {c.label}
                </button>
              )
            })}
          </div>

          <input
            value={artifactCustom}
            onChange={(e) => setArtifactCustom(e.target.value)}
            placeholder="Add your own, e.g. “no text watermark”…"
            className="w-full h-7 rounded border border-zinc-700 bg-zinc-800 text-[11px] text-zinc-200 px-2 outline-none focus:border-violet-500"
          />

          {clause ? (
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              <span className="text-zinc-600">Appended:</span> {clause}
            </p>
          ) : (
            <p className="text-[10px] text-amber-400/80">
              Nothing selected — pick a category or add custom text.
            </p>
          )}
        </>
      )}
    </div>
  )
}
