import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Camera, Paintbrush } from "lucide-react"
import { PhotoStyleForm } from "./PhotoStyleForm"
import { IllustrationStyleForm } from "./IllustrationStyleForm"
import { StyleLibrary } from "./StyleLibrary"
import { usePromptStore } from "@/stores/promptStore"

/** Style section body: preset library on top, then mode tabs + fields.
 *  The section title comes from the FlowSection wrapper in Generate. */
export function StylePanel() {
  const mode = usePromptStore((s) => s.style_description.mode)
  const setStyleMode = usePromptStore((s) => s.setStyleMode)

  return (
    <div className="space-y-3">
      <StyleLibrary />
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
