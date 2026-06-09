import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Camera, Paintbrush } from "lucide-react"
import { PhotoStyleForm } from "./PhotoStyleForm"
import { IllustrationStyleForm } from "./IllustrationStyleForm"
import { usePromptStore } from "@/stores/promptStore"

export function StylePanel() {
  const mode = usePromptStore((s) => s.style_description.mode)
  const setStyleMode = usePromptStore((s) => s.setStyleMode)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Style</p>
      <Tabs
        value={mode}
        onValueChange={(v) => setStyleMode(v as "photo" | "illustration")}
      >
        <TabsList className="w-full bg-zinc-800 border border-zinc-700 h-8">
          <TabsTrigger value="photo" className="flex-1 text-xs data-[state=active]:bg-zinc-700">
            <Camera className="h-3 w-3 mr-1.5" />
            Photo
          </TabsTrigger>
          <TabsTrigger value="illustration" className="flex-1 text-xs data-[state=active]:bg-zinc-700">
            <Paintbrush className="h-3 w-3 mr-1.5" />
            Illustration
          </TabsTrigger>
        </TabsList>
        <TabsContent value="photo" className="mt-3">
          <PhotoStyleForm />
        </TabsContent>
        <TabsContent value="illustration" className="mt-3">
          <IllustrationStyleForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
