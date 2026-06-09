import { useState } from "react"
import { Eye, EyeOff, Save, Loader2, CheckCircle2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useModelStatus } from "@/hooks/useModelStatus"
import type { SettingsUpdateRequest } from "@/types/api"

function SecretInput({
  value,
  onChange,
  placeholder,
  hasValue,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  hasValue: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasValue ? "••••••••••••••• (saved)" : placeholder}
        className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm pr-9"
        autoComplete="off"
      />
      <button
        type="button"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">{children}</h2>
  )
}

export function Settings() {
  const { data: serverSettings, isLoading } = useSettings()
  const { data: modelStatus } = useModelStatus()
  const updateMutation = useUpdateSettings()

  const [hfToken, setHfToken] = useState("")
  const [ideogramKey, setIdeogramKey] = useState("")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [mpBackend, setMpBackend] = useState<string>("")

  const effectiveMpBackend = mpBackend || serverSettings?.magic_prompt_backend || "ideogram"

  const handleSave = () => {
    const payload: SettingsUpdateRequest = {}
    if (hfToken)       payload.hf_token           = hfToken
    if (ideogramKey)   payload.ideogram_api_key    = ideogramKey
    if (openrouterKey) payload.openrouter_api_key  = openrouterKey
    if (mpBackend)     payload.magic_prompt_backend = mpBackend
    updateMutation.mutate(payload)
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const vramMb = modelStatus?.vram_used_mb
  const vramGb = vramMb ? (vramMb / 1024).toFixed(1) : null

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Configure API keys, model defaults, and Magic Prompt backend.</p>
        </div>

        {/* ── API Keys ── */}
        <div className="space-y-4">
          <SectionTitle>API Keys</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 divide-y divide-zinc-700">

            {/* HF Token */}
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-zinc-200">Hugging Face Token</Label>
                {serverSettings?.has_hf_token ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Saved
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-600/50 text-amber-400 text-[10px]">Required</Badge>
                )}
              </div>
              <SecretInput
                value={hfToken}
                onChange={setHfToken}
                placeholder="hf_..."
                hasValue={!!serverSettings?.has_hf_token}
              />
              <p className="text-[11px] text-zinc-500">
                Required for downloading model weights.{" "}
                <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  Get token <ExternalLink className="h-3 w-3" />
                </a>
                {" "}· Accept license at{" "}
                <a href="https://huggingface.co/ideogram-ai/ideogram-4-fp8" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  ideogram-ai/ideogram-4-fp8 <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            {/* Ideogram API Key */}
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-zinc-200">Ideogram API Key</Label>
                {serverSettings?.has_ideogram_api_key ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Saved
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-600 text-zinc-400 text-[10px]">Optional</Badge>
                )}
              </div>
              <SecretInput
                value={ideogramKey}
                onChange={setIdeogramKey}
                placeholder="sk-..."
                hasValue={!!serverSettings?.has_ideogram_api_key}
              />
              <p className="text-[11px] text-zinc-500">
                For Magic Prompt via Ideogram API.{" "}
                <a href="https://developer.ideogram.ai" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  developer.ideogram.ai <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            {/* OpenRouter API Key */}
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-zinc-200">OpenRouter API Key</Label>
                {serverSettings?.has_openrouter_api_key ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Saved
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-600 text-zinc-400 text-[10px]">Optional</Badge>
                )}
              </div>
              <SecretInput
                value={openrouterKey}
                onChange={setOpenrouterKey}
                placeholder="sk-or-..."
                hasValue={!!serverSettings?.has_openrouter_api_key}
              />
              <p className="text-[11px] text-zinc-500">
                For Magic Prompt via Claude (OpenRouter).{" "}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  openrouter.ai <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* ── Magic Prompt Backend ── */}
        <div className="space-y-3">
          <SectionTitle>Magic Prompt Backend</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-2">
            <Label className="text-sm text-zinc-200">Model</Label>
            <Select value={effectiveMpBackend} onValueChange={setMpBackend}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="ideogram" className="text-zinc-200">
                  Ideogram API — ideogram-4-v1
                </SelectItem>
                <SelectItem value="claude-sonnet" className="text-zinc-200">
                  Claude Sonnet (OpenRouter)
                </SelectItem>
                <SelectItem value="claude-opus" className="text-zinc-200">
                  Claude Opus (OpenRouter)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-500">
              Magic Prompt translates plain-English descriptions into structured Ideogram 4 captions.
            </p>
          </div>
        </div>

        {/* ── Model Status ── */}
        <div className="space-y-3">
          <SectionTitle>Model Status</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Status</span>
              <span className={cn(
                "font-medium capitalize",
                modelStatus?.status === "ready"   ? "text-emerald-400" :
                modelStatus?.status === "loading" ? "text-amber-400" :
                modelStatus?.status === "error"   ? "text-red-400" :
                "text-zinc-500"
              )}>
                {modelStatus?.status ?? "—"}
              </span>
            </div>
            {modelStatus?.variant && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Variant</span>
                <span className="text-zinc-300 font-mono">{modelStatus.variant.toUpperCase()}</span>
              </div>
            )}
            {vramGb && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">VRAM used</span>
                <span className="text-zinc-300">{vramGb} GB</span>
              </div>
            )}
            {modelStatus?.error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{modelStatus.error}</p>
            )}
          </div>
        </div>

        {/* ── About ── */}
        <div className="space-y-3">
          <SectionTitle>About</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-2 text-sm text-zinc-500">
            <p>Ideogram Studio — local inference frontend for Ideogram 4.0</p>
            <p>Model: 9.3B parameter single-stream DiT with Qwen3-VL-8B text encoder</p>
            <p className="text-[11px]">Weights: ideogram-ai/ideogram-4-fp8 · CalamitousFelicitousness/Ideogram-4-bf16-Diffusers</p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end pb-8">
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || (!hfToken && !ideogramKey && !openrouterKey && !mpBackend)}
            className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
