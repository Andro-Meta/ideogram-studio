export interface PaletteMode {
  id: string
  label: string
  colors: string[]  // 5 representative hex colors
}

export const PALETTE_MODES: PaletteMode[] = [
  {
    id: "vibrant",
    label: "Vibrant",
    colors: ["#FF3366", "#FF6600", "#FFCC00", "#00CCFF", "#9900FF"],
  },
  {
    id: "warm",
    label: "Warm",
    colors: ["#FF4500", "#FF7F00", "#FFA500", "#FFD700", "#FF6B6B"],
  },
  {
    id: "cool",
    label: "Cool",
    colors: ["#003D99", "#0066CC", "#0099DD", "#00BBCC", "#4477FF"],
  },
  {
    id: "pastel",
    label: "Pastel",
    colors: ["#FFB3C6", "#FFDDB3", "#FFFEB3", "#B3FFCC", "#B3D9FF"],
  },
  {
    id: "neon",
    label: "Neon",
    colors: ["#FF00FF", "#00FFFF", "#FF0080", "#80FF00", "#FF8000"],
  },
  {
    id: "earth",
    label: "Earth",
    colors: ["#7B3F00", "#CC6633", "#D2A679", "#4A7C59", "#8FBC8F"],
  },
  {
    id: "muted",
    label: "Muted",
    colors: ["#7A7170", "#8A8070", "#707A72", "#70727A", "#7A7080"],
  },
  {
    id: "mono",
    label: "Mono",
    colors: ["#111111", "#444444", "#888888", "#BBBBBB", "#EEEEEE"],
  },
]
