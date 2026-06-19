import { useState } from "react"
import { ChevronDown, ChevronRight, Copy, Pencil, RotateCcw, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"

function prettify(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/**
 * Unified "Caption JSON" panel — the exact Ideogram-4 JSON caption that will be
 * sent, shown read-only with an Edit mode for power users (the same spirit as
 * the Advanced sampler knobs). Used on Generate AND every edit tab.
 *
 * `caption` is the auto-built caption (Generate: built client-side from the
 * prompt builder; edits: fetched from /api/edit/preview-caption). When the user
 * edits it, `override` holds their JSON and the surface sends THAT verbatim
 * instead of the auto caption; "Revert to auto" clears it.
 */
export function CaptionJsonPanel({
  caption,
  loading = false,
  override,
  onOverride,
  onRefresh,
  defaultOpen = false,
}: {
  caption: string
  loading?: boolean
  override: string | null
  onOverride: (json: string | null) => void
  onRefresh?: () => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [err, setErr] = useState<string | null>(null)

  const active = override != null
  const shown = active ? override! : caption

  function startEdit() {
    setDraft(prettify(shown || caption))
    setErr(null)
    setEditing(true)
  }
  function save() {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(draft)
    } catch (e) {
      setErr("Invalid JSON: " + (e as Error).message)
      return
    }
    if (!parsed || typeof parsed !== "object" || !("high_level_description" in parsed)) {
      setErr('Not an Ideogram caption — needs at least "high_level_description".')
      return
    }
    onOverride(JSON.stringify(parsed)) // minified
    setEditing(false)
    setErr(null)
    toast.success("Sending your edited caption JSON")
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Caption JSON
        {active && <span className="text-[9px] uppercase tracking-wider text-amber-400/80">edited</span>}
        <span className="ml-auto text-[10px] text-zinc-600">{loading ? "building…" : ""}</span>
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          {!editing ? (
            <>
              <pre className="text-[9px] leading-tight text-zinc-400 bg-zinc-950/60 rounded p-1.5 overflow-auto max-h-52 whitespace-pre-wrap break-all">
                {loading ? "Building the caption…" : prettify(shown) || "(empty — write a prompt first)"}
              </pre>
              <div className="flex items-center gap-3 text-[10px]">
                <button type="button" onClick={startEdit} disabled={loading}
                  className="flex items-center gap-1 text-violet-300/80 hover:text-violet-200 disabled:opacity-40">
                  <Pencil className="h-3 w-3" /> Edit JSON
                </button>
                <button type="button"
                  onClick={() => copyText(shown).then((ok) => ok ? toast.success("Caption JSON copied") : toast.error("Couldn't copy"))}
                  className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300">
                  <Copy className="h-3 w-3" /> Copy
                </button>
                {onRefresh && !active && (
                  <button type="button" onClick={onRefresh} disabled={loading}
                    className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-40">
                    <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Rebuild
                  </button>
                )}
                {active && (
                  <button type="button" onClick={() => { onOverride(null); setErr(null) }}
                    className="ml-auto flex items-center gap-1 text-amber-400/80 hover:text-amber-300">
                    <RotateCcw className="h-3 w-3" /> Revert to auto
                  </button>
                )}
              </div>
              {active && (
                <p className="text-[9px] text-amber-400/60 leading-snug">
                  Sending your edited JSON — the prompt builder is paused until you revert.
                </p>
              )}
            </>
          ) : (
            <>
              <textarea
                value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
                className="w-full h-52 bg-zinc-950/70 border border-zinc-700 rounded p-1.5 text-[10px] font-mono leading-tight text-zinc-200 outline-none focus:border-violet-500"
              />
              {err && <p className="text-[10px] text-red-400 leading-snug">{err}</p>}
              <div className="flex items-center gap-3 text-[10px]">
                <button type="button" onClick={save}
                  className="rounded border border-violet-700/60 px-2 py-0.5 text-violet-300 hover:bg-violet-500/10">
                  Use this JSON
                </button>
                <button type="button" onClick={() => { setEditing(false); setErr(null) }}
                  className="text-zinc-500 hover:text-zinc-300">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
