export interface PaletteMode {
  id: string
  label: string
  colors: string[]  // 5 representative hex colors
}

// Curated 5-colour combinations. Grouped loosely (brights → moody → nature →
// sweets → neutrals) but kept as a flat list so the picker can render them all.
export const PALETTE_MODES: PaletteMode[] = [
  // ── Brights / saturated ──────────────────────────────────────────────────
  { id: "vibrant",  label: "Vibrant",  colors: ["#FF3366", "#FF6600", "#FFCC00", "#00CCFF", "#9900FF"] },
  { id: "neon",     label: "Neon",     colors: ["#FF00FF", "#00FFFF", "#FF0080", "#80FF00", "#FF8000"] },
  { id: "candy",    label: "Candy",    colors: ["#FF6AD5", "#C774E8", "#AD8CFF", "#8795E8", "#94D0FF"] },
  { id: "tropical", label: "Tropical", colors: ["#FF6B35", "#F7C59F", "#EFEFD0", "#004E89", "#1A659E"] },
  { id: "pop",      label: "Pop",      colors: ["#F72585", "#7209B7", "#3A0CA3", "#4361EE", "#4CC9F0"] },
  { id: "rainbow",  label: "Rainbow",  colors: ["#E81416", "#FF8C00", "#FAEB36", "#79C314", "#487DE7"] },

  // ── Warm ─────────────────────────────────────────────────────────────────
  { id: "warm",     label: "Warm",     colors: ["#FF4500", "#FF7F00", "#FFA500", "#FFD700", "#FF6B6B"] },
  { id: "sunset",   label: "Sunset",   colors: ["#FF5E62", "#FF9966", "#FFC371", "#FFD86F", "#F6416C"] },
  { id: "autumn",   label: "Autumn",   colors: ["#8C2F00", "#B65C00", "#D98300", "#E8A33D", "#F4C77B"] },
  { id: "amber",    label: "Amber",    colors: ["#78350F", "#B45309", "#D97706", "#F59E0B", "#FCD34D"] },
  { id: "gold",     label: "Gold",     colors: ["#5C4400", "#8A6D00", "#B8950B", "#E0BC3C", "#F5D98B"] },
  { id: "coral",    label: "Coral",    colors: ["#FF6F61", "#FF8C7A", "#FFB199", "#FFD0C2", "#FFE8E0"] },

  // ── Cool ─────────────────────────────────────────────────────────────────
  { id: "cool",     label: "Cool",     colors: ["#003D99", "#0066CC", "#0099DD", "#00BBCC", "#4477FF"] },
  { id: "ocean",    label: "Ocean",    colors: ["#00B4DB", "#0083B0", "#005C97", "#363795", "#2C3E50"] },
  { id: "sky",      label: "Sky",      colors: ["#1E3A8A", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD"] },
  { id: "ice",      label: "Ice",      colors: ["#0C4A6E", "#0369A1", "#0EA5E9", "#7DD3FC", "#E0F2FE"] },
  { id: "teal",     label: "Teal",     colors: ["#134E4A", "#0F766E", "#14B8A6", "#5EEAD4", "#99F6E4"] },
  { id: "mint",     label: "Mint",     colors: ["#0B4F4A", "#1B7A6E", "#3FB59C", "#7FD8C4", "#BFF0E4"] },

  // ── Jewel / moody ────────────────────────────────────────────────────────
  { id: "jewel",    label: "Jewel",    colors: ["#0F3460", "#16213E", "#533483", "#A12568", "#E94560"] },
  { id: "berry",    label: "Berry",    colors: ["#4A0E2E", "#7A1C50", "#A8326E", "#D14D8B", "#F06FA6"] },
  { id: "wine",     label: "Wine",     colors: ["#3B0A1E", "#66122F", "#8C1D43", "#C03058", "#E85D75"] },
  { id: "plum",     label: "Plum",     colors: ["#2E1065", "#5B21B6", "#7C3AED", "#A78BFA", "#DDD6FE"] },
  { id: "lavender", label: "Lavender", colors: ["#4C1D95", "#6D28D9", "#8B5CF6", "#A78BFA", "#C4B5FD"] },
  { id: "crimson",  label: "Crimson",  colors: ["#4A0404", "#7A0A0A", "#B01818", "#E03131", "#F47171"] },
  { id: "midnight", label: "Midnight", colors: ["#0D1B2A", "#1B263B", "#415A77", "#778DA9", "#E0E1DD"] },

  // ── Nature / earth ───────────────────────────────────────────────────────
  { id: "earth",    label: "Earth",    colors: ["#7B3F00", "#CC6633", "#D2A679", "#4A7C59", "#8FBC8F"] },
  { id: "forest",   label: "Forest",   colors: ["#2D5016", "#3A6B35", "#4F9D69", "#8FBF7F", "#C9E4B4"] },
  { id: "emerald",  label: "Emerald",  colors: ["#064E3B", "#047857", "#059669", "#34D399", "#A7F3D0"] },
  { id: "olive",    label: "Olive",    colors: ["#3D3B1F", "#5C5A2E", "#898542", "#B5B06A", "#DAD79F"] },
  { id: "sand",     label: "Sand",     colors: ["#6B4F3A", "#997B5C", "#C2A878", "#E0CFA9", "#F2E8CF"] },
  { id: "coffee",   label: "Coffee",   colors: ["#3B2F2F", "#6F4E37", "#A1866F", "#C9B79C", "#E8DDD0"] },

  // ── Soft / sweet ─────────────────────────────────────────────────────────
  { id: "pastel",   label: "Pastel",   colors: ["#FFB3C6", "#FFDDB3", "#FFFEB3", "#B3FFCC", "#B3D9FF"] },
  { id: "rose",     label: "Rose",     colors: ["#7F1D3F", "#B02E5A", "#D6537E", "#F08AAE", "#FBC4D6"] },
  { id: "bubblegum",label: "Bubblegum",colors: ["#FF477E", "#FF7096", "#FF85A1", "#FBB1BD", "#F9BEC7"] },
  { id: "sorbet",   label: "Sorbet",   colors: ["#FFD6A5", "#FDFFB6", "#CAFFBF", "#9BF6FF", "#FFC6FF"] },

  // ── Neutral / retro ──────────────────────────────────────────────────────
  { id: "muted",    label: "Muted",    colors: ["#7A7170", "#8A8070", "#707A72", "#70727A", "#7A7080"] },
  { id: "mono",     label: "Mono",     colors: ["#111111", "#444444", "#888888", "#BBBBBB", "#EEEEEE"] },
  { id: "slate",    label: "Slate",    colors: ["#1E293B", "#334155", "#64748B", "#94A3B8", "#CBD5E1"] },
  { id: "retro",    label: "Retro",    colors: ["#2B2D42", "#8D99AE", "#EDF2F4", "#EF233C", "#D90429"] },
  { id: "vintage",  label: "Vintage",  colors: ["#6D6875", "#B5838D", "#E5989B", "#FFB4A2", "#FFCDB2"] },
]

// A flat grid of single colours for quick per-swatch picking — 11 hues × 5
// shades plus a neutral ramp. (The native colour wheel is still there for any
// exact value; these are the fast, good-looking presets.) All valid #RRGGBB.
export const SWATCHES: string[] = [
  // red
  "#FEE2E2", "#FCA5A5", "#EF4444", "#B91C1C", "#7F1D1D",
  // orange
  "#FFEDD5", "#FDBA74", "#F97316", "#C2410C", "#7C2D12",
  // amber / yellow
  "#FEF9C3", "#FDE047", "#EAB308", "#A16207", "#713F12",
  // lime / green
  "#DCFCE7", "#86EFAC", "#22C55E", "#15803D", "#14532D",
  // teal
  "#CCFBF1", "#5EEAD4", "#14B8A6", "#0F766E", "#134E4A",
  // cyan / sky
  "#CFFAFE", "#67E8F9", "#06B6D4", "#0E7490", "#155E75",
  // blue
  "#DBEAFE", "#93C5FD", "#3B82F6", "#1D4ED8", "#1E3A8A",
  // indigo / violet
  "#E0E7FF", "#A5B4FC", "#6366F1", "#4338CA", "#312E81",
  // purple
  "#F3E8FF", "#D8B4FE", "#A855F7", "#7E22CE", "#581C87",
  // pink / fuchsia
  "#FCE7F3", "#F9A8D4", "#EC4899", "#BE185D", "#831843",
  // rose
  "#FFE4E6", "#FDA4AF", "#F43F5E", "#BE123C", "#881337",
  // neutrals (white → black)
  "#FFFFFF", "#E5E7EB", "#9CA3AF", "#4B5563", "#1F2937", "#000000",
]
