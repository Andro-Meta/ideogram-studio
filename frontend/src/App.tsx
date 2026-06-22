import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom"
import { Layers, Images, Settings, Brush, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useModelStatus } from "@/hooks/useModelStatus"
import { Generate } from "@/pages/Generate"
import { Gallery } from "@/pages/Gallery"
import { Editor } from "@/pages/Editor"
import { BooguEdit } from "@/pages/BooguEdit"
import { Settings as SettingsPage } from "@/pages/Settings"

const NAV_ITEMS = [
  { to: "/generate", icon: Layers,  label: "Generate" },
  { to: "/editor",   icon: Brush,   label: "Editor"   },
  { to: "/boogu",    icon: Wand2,   label: "Boogu"    },
  { to: "/gallery",  icon: Images,  label: "Gallery"  },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const

function ModelStatusChip() {
  const { data } = useModelStatus()
  const status = data?.status ?? "unloaded"

  const styles: Record<string, string> = {
    ready:       "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    downloading: "bg-sky-500/15    text-sky-300    border-sky-500/40",
    loading:     "bg-amber-500/15  text-amber-300  border-amber-500/40",
    error:       "bg-red-500/15    text-red-300    border-red-500/40",
    unloaded:    "bg-zinc-800      text-zinc-500   border-zinc-700",
  }
  const dot =
    status === "ready"    ? "bg-emerald-400" :
    status === "error"    ? "bg-red-400" :
    status === "unloaded" ? "bg-zinc-600" :
    "bg-amber-400 animate-pulse"
  const label =
    status === "downloading" && data?.download_pct != null
      ? `Downloading ${data.download_pct}%`
      : status === "ready" && data?.variant
        ? `${data.variant.toUpperCase()} ready`
        : status === "unloaded"
          ? "Model not loaded"
          : status

  return (
    <div
      className={cn(
        "ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium capitalize select-none",
        styles[status],
      )}
      title={data?.progress_message ?? data?.error ?? "Current model status"}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </div>
  )
}

function NavBar() {
  return (
    <header className="h-12 shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur flex items-center px-2 sm:px-4 gap-0.5 sm:gap-1 z-10">
      {/* Brand — icon always, wordmark only when there's room */}
      <div className="flex items-center gap-2 mr-1 sm:mr-5">
        <img src="/favicon.svg" alt="" className="h-6 w-6 rounded" />
        <span className="hidden sm:inline text-sm font-semibold text-zinc-100 tracking-tight">Ideogram Studio</span>
      </div>

      {/* Nav links — labels collapse to icons on narrow screens (phones) */}
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">{label}</span>
        </NavLink>
      ))}

      <ModelStatusChip />
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-screen flex flex-col overflow-hidden bg-zinc-950">
        <NavBar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/"         element={<Navigate to="/generate" replace />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/editor"   element={<Editor />} />
            <Route path="/boogu"    element={<BooguEdit />} />
            <Route path="/gallery"  element={<Gallery />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*"         element={<Navigate to="/generate" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
