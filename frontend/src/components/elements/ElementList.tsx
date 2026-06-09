import { usePromptStore } from "@/stores/promptStore"
import { ElementCard } from "./ElementCard"
import { AddElementMenu } from "./AddElementMenu"
import { cn } from "@/lib/utils"

interface Props {
  focusedElementId?: string | null
  onFocusElement?: (id: string) => void
}

export function ElementList({ focusedElementId, onFocusElement }: Props) {
  const elements = usePromptStore((s) => s.elements)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
          Elements <span className="text-zinc-600 normal-case font-normal">({elements.length})</span>
        </p>
      </div>

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
