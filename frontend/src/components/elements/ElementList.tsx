import { Sparkles, Loader2 } from "lucide-react"
import { usePromptStore } from "@/stores/promptStore"
import { useEnhanceElements } from "@/hooks/useEnhanceElements"
import { ElementCard } from "./ElementCard"
import { AddElementMenu } from "./AddElementMenu"

interface Props {
  focusedElementId?: string | null
  onFocusElement?: (id: string) => void
}

export function ElementList({ focusedElementId, onFocusElement }: Props) {
  const elements = usePromptStore((s) => s.elements)
  const enhance = useEnhanceElements()

  return (
    // Section title comes from the FlowSection wrapper in Generate; only the
    // live count renders here.
    <div className="space-y-2">
      {elements.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-zinc-600">{elements.length} element{elements.length === 1 ? "" : "s"}</p>
          <button
            type="button"
            onClick={() => enhance.mutate()}
            disabled={enhance.isPending}
            title="Let the LLM flesh out every element's description — bounding boxes and text are kept exactly"
            className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
          >
            {enhance.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {enhance.isPending ? "Enhancing…" : "Enhance, keep layout"}
          </button>
        </div>
      )}

      {elements.length === 0 && (
        <p className="text-xs text-zinc-600 py-2 text-center">
          No elements. Add objects or text that should appear in the image.
        </p>
      )}

      <div className="space-y-2">
        {elements.map((el, i) => (
          <ElementCard
            key={el.id}
            element={el}
            index={i}
            onFocus={() => onFocusElement?.(el.id)}
          />
        ))}
      </div>

      <AddElementMenu />
    </div>
  )
}
