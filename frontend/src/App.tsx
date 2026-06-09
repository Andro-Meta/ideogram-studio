import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom"
import { Layers, Images, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { Generate } from "@/pages/Generate"
import { Gallery } from "@/pages/Gallery"
import { Settings as SettingsPage } from "@/pages/Settings"

const NAV_ITEMS = [
  { to: "/generate", icon: Layers,  label: "Generate" },
  { to: "/gallery",  icon: Images,  label: "Gallery"  },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const

function NavBar() {
  return (
    <header className="h-12 shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur flex items-center px-4 gap-1 z-10">
      {/* Brand */}
      <div className="flex items-center gap-2 mr-5">
        <img src="/favicon.svg" alt="" className="h-6 w-6 rounded" />
        <span className="text-sm font-semibold text-zinc-100 tracking-tight">Ideogram Studio</span>
      </div>

      {/* Nav links */}
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
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
            <Route path="/gallery"  element={<Gallery />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*"         element={<Navigate to="/generate" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
