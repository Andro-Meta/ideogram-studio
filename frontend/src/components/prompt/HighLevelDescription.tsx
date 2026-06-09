import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { wordCount } from "@/lib/caption"
import { usePromptStore } from "@/stores/promptStore"

export function HighLevelDescription() {
  const { high_level_description, setHighLevelDescription } = usePromptStore()
  const wc = wordCount(high_level_description)
  const over = wc > 50

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Overview</p>
        <span className={cn("text-[10px] tabular-nums", over ? "text-amber-400" : "text-zinc-600")}>
          {wc} / 50 words
        </span>
      </div>
      <Textarea
        value={high_level_description}
        onChange={(e) => setHighLevelDescription(e.target.value)}
        placeholder="1–2 sentences describing the full image scene, mood, or concept…"
        rows={2}
        className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none"
      />
      {over && (
        <p className="text-[10px] text-amber-400/80">
          Exceeds 50-word limit — image quality may degrade.
        </p>
      )}
    </div>
  )
}
