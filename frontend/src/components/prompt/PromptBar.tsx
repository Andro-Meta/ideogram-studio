import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useSettingsStore } from "@/stores/settingsStore"
import { usePromptStore } from "@/stores/promptStore"
import { useMagicPrompt } from "@/hooks/useMagicPrompt"

export function PromptBar() {
  const [text, setText] = useState("")
  const { width, height } = useSettingsStore()
  const style = usePromptStore((s) => s.style_description)
  const mutation = useMagicPrompt()

  const handleMagic = () => {
    if (!text.trim()) return
    // Send the current Style fields so Magic Prompt respects the chosen
    // medium/look instead of inventing one (e.g. photography, not comic).
    mutation.mutate({ text: text.trim(), width, height, style })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Quick Prompt</p>
      <div className="relative">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your image in plain English — Magic Prompt will structure it..."
          rows={3}
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
            disabled={mutation.isPending || !text.trim()}
            className="h-7 px-3 bg-violet-600 hover:bg-violet-500 text-white text-xs gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {mutation.isPending ? "Thinking…" : "Magic Prompt"}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-600">
        ⌘/Ctrl+Enter to run · follows your <span className="text-zinc-500">Style</span> settings
        above (set the look first) · needs an API key in Settings
      </p>
    </div>
  )
}
