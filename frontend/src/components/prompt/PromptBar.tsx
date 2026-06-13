import { useRef, useState } from "react"
import { Sparkles, ImageUp, Loader2, PencilLine } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { usePromptStore } from "@/stores/promptStore"
import { useMagicPrompt } from "@/hooks/useMagicPrompt"
import { useDescribeImage } from "@/hooks/useDescribeImage"

type Mode = "write" | "image"

export function PromptBar() {
  const [mode, setMode] = useState<Mode>("write")
  const [text, setText] = useState("")
  const { width, height } = useSettingsStore()
  const style = usePromptStore((s) => s.style_description)
  const magic = useMagicPrompt()
  const describe = useDescribeImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const busy = magic.isPending || describe.isPending

  const handleMagic = () => {
    if (!text.trim()) return
    // Send the current Style fields so Magic Prompt respects the chosen
    // medium/look instead of inventing one (e.g. photography, not comic).
    magic.mutate({ text: text.trim(), width, height, style })
  }

  const handleImage = (file?: File | null) => {
    if (!file) return
    // Image → rich description → structured prompt. Chaining magic-prompt is
    // what makes this a whole prompt (Style/Description/Elements all fill),
    // not just a blob of text in one box.
    describe.mutate(file, {
      onSuccess: (prompt) => {
        setText(prompt)
        magic.mutate(
          { text: prompt, width, height, style },
          {
            // Structuring is a second, flaky network step. If it fails we still
            // have a good description — don't dead-end: drop the user into Write
            // mode with the prompt filled in so they can edit or retry.
            onError: () => {
              setMode("write")
              toast.message("Got a prompt from your image — couldn't auto-structure it. Edit it below or hit Magic Prompt to try again.")
            },
          },
        )
      },
    })
    if (fileRef.current) fileRef.current.value = ""   // allow re-picking the same file
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Quick Prompt</p>
      </div>

      {/* Two ways to start: write a prompt, or generate one from an image. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-800/60 p-1">
        <button
          type="button"
          onClick={() => setMode("write")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
            mode === "write"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200",
          )}
        >
          <PencilLine className="h-3.5 w-3.5" />
          Write a prompt
        </button>
        <button
          type="button"
          onClick={() => setMode("image")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
            mode === "image"
              ? "bg-violet-600 text-white"
              : "text-zinc-400 hover:text-violet-200",
          )}
        >
          <ImageUp className="h-3.5 w-3.5" />
          Generate from image
        </button>
      </div>

      {mode === "write" ? (
        <>
          <div className="relative">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe your image in plain English…"
              rows={3}
              disabled={busy}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none pb-10"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleMagic()
                }
              }}
            />
            <div className="absolute bottom-2 right-2">
              <Button
                size="sm"
                onClick={handleMagic}
                disabled={busy || !text.trim()}
                className="h-7 px-3 bg-violet-600 hover:bg-violet-500 text-white text-xs gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {magic.isPending ? "Thinking…" : "Magic Prompt"}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">
            ⌘/Ctrl+Enter to run · follows your <span className="text-zinc-500">Style</span> settings
            above · needs an API key in Settings
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="group w-full rounded-xl border-2 border-dashed border-violet-500/40 bg-violet-500/[0.06] hover:bg-violet-500/10 hover:border-violet-400/70 disabled:opacity-60 transition-colors px-4 py-5 flex flex-col items-center gap-2 text-center"
          >
            <div className="h-11 w-11 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-200">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageUp className="h-5 w-5" />}
            </div>
            <p className="text-sm font-semibold text-violet-100">
              {describe.isPending ? "Reading the image…"
                : magic.isPending ? "Building your prompt…"
                : "Upload an image to build a prompt"}
            </p>
            <p className="text-[11px] text-zinc-400 leading-snug max-w-[44ch]">
              Drop in any picture — even one you didn't make here — and it becomes a
              full, editable prompt: Style, Description, and Elements all fill in.
            </p>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImage(e.target.files?.[0])}
          />
          <p className="text-[10px] text-zinc-600 text-center">
            Free · runs through a vision model · needs an API key in Settings
          </p>
        </>
      )}
    </div>
  )
}
