import { usePromptStore } from "@/stores/promptStore"
import { ElementCard } from "./ElementCard"
import { AddElementMenu } from "./AddElementMenu"

interface Props {
  focusedElementId?: string | null
  onFocusElement?: (id: string) => void
}

export function ElementList({ focusedElementId, onFocusElement }: Props) {
  const elements = usePromptStore((s) => s.elements)

  return (
    // Section title comes from the FlowSection wrapper in Generate; only the
    // live count renders here.
    <div className="space-y-2">
      {elements.length > 0 && (
        <p className="text-[10px] text-zinc-600">{elements.length} element{elements.length === 1 ? "" : "s"}</p>
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
