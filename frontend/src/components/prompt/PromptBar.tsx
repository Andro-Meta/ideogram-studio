import { useRef, useState } from "react"
import { Sparkles, ImageUp, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useSettingsStore } from "@/stores/settingsStore"
import { usePromptStore } from "@/stores/promptStore"
import { useMagicPrompt } from "@/hooks/useMagicPrompt"
import { useDescribeImage } from "@/hooks/useDescribeImage"

export function PromptBar() {
  const [text, setText] = useState("")
  const { width, height } = useSettingsStore()
  const style = usePromptStore((s) => s.style_description)
  const mutation = useMagicPrompt()
  const describe = useDescribeImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleMagic = () => {
    if (!text.trim()) return
    // Send the current Style fields so Magic Prompt respects the chosen
    // medium/look instead of inventing one (e.g. photography, not comic).
    mutation.mutate({ text: text.trim(), width, height, style })
  }

  const handleImage = (file?: File | null) => {
    if (!file) return
    describe.mutate(file, {
      onSuccess: (prompt) => {
        setText(prompt)
        toast.success("Prompt created from image — tweak it, or hit Magic Prompt to structure")
      },
    })
    if (fileRef.current) fileRef.current.value = ""   // allow re-picking the same file
  }

  const busy = mutation.isPending || describe.isPending

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Quick Prompt</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Upload any image (even ones you didn't make here) to reverse-engineer a prompt — free"
          className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-500/20 hover:border-violet-400/60 disabled:opacity-40 transition-colors"
        >
          {describe.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
          {describe.isPending ? "Reading image…" : "Image → Prompt"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleImage(e.target.files?.[0])}
        />
      </div>
      <div className="relative">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your image in plain English — or drop in an image above to reverse-engineer a prompt…"
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
            {mutation.isPending ? "Thinking…" : "Magic Prompt"}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-600">
        ⌘/Ctrl+Enter to run · follows your <span className="text-zinc-500">Style</span> settings
        above · <span className="text-zinc-500">Image → Prompt</span> reverse-engineers any image (free) · needs an API key in Settings
      </p>
    </div>
  )
}
