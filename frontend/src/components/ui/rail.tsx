import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Scrollable side-panel container with honest affordances:
 * an always-visible scrollbar (.rail-scroll) plus gradient fades and a
 * pulsing chevron whenever content continues past an edge — so clipped
 * content never *looks* like the end of the panel.
 */
export function Rail({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setAtTop(el.scrollTop < 4)
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // content growth (collapsibles, async sections) also changes scrollHeight
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [update])

  return (
    // Desktop: a fixed-height column that scrolls internally (flex-1 + h-full).
    // Mobile: collapses to its content height so the whole page scrolls as one
    // — nested scroll areas are miserable on a phone.
    <div className={cn("relative min-h-0 flex-none lg:flex-1", className)}>
      <div ref={ref} className="rail-scroll lg:h-full">
        {children}
      </div>

      {/* Top fade — content continues above */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-zinc-950/90 to-transparent transition-opacity",
          atTop ? "opacity-0" : "opacity-100",
        )}
      />

      {/* Bottom fade + chevron — content continues below */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 transition-opacity",
          atBottom ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="h-10 bg-gradient-to-t from-zinc-950/95 to-transparent" />
        <ChevronDown className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-3.5 w-3.5 text-zinc-500 animate-bounce" />
      </div>
    </div>
  )
}
