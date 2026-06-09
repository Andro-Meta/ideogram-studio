import { cn } from "@/lib/utils"
import type { ElementType } from "@/types/caption"

interface Props {
  type: ElementType
  className?: string
}

export function ElementTypeBadge({ type, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
        type === "text"
          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
          : "bg-violet-500/20 text-violet-300 border border-violet-500/40",
        className
      )}
    >
      {type === "text" ? "TXT" : "OBJ"}
    </span>
  )
}
