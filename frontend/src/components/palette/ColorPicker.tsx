import { cn } from "@/lib/utils"
import { isValidHex } from "@/lib/caption"
import { SWATCHES } from "@/lib/colorPalettes"
import { HexInput } from "./HexInput"

interface ColorPickerProps {
  /** Current color (`#RRGGBB`) — used to highlight the active swatch. */
  value: string
  /** Called when a color is chosen via wheel, hex, or swatch. */
  onPick: (hex: string) => void
  /** Called after a swatch click (e.g. to close a popover). */
  onClose?: () => void
  className?: string
}

/**
 * The shared color-picker body: a native color wheel (any shade), a hex field,
 * and the SWATCHES quick-grid. Used by ColorSwatch (palette editor) and the
 * draw-tools toolbar so both offer the same rich choice.
 */
export function ColorPicker({ value, onPick, onClose, className }: ColorPickerProps) {
  const wheelValue = isValidHex(value) ? value : "#000000"

  return (
    <div
      className={cn(
        "w-[280px] rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-xl space-y-2.5",
        className,
      )}
    >
      {/* Wheel + hex */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={wheelValue}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          className="h-9 w-9 shrink-0 cursor-pointer rounded border border-zinc-700 bg-transparent p-0.5"
          title="Color wheel — pick any color"
          aria-label="Color wheel"
        />
        <HexInput value={isValidHex(value) ? value : ""} onChange={onPick} className="w-28" />
        <span className="text-[10px] text-zinc-500 leading-tight">
          Wheel for any shade,<br />or tap a swatch.
        </span>
      </div>

      {/* Quick swatch grid */}
      <div className="grid grid-cols-12 gap-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { onPick(c); onClose?.() }}
            title={c}
            className={cn(
              "h-4 w-4 rounded-sm border transition-transform hover:scale-110",
              c.toUpperCase() === value.toUpperCase()
                ? "border-white ring-1 ring-violet-400"
                : "border-black/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  )
}
