import { Plus, Box, Type } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePromptStore } from "@/stores/promptStore"

export function AddElementMenu() {
  const addElement = usePromptStore((s) => s.addElement)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-dashed border-zinc-600 hover:border-violet-500 hover:text-violet-400 text-zinc-400 bg-transparent"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Element
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44 bg-zinc-900 border-zinc-700">
        <DropdownMenuItem
          onClick={() => addElement("obj")}
          className="gap-2 text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer"
        >
          <Box className="h-4 w-4 text-violet-400" />
          Object
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => addElement("text")}
          className="gap-2 text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer"
        >
          <Type className="h-4 w-4 text-cyan-400" />
          Text Element
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
