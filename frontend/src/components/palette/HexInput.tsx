import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { isValidHex, normalizeHex } from "@/lib/caption"

interface HexInputProps {
  value: string
  onChange: (hex: string) => void
  className?: string
}

export function HexInput({ value, onChange, className }: HexInputProps) {
  const [local, setLocal] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase()
    setLocal(raw)
    const norm = normalizeHex(raw)
    if (isValidHex(norm)) onChange(norm)
  }

  const handleBlur = () => {
    const norm = normalizeHex(local)
    if (isValidHex(norm)) {
      setLocal(norm)
      onChange(norm)
    } else {
      setLocal(value)
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={local}
      onChange={handleChange}
      onBlur={handleBlur}
      maxLength={7}
      spellCheck={false}
      className={cn(
        "w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono",
        "text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500",
        "placeholder-zinc-600 uppercase",
        className
      )}
      placeholder="#RRGGBB"
    />
  )
}
