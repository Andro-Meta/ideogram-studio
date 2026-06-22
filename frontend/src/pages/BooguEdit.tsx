import { useRef, useState } from "react"
import { Loader2, Sparkles, Upload, Wand2 } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useBooguStatus, useBooguEdit } from "@/hooks/useBoogu"

// ponytail: file-upload source only for v1; wire "edit in Boogu" from the gallery later.
export function BooguEdit() {
  const { data: status } = useBooguStatus()
  const edit = useBooguEdit()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [instruction, setInstruction] = useState("")
  const [steps, setSteps] = useState(50)
  const [textG, setTextG] = useState(7.5)
  const [imageG, setImageG] = useState(1.5)
  const [size, setSize] = useState<1024 | 2048>(1024)
  const [offload, setOffload] = useState(true)
  const [fp8, setFp8] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  const pick = (f: File | null) => {
    if (!f) return
    setFile(f)
    setSrcUrl(URL.createObjectURL(f))
    setResultUrl(null)
  }

  const run = () => {
    if (!file || !instruction.trim() || edit.isPending) return
    edit.mutate(
      { imageBlob: file, instruction: instruction.trim(), steps, textGuidance: textG, imageGuidance: imageG, size, offload, fp8, seed: null },
      { onSuccess: (res) => setResultUrl(`${res.image_url}?t=${res.job_id}`) },
    )
  }

  if (status && !status.installed) {
    return (
      <div className="h-full overflow-auto p-6 max-w-2xl mx-auto space-y-3 text-sm text-zinc-300">
        <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-violet-400" /> Boogu Edit <span className="text-[10px] uppercase tracking-wider text-amber-400/80">experimental</span>
        </h1>
        <p>Native instruction image editing via <span className="text-zinc-100">Boogu-Image-0.1-Edit</span> (a separate 10B model). Not installed yet.</p>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
          <p className="text-zinc-400">Install (~20 GB, one time):</p>
          <pre className="text-[11px] text-zinc-300 bg-zinc-950/70 rounded p-2 overflow-auto">setup_boogu.bat</pre>
          <p className="text-[11px] text-zinc-600">Clones the repo, makes its own venv (torch 2.7/cu126), downloads the Edit weights to <code>{status.dir}</code>. Heavy — for a 24 GB GPU keep CPU offload on or unload the Ideogram model first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 lg:p-6">
      <div className="max-w-5xl mx-auto grid lg:grid-cols-[1fr_300px] gap-4">
        {/* Images */}
        <div className="space-y-3 order-2 lg:order-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[11px] text-zinc-500">Source</p>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null) }}
                className="aspect-square rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 grid place-items-center cursor-pointer overflow-hidden hover:border-violet-600/60"
              >
                {srcUrl?.startsWith("blob:") ? <img src={srcUrl} alt="" className="h-full w-full object-contain" />
                  : <span className="text-[11px] text-zinc-500 flex flex-col items-center gap-1"><Upload className="h-5 w-5" /> Drop or click</span>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-zinc-500">Result</p>
              <div className="aspect-square rounded-md border border-zinc-800 bg-zinc-900/40 grid place-items-center overflow-hidden">
                {edit.isPending ? <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                  : resultUrl ? <img src={resultUrl} alt="" className="h-full w-full object-contain" />
                  : <span className="text-[11px] text-zinc-600">edit appears here</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3 order-1 lg:order-2">
          <h1 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-400" /> Boogu Edit
            <span className="text-[9px] uppercase tracking-wider text-amber-400/80">experimental</span>
          </h1>
          <Textarea
            value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder="Instruction — e.g. add a golden retriever sitting behind the bench, realistic size"
            rows={3} className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm resize-none"
          />
          <Knob label="Steps" value={steps} min={4} max={100} step={1} onChange={(v) => setSteps(v)} fmt={(v) => `${v}`} />
          <Knob label="Prompt strength" value={textG} min={1} max={15} step={0.5} onChange={setTextG} fmt={(v) => v.toFixed(1)} />
          <Knob label="Keep source" value={imageG} min={1} max={5} step={0.1} onChange={setImageG} fmt={(v) => v.toFixed(1)} />
          <div className="grid grid-cols-2 gap-1">
            {([1024, 2048] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)}
                className={cn("rounded-md border px-1 py-1 text-[11px] font-medium",
                  size === s ? "border-violet-500 bg-violet-500/10 text-violet-300" : "border-zinc-700 bg-zinc-800/60 text-zinc-400")}>
                {s}px
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={offload} onChange={(e) => setOffload(e.target.checked)} className="accent-violet-500" />
            CPU offload (fits a busy 24 GB GPU; slower)
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={fp8} onChange={(e) => setFp8(e.target.checked)} className="accent-violet-500" />
            fp8 weights (less VRAM)
          </label>
          <button
            type="button" onClick={run} disabled={!file || !instruction.trim() || edit.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium py-2 disabled:opacity-40"
          >
            {edit.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Editing…</> : <><Sparkles className="h-4 w-4" /> Edit</>}
          </button>
          <p className="text-[9px] text-zinc-600 leading-snug">Native edit model — handles add/remove, attributes, scale &amp; depth the hacks can't. Slow (10B, ~minutes with offload).</p>
        </div>
      </div>
    </div>
  )
}

function Knob({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]"><span className="text-zinc-400">{label}</span><span className="text-zinc-300 font-mono">{fmt(value)}</span></div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}
