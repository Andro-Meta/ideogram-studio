import { useEffect, useState } from "react"
import { Heart, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { GalleryGrid } from "@/components/gallery/GalleryGrid"

export function Gallery() {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [favoritesOnly, setFavoritesOnly] = useState(false)

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

        {/* Favorites filter */}
        <button
          type="button"
          onClick={() => setFavoritesOnly((v) => !v)}
          className={cn(
            "ml-auto flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium transition-all",
            favoritesOnly
              ? "border-red-500/60 text-red-300 bg-red-500/10"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
          )}
          title={favoritesOnly ? "Show all images" : "Show favorites only"}
        >
          <Heart className={cn("h-3.5 w-3.5", favoritesOnly && "fill-current")} />
          Favorites
        </button>

        {/* Search */}
        <div className="relative w-72 max-w-full">
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
        <GalleryGrid search={debounced} favoritesOnly={favoritesOnly} />
      </div>
    </div>
  )
}
