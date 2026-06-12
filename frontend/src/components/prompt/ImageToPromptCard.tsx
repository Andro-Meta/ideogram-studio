import { useRef } from "react"
import { ImageUp, Loader2, Sparkles } from "lucide-react"
import { useSettingsStore } from "@/stores/settingsStore"
import { usePromptStore } from "@/stores/promptStore"
import { useDescribeImage } from "@/hooks/useDescribeImage"
import { useMagicPrompt } from "@/hooks/useMagicPrompt"

/**
 * The headline "start from an image" entry point. Sits at the very top of the
 * Generate flow so it can't be missed. Upload any picture → a free vision model
 * describes it → Magic Prompt structures that into the full editable prompt
 * (Style, Description, Elements all populate). Everything runs on free models.
 */
export function ImageToPromptCard() {
  const fileRef = useRef<HTMLInputElement>(null)
  const { width, height } = useSettingsStore()
  const style = usePromptStore((s) => s.style_description)
  const describe = useDescribeImage()
  const magic = useMagicPrompt()

  const busy = describe.isPending || magic.isPending

  const handleFile = (file?: File | null) => {
    if (!file) return
    // Image → rich description → structured prompt. Chaining magic-prompt is
    // what makes this "a whole prompt" rather than a blob of text in one box.
    describe.mutate(file, {
      onSuccess: (promptText) => magic.mutate({ text: promptText, width, height, style }),
    })
    if (fileRef.current) fileRef.current.value = ""
  }

  const label = describe.isPending
    ? "Reading the image…"
    : magic.isPending
      ? "Building your prompt…"
      : "Start from an image"

  return (
    <div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="group w-full rounded-xl border-2 border-dashed border-violet-500/40 bg-violet-500/[0.06] hover:bg-violet-500/10 hover:border-violet-400/70 disabled:opacity-60 transition-colors px-4 py-3.5 flex items-center gap-3 text-left"
      >
        <div className="shrink-0 h-10 w-10 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-200">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageUp className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-violet-100 flex items-center gap-1.5">
            {label}
            {!busy && <Sparkles className="h-3.5 w-3.5 text-violet-300/70" />}
          </p>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Upload any picture — even one you didn't make here — and turn it into a
            full, editable prompt. Free, runs through a local vision model.
          </p>
        </div>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}
