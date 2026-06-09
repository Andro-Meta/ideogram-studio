import { useEffect, useState } from "react"
import { Search, X } from "lucide-react"
import { GalleryGrid } from "@/components/gallery/GalleryGrid"

export function Gallery() {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")

  // Debounce typing so we don't hit the API on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-4 border-b border-zinc-800 flex items-center gap-4">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Gallery</h1>
          <p className="text-xs text-zinc-500">All your generated images</p>
        </div>

        {/* Search */}
        <div className="relative ml-auto w-72 max-w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts…"
            className="w-full h-8 rounded-lg bg-zinc-800 border border-zinc-700 pl-8 pr-8 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-500/60 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <GalleryGrid search={debounced} />
      </div>
    </div>
  )
}
