import { Shuffle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"

export function SeedControl() {
  const { fixedSeed, seed, setFixedSeed, setSeed, randomizeSeed } = useSettingsStore()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Seed</p>
        <div className="flex items-center gap-2">
          <Label htmlFor="fixed-seed" className="text-xs text-zinc-400">Fixed</Label>
          <Switch
            id="fixed-seed"
            checked={fixedSeed}
            onCheckedChange={setFixedSeed}
            className="scale-75"
          />
        </div>
      </div>

      {fixedSeed ? (
        <div className="flex gap-2">
          <Input
            type="number"
            value={seed}
            min={0}
            max={4294967295}
            onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
            className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs h-7 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={randomizeSeed}
            className="h-7 px-2 border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
            title="Random seed"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <p className="text-[10px] text-zinc-500">Random seed each generation</p>
      )}
    </div>
  )
}
