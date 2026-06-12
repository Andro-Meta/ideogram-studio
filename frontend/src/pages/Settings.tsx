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
import { Switch } from "@/components/ui/switch"
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
  const [orModel, setOrModel] = useState<string>("")
  const [autoStructure, setAutoStructure] = useState<boolean | null>(null)
  const [safetyOn, setSafetyOn] = useState<boolean | null>(null)
  const [hiveText, setHiveText] = useState("")
  const [hiveVisual, setHiveVisual] = useState("")

  const effectiveMpBackend = mpBackend || serverSettings?.magic_prompt_backend || "ideogram-4-v1"
  const effectiveOrModel = orModel || serverSettings?.openrouter_model || "google/gemma-4-31b-it:free"
  const effectiveAutoStructure = autoStructure ?? serverSettings?.auto_structure_prompt ?? false
  const effectiveSafety = safetyOn ?? serverSettings?.safety_moderation_enabled ?? false

  const handleSave = () => {
    const payload: SettingsUpdateRequest = {}
    if (hfToken)       payload.hf_token           = hfToken
    if (ideogramKey)   payload.ideogram_api_key    = ideogramKey
    if (openrouterKey) payload.openrouter_api_key  = openrouterKey
    if (mpBackend)     payload.magic_prompt_backend = mpBackend
    if (orModel)       payload.openrouter_model = orModel
    if (autoStructure !== null) payload.auto_structure_prompt = autoStructure
    if (safetyOn !== null) payload.safety_moderation_enabled = safetyOn
    if (hiveText)      payload.hive_text_key   = hiveText
    if (hiveVisual)    payload.hive_visual_key = hiveVisual
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
                Powers Magic Prompt + AI Fuse on OpenRouter (free models supported).{" "}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
                   className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-0.5">
                  Get a key <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <p className="text-[11px] text-amber-400/90">
                Use a regular <span className="font-medium">API key</span> from
                openrouter.ai/keys — not a <span className="font-medium">Provisioning / management
                key</span> (those manage your account and can't run inference, so they'll fail
                with a 401).
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
                  OpenRouter — your choice of model (free options) ★
                </SelectItem>
                <SelectItem value="ideogram-4-v1" className="text-zinc-200">
                  Ideogram API — ideogram-4-v1 (free)
                </SelectItem>
                <SelectItem value="claude-sonnet-v1" className="text-zinc-200">
                  Claude Sonnet (OpenRouter, paid)
                </SelectItem>
                <SelectItem value="claude-opus-v1" className="text-zinc-200">
                  Claude Opus (OpenRouter, paid)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-500">
              Magic Prompt translates plain-English descriptions into structured Ideogram 4 captions.
              Captions carry style inside the description prose, so your Style section is left
              untouched. OpenRouter backends need the OpenRouter key above.
            </p>

            {/* OpenRouter model picker — only relevant for the openrouter-v1 backend */}
            {effectiveMpBackend === "openrouter-v1" && (
              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <Label className="text-sm text-zinc-200">OpenRouter model</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "google/gemma-4-31b-it:free", label: "Gemma 4 (free)" },
                    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
                    { id: "qwen/qwen3-next-80b-a3b-instruct:free", label: "Qwen3 80B (free)" },
                    { id: "google/gemini-2.5-flash-lite", label: "Gemini Flash Lite (paid)" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setOrModel(m.id)}
                      className={cn(
                        "text-[10px] px-2 py-1 rounded border transition-colors",
                        effectiveOrModel === m.id
                          ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <Input
                  value={effectiveOrModel}
                  onChange={(e) => setOrModel(e.target.value)}
                  placeholder="any OpenRouter model id"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs font-mono"
                />
                <p className="text-[11px] text-zinc-500">
                  {effectiveOrModel.endsWith(":free") ? (
                    <>
                      <span className="text-emerald-400">Free model</span> — $0 to run. Free
                      providers are rate-limited (~20/min, 50/day, or 1000/day after a one-time
                      $10 credit purchase) and can be briefly busy, so the app auto-falls-back
                      across several free models. For no caps, pick a paid model.
                    </>
                  ) : (
                    <>
                      <span className="text-amber-400">Paid model</span> — small per-call cost
                      (Gemini Flash Lite ≈ $0.0001), but no daily caps and maximum reliability.
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="border-t border-zinc-800 pt-3 flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm text-zinc-200">Auto-structure prompts</Label>
                <p className="text-[11px] text-zinc-500">
                  Before each generation, expand a sparse prompt into a full structured-JSON
                  scene. Ideogram 4 throws its gray "safety filter" card far less often on
                  richly structured JSON than on bare prompts — this is the most reliable way to
                  cut those false refusals. Uses the backend above; your Style settings are kept.
                </p>
              </div>
              <Switch
                checked={effectiveAutoStructure}
                onCheckedChange={(v) => setAutoStructure(v)}
              />
            </div>
          </div>
        </div>

        {/* ── Content Safety ── */}
        <div className="space-y-3">
          <SectionTitle>Content Safety</SectionTitle>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm text-zinc-200">Content moderation (Hive)</Label>
                <p className="text-[11px] text-zinc-500">
                  Screen each prompt and image through Hive's moderation API and block on a hit.
                </p>
              </div>
              <Switch
                checked={effectiveSafety}
                onCheckedChange={(v) => setSafetyOn(v)}
              />
            </div>

            {effectiveSafety && (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Hive text-moderation key</Label>
                  <SecretInput
                    value={hiveText}
                    onChange={setHiveText}
                    placeholder="screens prompts"
                    hasValue={!!serverSettings?.has_hive_text_key}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Hive visual-moderation key</Label>
                  <SecretInput
                    value={hiveVisual}
                    onChange={setHiveVisual}
                    placeholder="screens generated images"
                    hasValue={!!serverSettings?.has_hive_visual_key}
                  />
                </div>
                {!serverSettings?.has_hive_text_key && !hiveText &&
                 !serverSettings?.has_hive_visual_key && !hiveVisual && (
                  <p className="text-[11px] text-amber-400/90">
                    Moderation is on but no Hive key is set — nothing will actually be screened
                    until you add a key. Get one at{" "}
                    <a href="https://thehive.ai" target="_blank" rel="noreferrer"
                       className="underline hover:text-amber-300">thehive.ai</a>.
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-800 pt-2">
              This is the only content filter in the app, and it's off by default — prompts and
              images are never sent anywhere unless you turn it on and add a key. It is separate
              from the model's own built-in refusals, which live in the weights and can't be
              toggled in software.
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
