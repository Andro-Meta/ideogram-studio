import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ImagePlus, Loader2, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { useGallery, useGalleryItem } from "@/hooks/useGallery"
import { useImportImage } from "@/hooks/useImportImage"
import { EditorDialog } from "@/components/editor/EditorDialog"

interface EditingTarget {
  jobId: string
  imageUrl: string
}

/**
 * First-class editor entry point: drop/browse an image from disk, pick a
 * recent gallery image, or arrive with ?job=<id> (from Generate or Gallery).
 */
export function Editor() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<EditingTarget | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importImage = useImportImage()
  const { data: gallery, isLoading: galleryLoading } = useGallery(1)

  // Deep link: /editor?job=<id> opens that gallery item directly.
  const jobParam = searchParams.get("job")
  const { data: linkedItem, isError: linkedError } = useGalleryItem(
    jobParam && !editing ? jobParam : null,
  )
  useEffect(() => {
    if (linkedItem?.image_path && !editing) {
      setEditing({
        jobId: linkedItem.id,
        imageUrl: `/outputs/${linkedItem.image_path.split("/").pop()}`,
      })
    }
  }, [linkedItem, editing])

  const closeEditor = useCallback(() => {
    setEditing(null)
    if (searchParams.has("job")) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      importImage.mutate(file, {
        onSuccess: (res) => setEditing({ jobId: res.job_id, imageUrl: res.image_url }),
      })
    },
    [importImage],
  )

  const recents = gallery?.items.filter((i) => i.image_path) ?? []

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Editor</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Layered regional editing — selections, adjustment layers, undo history.
            Bring your own image or pick a recent one.
          </p>
        </div>

        {/* ── Drop zone ── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            "rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all",
            dragOver
              ? "border-violet-500 bg-violet-500/10"
              : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-900/70",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? undefined)
              e.target.value = ""   // allow re-selecting the same file
            }}
          />
          {importImage.isPending ? (
            <>
              <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
              <p className="text-sm text-zinc-400">Importing image…</p>
            </>
          ) : (
            <>
              <Upload className={cn("h-8 w-8", dragOver ? "text-violet-300" : "text-zinc-500")} />
              <p className="text-sm text-zinc-300">
                Drop an image here, or <span className="text-violet-400">browse</span>
              </p>
              <p className="text-[11px] text-zinc-600">
                PNG · JPEG · WebP · BMP — up to 64 MB. Imports are added to your gallery.
              </p>
            </>
          )}
        </div>

        {/* ── Recent images ── */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">
            Or pick a recent image
          </h2>
          {galleryLoading && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!galleryLoading && recents.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 flex items-center gap-3 text-sm text-zinc-500">
              <ImagePlus className="h-5 w-5 shrink-0" />
              Nothing here yet — generate an image or import one above.
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {recents.map((item) => {
              const url = `/outputs/${item.image_path!.split("/").pop()}`
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setEditing({ jobId: item.id, imageUrl: url })}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-zinc-800 hover:border-violet-500/60 transition-all"
                  title={item.prompt_text ?? "Edit this image"}
                >
                  <img
                    src={url}
                    alt={item.prompt_text ?? ""}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute inset-0 bg-zinc-950/0 group-hover:bg-zinc-950/30 transition-colors" />
                </button>
              )
            })}
          </div>
        </div>

        {jobParam && linkedError && (
          <p className="text-xs text-red-400">
            The linked image could not be found — it may have been deleted.
          </p>
        )}
      </div>

      {editing && (
        <EditorDialog
          open
          onClose={closeEditor}
          jobId={editing.jobId}
          imageUrl={editing.imageUrl}
        />
      )}
    </div>
  )
}
