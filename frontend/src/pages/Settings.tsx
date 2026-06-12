import { useState } from "react"
import {
  Eye, EyeOff, Save, Loader2, CheckCircle2, ExternalLink, Power, PowerOff,
  ScrollText, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import type { LogsResponse } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useModelStatus, useLoadModel, useUnloadModel } from "@/hooks/useModelStatus"
import { useSystemInfo, variantAssessment } from "@/hooks/useSystemInfo"
import { useFreeGpu } from "@/hooks/useFreeGpu"
import { useSettingsStore } from "@/stores/settingsStore"
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

function LogsViewer() {
  const [open, setOpen] = useState(false)
  const { data, isFetching, refetch } = useQuery<LogsResponse>({
    queryKey: ["logs"],
    queryFn: async () => {
      const res = await fetch("/api/logs?lines=300")
      if (!res.ok) throw new Error("Could not read logs")
      return res.json()
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  })

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm text-zinc-200">Application Log</p>
            <p className="text-[11px] text-zinc-500">
              Every download, model load, memory snapshot, and error — survives crashes
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>
      {open && (
        <div className="border-t border-zinc-700 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-600 font-mono truncate">{data?.path ?? "logs/app.log"}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            >
              <RefreshCw className={isFetching ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
              Refresh
            </button>
          </div>
          <pre className="text-[10px] leading-relaxed font-mono text-zinc-400 bg-zinc-950 rounded-lg p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
            {data?.lines.length ? data.lines.join("\n") : "No log entries yet."}
          </pre>
        </div>
      )}
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
  const { data: sysInfo } = useSystemInfo()
  const updateMutation = useUpdateSettings()
  const loadModelMutation = useLoadModel()
  const unloadModelMutation = useUnloadModel()
  const freeGpuMutation = useFreeGpu()
  const { modelVariant } = useSettingsStore()

  const [hfToken, setHfToken] = useState("")
  const [ideogramKey, setIdeogramKey] = useState("")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [mpBackend, setMpBackend] = useState<string>("")

  const effectiveMpBackend = mpBackend || serverSettings?.magic_prompt_backend || "ideogram-4-v1"

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

  const selectedAssessment = variantAssessment(sysInfo, modelVariant)
  const variantBlocked = sysInfo != null && (selectedAssessment?.blockers.length ?? 0) > 0

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
                <a href="https://huggingface.co/ideogram-ai/ideogram-4-nf4" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  ideogram-ai/ideogram-4-nf4 <ExternalLink className="h-3 w-3" />
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
                <SelectItem value="openrouter-v1" className="text-zinc-200">
                  OpenRouter — Gemini Flash Lite (fast, cheap)
                </SelectItem>
                <SelectItem value="ideogram-4-v1" className="text-zinc-200">
                  Ideogram API — ideogram-4-v1 (free)
                </SelectItem>
                <SelectItem value="claude-sonnet-v1" className="text-zinc-200">
                  Claude Sonnet (OpenRouter, premium)
                </SelectItem>
                <SelectItem value="claude-opus-v1" className="text-zinc-200">
                  Claude Opus (OpenRouter, premium)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-500">
              Magic Prompt translates plain-English descriptions into structured Ideogram 4 captions.
              Captions carry style inside the description prose, so your Style section is left
              untouched. OpenRouter backends need the OpenRouter key above.
            </p>
          </div>
        </div>

        {/* ── Hardware ── */}
        {sysInfo && (
          <div className="space-y-3">
            <SectionTitle>Hardware</SectionTitle>
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">GPU</span>
                <span className="text-zinc-300">
                  {sysInfo.gpu_name ?? "No CUDA GPU detected"}
                  {sysInfo.vram_total_gb != null && ` · ${sysInfo.vram_total_gb} GB VRAM`}
                </span>
              </div>
              {sysInfo.vram_free_gb != null && sysInfo.vram_total_gb != null && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">VRAM free right now</span>
                  <span className={cn(
                    sysInfo.vram_free_gb < sysInfo.vram_total_gb * 0.6
                      ? "text-amber-400" : "text-zinc-300"
                  )}>
                    {sysInfo.vram_free_gb} / {sysInfo.vram_total_gb} GB
                  </span>
                </div>
              )}
              {sysInfo.gpu_processes.length > 0 && (
                <div className="text-[11px] text-amber-400/90 bg-amber-500/10 rounded p-2 space-y-2">
                  <p>
                    Other apps are using your GPU: {sysInfo.gpu_processes.join(", ")}.
                    {sysInfo.gpu_processes.some((p) => p.toLowerCase().includes("ollama")) &&
                      " Ollama keeps models in VRAM after use — free them below (the Ollama server keeps running)."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] border-amber-600/50 bg-transparent hover:bg-amber-500/20 text-amber-300"
                    disabled={freeGpuMutation.isPending}
                    onClick={() => freeGpuMutation.mutate()}
                  >
                    {freeGpuMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      : null}
                    Free GPU memory
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">System RAM</span>
                <span className="text-zinc-300">
                  {sysInfo.ram_total_gb != null ? `${sysInfo.ram_total_gb} GB` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Free disk (models drive)</span>
                <span className="text-zinc-300">
                  {sysInfo.disk_free_gb != null ? `${sysInfo.disk_free_gb} GB` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Recommended variant</span>
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] font-mono">
                  {sysInfo.recommended_variant.toUpperCase()}
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-500 pt-1">
                Model weights are stored next to the app ({sysInfo.models_dir}) — not on the
                system drive — and every load is checked against your hardware first.
              </p>
            </div>
          </div>
        )}

        {/* ── Model Status ── */}
        <div className="space-y-3">
          <SectionTitle>Model</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Status</span>
              <span className={cn(
                "font-medium capitalize flex items-center gap-1.5",
                modelStatus?.status === "ready"       ? "text-emerald-400" :
                modelStatus?.status === "loading"     ? "text-amber-400" :
                modelStatus?.status === "downloading" ? "text-sky-400" :
                modelStatus?.status === "error"       ? "text-red-400" :
                "text-zinc-500"
              )}>
                {(modelStatus?.status === "loading" || modelStatus?.status === "downloading") &&
                  <Loader2 className="h-3 w-3 animate-spin" />}
                {modelStatus?.status ?? "—"}
              </span>
            </div>
            {modelStatus?.status === "downloading" && (
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all"
                    style={{ width: `${modelStatus.download_pct ?? 5}%` }}
                  />
                </div>
                <p className="text-[11px] text-sky-400/80">
                  {modelStatus.progress_message ?? "Downloading model weights…"}
                  {modelStatus.download_pct != null && ` (${modelStatus.download_pct}%)`}
                </p>
              </div>
            )}
            {modelStatus?.status === "loading" && modelStatus.progress_message && (
              <p className="text-[11px] text-amber-400/80">{modelStatus.progress_message}</p>
            )}
            {modelStatus?.variant && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Loaded variant</span>
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
            <div className="pt-1 flex gap-2">
              {(modelStatus?.status === "unloaded" || modelStatus?.status === "error") && (
                <Button
                  size="sm"
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs h-8 gap-1.5"
                  disabled={loadModelMutation.isPending || variantBlocked}
                  title={variantBlocked ? selectedAssessment!.blockers[0] : undefined}
                  onClick={() => loadModelMutation.mutate({ variant: modelVariant })}
                >
                  {loadModelMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Power className="h-3.5 w-3.5" />}
                  Load {modelVariant.toUpperCase()}
                </Button>
              )}
              {variantBlocked && (modelStatus?.status === "unloaded" || modelStatus?.status === "error") && (
                <p className="text-[11px] text-amber-400/90">
                  {selectedAssessment!.blockers[0]}
                </p>
              )}
              {modelStatus?.status === "ready" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-zinc-700 bg-zinc-800 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400 text-zinc-400 text-xs h-8 gap-1.5"
                  disabled={unloadModelMutation.isPending}
                  onClick={() => unloadModelMutation.mutate()}
                >
                  {unloadModelMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <PowerOff className="h-3.5 w-3.5" />}
                  Unload
                </Button>
              )}
              {modelStatus?.status === "loading" && (
                <p className="text-[11px] text-amber-400/80 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading weights into GPU memory — 20–40s
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Logs ── */}
        <div className="space-y-3">
          <SectionTitle>Diagnostics</SectionTitle>
          <LogsViewer />
        </div>

        {/* ── About ── */}
        <div className="space-y-3">
          <SectionTitle>About</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-2 text-sm text-zinc-500">
            <p>Ideogram Studio — local inference frontend for Ideogram 4.0</p>
            <p>Model: 9.3B parameter single-stream DiT with Qwen3-VL-8B text encoder</p>
            <p className="text-[11px]">Weights: ideogram-ai/ideogram-4-nf4 · ideogram-ai/ideogram-4-fp8 · CalamitousFelicitousness/Ideogram-4-bf16-Diffusers</p>
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
