/**
 * Built-in prompt/template library.
 *
 * Curated, original structured-caption starters that load straight into the
 * editor (high-level description + style + background + boxed elements). Inspired
 * by EvoLinkAI/awesome-ideogram-4.0-prompts, but every caption here is written
 * from scratch for this app (no copied prompt text) and exercises Ideogram 4's
 * strengths: typography, product/UI mockups, and photoreal portraits.
 *
 * Each template is a complete PromptState. Element ids are placeholders — the
 * loader assigns fresh uids on insert (see TemplateLibrary.tsx).
 */
import type { PromptState } from "@/types/caption"

export interface PromptTemplate {
  id: string
  title: string
  category: "Typography" | "Product" | "Portrait" | "UI" | "Branding" | "Scene"
  summary: string
  /** Suggested generation size (the loader applies it). */
  resolution?: { width: number; height: number }
  state: PromptState
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "poster-event",
    title: "Event Poster",
    category: "Typography",
    summary: "Bold headline poster with date and venue — Ideogram's text strength.",
    resolution: { width: 1024, height: 1280 },
    state: {
      high_level_description:
        "A bold modern concert poster with strong typographic hierarchy and a confident headline.",
      style_description: {
        mode: "illustration",
        aesthetics: "high-contrast graphic design, clean grid, generous negative space",
        lighting: "flat even studio lighting",
        medium: "vector poster design",
        art_style: "swiss typographic poster, bauhaus influence",
        photo: "",
        color_palette: ["#0B0B0B", "#F5F5F0", "#E63946"],
      },
      background:
        "A deep charcoal background with a single diagonal crimson band crossing the lower third.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 120, xmin: 90, ymax: 360, xmax: 910 },
          text: "NIGHT SIGNAL", desc: "Massive condensed sans-serif headline in off-white.", color_palette: ["#F5F5F0"] },
        { id: "t-2", type: "text", bbox: { ymin: 700, xmin: 110, ymax: 800, xmax: 890 },
          text: "SAT 14 NOV", desc: "Medium-weight date line in crimson.", color_palette: ["#E63946"] },
        { id: "t-3", type: "text", bbox: { ymin: 820, xmin: 110, ymax: 900, xmax: 890 },
          text: "THE MET • DOORS 8PM", desc: "Small uppercase venue line, tracked-out, off-white.", color_palette: ["#F5F5F0"] },
      ],
    },
  },
  {
    id: "product-bottle",
    title: "Product Hero (Bottle)",
    category: "Product",
    summary: "Studio product shot with a clean label — e-commerce hero.",
    resolution: { width: 1024, height: 1024 },
    state: {
      high_level_description:
        "A premium skincare serum bottle photographed as a clean studio product hero.",
      style_description: {
        mode: "photo",
        aesthetics: "minimal premium product photography, soft reflections",
        lighting: "soft diffused softbox lighting with a gentle gradient backdrop",
        medium: "high-resolution product photograph",
        art_style: "",
        photo: "85mm macro, shallow depth of field",
        color_palette: ["#EAE6DF", "#1C2B26", "#C7A36A"],
      },
      background:
        "A seamless warm-beige studio sweep with a soft shadow grounding the product.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 180, xmin: 360, ymax: 880, xmax: 640 },
          desc: "A frosted glass dropper bottle, dark green cap, centered and upright.", color_palette: ["#1C2B26"] },
        { id: "t-1", type: "text", bbox: { ymin: 440, xmin: 410, ymax: 560, xmax: 590 },
          text: "LUMEN", desc: "Minimal gold serif wordmark on the bottle label.", color_palette: ["#C7A36A"] },
      ],
    },
  },
  {
    id: "portrait-editorial",
    title: "Editorial Portrait",
    category: "Portrait",
    summary: "Photoreal close-up portrait with controlled lighting.",
    resolution: { width: 1024, height: 1280 },
    state: {
      high_level_description:
        "A photoreal editorial portrait of a woman with natural skin texture and a calm expression.",
      style_description: {
        mode: "photo",
        aesthetics: "editorial fashion photography, fine skin detail, natural retouch",
        lighting: "soft window key light from the left, gentle falloff",
        medium: "full-frame photograph",
        art_style: "",
        photo: "85mm portrait lens, f/1.8, shallow depth of field",
        color_palette: ["#3A2E27", "#D9C4B0", "#7A8B7F"],
      },
      background:
        "A muted sage-green painted studio wall, softly out of focus.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 80, xmin: 200, ymax: 1000, xmax: 800 },
          desc: "A woman in her thirties, freckled skin, natural curls, wearing a cream knit; three-quarter view.", color_palette: [] },
      ],
    },
  },
  {
    id: "ui-app-mockup",
    title: "App UI Mockup",
    category: "UI",
    summary: "Clean mobile app screen with legible UI text and labels.",
    resolution: { width: 768, height: 1024 },
    state: {
      high_level_description:
        "A clean mobile banking app home screen mockup with a card and clear UI labels.",
      style_description: {
        mode: "illustration",
        aesthetics: "modern flat UI design, rounded cards, soft shadows",
        lighting: "flat UI lighting",
        medium: "digital interface mockup",
        art_style: "material-inspired product UI",
        photo: "",
        color_palette: ["#0E1726", "#3B82F6", "#F8FAFC", "#22C55E"],
      },
      background:
        "A light off-white app canvas with a soft blue gradient header panel at the top.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 60, xmin: 80, ymax: 150, xmax: 600 },
          text: "Good morning, Alex", desc: "Header greeting in white, medium weight.", color_palette: ["#F8FAFC"] },
        { id: "o-1", type: "obj", bbox: { ymin: 200, xmin: 70, ymax: 430, xmax: 930 },
          desc: "A rounded balance card with a subtle shadow.", color_palette: ["#FFFFFF"] },
        { id: "t-2", type: "text", bbox: { ymin: 250, xmin: 110, ymax: 360, xmax: 880 },
          text: "$4,820.17", desc: "Large balance figure in dark navy.", color_palette: ["#0E1726"] },
        { id: "t-3", type: "text", bbox: { ymin: 720, xmin: 90, ymax: 800, xmax: 910 },
          text: "Send   Request   Pay", desc: "A row of three action labels.", color_palette: ["#3B82F6"] },
      ],
    },
  },
  {
    id: "branding-badge",
    title: "Logo / Badge",
    category: "Branding",
    summary: "Circular emblem badge with centered lettering.",
    resolution: { width: 1024, height: 1024 },
    state: {
      high_level_description:
        "A circular vintage coffee-roaster emblem badge with centered lettering and a small icon.",
      style_description: {
        mode: "illustration",
        aesthetics: "vintage badge logo, clean linework, symmetrical",
        lighting: "flat",
        medium: "vector logo",
        art_style: "retro emblem / crest design",
        photo: "",
        color_palette: ["#2B1B12", "#E8DCC8", "#B5651D"],
      },
      background: "A solid cream background with a faint concentric ring guide.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 120, xmin: 120, ymax: 880, xmax: 880 },
          desc: "A double-ring circular badge outline with small star separators.", color_palette: ["#2B1B12"] },
        { id: "t-1", type: "text", bbox: { ymin: 420, xmin: 280, ymax: 560, xmax: 720 },
          text: "NORTHWELL", desc: "Bold centered serif wordmark.", color_palette: ["#2B1B12"] },
        { id: "t-2", type: "text", bbox: { ymin: 570, xmin: 330, ymax: 650, xmax: 670 },
          text: "COFFEE ROASTERS", desc: "Small tracked-out subtitle.", color_palette: ["#B5651D"] },
      ],
    },
  },
  {
    id: "scene-storefront",
    title: "Storefront Scene",
    category: "Scene",
    summary: "Cozy street-level shop with a readable hanging sign.",
    resolution: { width: 1280, height: 1024 },
    state: {
      high_level_description:
        "A cozy corner bookshop storefront at dusk with a warm, readable hanging sign.",
      style_description: {
        mode: "photo",
        aesthetics: "warm cinematic street photography, inviting atmosphere",
        lighting: "golden-hour glow with warm interior light spilling onto the pavement",
        medium: "photograph",
        art_style: "",
        photo: "35mm, f/2.8",
        color_palette: ["#2A1E12", "#E2A93B", "#6B4E2E"],
      },
      background:
        "A brick storefront with large windows full of stacked books, wet cobblestones reflecting warm light.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 120, xmin: 380, ymax: 300, xmax: 720 },
          desc: "A wooden hanging shop sign on wrought-iron brackets.", color_palette: ["#6B4E2E"] },
        { id: "t-1", type: "text", bbox: { ymin: 160, xmin: 410, ymax: 270, xmax: 690 },
          text: "MARGIN & CO.", desc: "Hand-painted gold serif shop name on the sign.", color_palette: ["#E2A93B"] },
      ],
    },
  },
  {
    id: "typography-quote",
    title: "Quote Card",
    category: "Typography",
    summary: "Social quote card with a single elegant line of text.",
    resolution: { width: 1024, height: 1024 },
    state: {
      high_level_description:
        "A minimalist social media quote card with a single elegant line of centered text.",
      style_description: {
        mode: "illustration",
        aesthetics: "minimal editorial typography, lots of breathing room",
        lighting: "flat",
        medium: "graphic design",
        art_style: "modern serif editorial",
        photo: "",
        color_palette: ["#F2EFE9", "#1A1A1A", "#9C7A4B"],
      },
      background: "A warm paper-white background with a thin gold rule near the bottom.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 360, xmin: 140, ymax: 640, xmax: 860 },
          text: "Make it simple,\nbut significant.", desc: "Large centered serif quote in near-black. Render each line as its own text element if needed.", color_palette: ["#1A1A1A"] },
        { id: "t-2", type: "text", bbox: { ymin: 720, xmin: 360, ymax: 800, xmax: 640 },
          text: "— STUDIO NOTES", desc: "Small tracked attribution in muted gold.", color_palette: ["#9C7A4B"] },
      ],
    },
  },
  {
    id: "product-packaging",
    title: "Packaging Mockup",
    category: "Product",
    summary: "Standing pouch / box with brand text on a colored sweep.",
    resolution: { width: 1024, height: 1024 },
    state: {
      high_level_description:
        "A standing coffee bag packaging mockup on a bold colored studio sweep.",
      style_description: {
        mode: "photo",
        aesthetics: "clean commercial packaging photography",
        lighting: "soft top-left key with a subtle rim light",
        medium: "product photograph",
        art_style: "",
        photo: "50mm, f/8, sharp throughout",
        color_palette: ["#1E3A34", "#F4E9D8", "#D08C3F"],
      },
      background: "A saturated teal seamless sweep with a soft contact shadow.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 160, xmin: 330, ymax: 880, xmax: 670 },
          desc: "A matte kraft coffee pouch with a flat top seal, standing upright.", color_palette: ["#F4E9D8"] },
        { id: "t-1", type: "text", bbox: { ymin: 420, xmin: 380, ymax: 540, xmax: 620 },
          text: "DAYBREAK", desc: "Bold centered brand name printed on the pouch.", color_palette: ["#1E3A34"] },
        { id: "t-2", type: "text", bbox: { ymin: 545, xmin: 400, ymax: 610, xmax: 600 },
          text: "WHOLE BEAN • 340g", desc: "Small product detail line.", color_palette: ["#D08C3F"] },
      ],
    },
  },
  {
    id: "branding-magazine",
    title: "Magazine Cover",
    category: "Branding",
    summary: "Masthead + cover lines over a portrait — heavy on legible text.",
    resolution: { width: 1024, height: 1280 },
    state: {
      high_level_description:
        "A modern fashion magazine cover: a confident masthead, a portrait, and a few cover lines.",
      style_description: {
        mode: "photo",
        aesthetics: "glossy editorial magazine cover, bold layout",
        lighting: "studio beauty lighting, soft and even",
        medium: "magazine cover photograph + typography",
        art_style: "",
        photo: "85mm, f/2",
        color_palette: ["#101010", "#FFFFFF", "#D7263D"],
      },
      background:
        "A subject in a bold red blazer against a clean light-gray studio backdrop, framed for cover text.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 50, xmin: 90, ymax: 190, xmax: 910 },
          text: "VANTAGE", desc: "Large bold masthead across the top in black.", color_palette: ["#101010"] },
        { id: "t-2", type: "text", bbox: { ymin: 430, xmin: 70, ymax: 520, xmax: 470 },
          text: "The Bold Issue", desc: "White cover line, upper-left.", color_palette: ["#FFFFFF"] },
        { id: "t-3", type: "text", bbox: { ymin: 860, xmin: 70, ymax: 940, xmax: 520 },
          text: "STYLE THAT SPEAKS", desc: "Red lower cover line, tracked-out.", color_palette: ["#D7263D"] },
        { id: "o-1", type: "obj", bbox: { ymin: 200, xmin: 200, ymax: 1000, xmax: 800 },
          desc: "A model in a red blazer, three-quarter view, calm confident expression.", color_palette: ["#D7263D"] },
      ],
    },
  },
  {
    id: "typography-neon",
    title: "3D Neon Sign",
    category: "Typography",
    summary: "Glowing neon lettering against a dark wall — punchy 3D text.",
    resolution: { width: 1280, height: 1024 },
    state: {
      high_level_description:
        "A glowing neon sign spelling a single word, mounted on a dark textured wall at night.",
      style_description: {
        mode: "photo",
        aesthetics: "vibrant neon glow, moody night ambience, soft bloom",
        lighting: "neon self-illumination with colored spill on the wall",
        medium: "photograph of a neon sign",
        art_style: "",
        photo: "35mm, f/1.8",
        color_palette: ["#0B0F1A", "#FF3CAC", "#2BD2FF"],
      },
      background: "A dark brick wall with subtle texture and a faint colored glow reflecting off it.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 330, xmin: 200, ymax: 670, xmax: 800 },
          text: "DREAM", desc: "Large glowing pink-and-cyan neon script, centered, with realistic tube highlights and bloom.", color_palette: ["#FF3CAC", "#2BD2FF"] },
      ],
    },
  },
  {
    id: "scene-childrens-book",
    title: "Children's Book",
    category: "Scene",
    summary: "Warm storybook illustration with a friendly character.",
    resolution: { width: 1280, height: 1024 },
    state: {
      high_level_description:
        "A warm children's storybook illustration of a small fox exploring a glowing forest at night.",
      style_description: {
        mode: "illustration",
        aesthetics: "cozy storybook illustration, soft shapes, gentle texture",
        lighting: "soft moonlight with warm firefly glow",
        medium: "digital children's book illustration",
        art_style: "watercolor + gouache picture-book style",
        photo: "",
        color_palette: ["#1B2A4A", "#E8A53D", "#7FB069"],
      },
      background:
        "A whimsical night forest with rounded trees, drifting fireflies, and a soft starry sky.",
      elements: [
        { id: "o-1", type: "obj", bbox: { ymin: 460, xmin: 420, ymax: 880, xmax: 700 },
          desc: "A small round-cheeked fox with a tiny lantern, looking up in wonder.", color_palette: ["#E8A53D"] },
        { id: "o-2", type: "obj", bbox: { ymin: 300, xmin: 120, ymax: 520, xmax: 320 },
          desc: "A cluster of glowing fireflies forming a gentle swirl.", color_palette: ["#E8A53D"] },
      ],
    },
  },
  {
    id: "ui-infographic",
    title: "Infographic Stat",
    category: "UI",
    summary: "Single big-number stat block with a label — clean data viz.",
    resolution: { width: 1024, height: 1024 },
    state: {
      high_level_description:
        "A clean single-stat infographic card with a big number, a label, and a small icon.",
      style_description: {
        mode: "illustration",
        aesthetics: "modern flat infographic, generous whitespace, clear hierarchy",
        lighting: "flat",
        medium: "vector infographic",
        art_style: "minimal data-visualization design",
        photo: "",
        color_palette: ["#0F172A", "#22D3EE", "#F1F5F9"],
      },
      background: "A soft off-white card with a subtle rounded border and a faint cyan accent corner.",
      elements: [
        { id: "t-1", type: "text", bbox: { ymin: 300, xmin: 150, ymax: 560, xmax: 850 },
          text: "87%", desc: "Huge bold stat number in deep navy, centered.", color_palette: ["#0F172A"] },
        { id: "t-2", type: "text", bbox: { ymin: 600, xmin: 200, ymax: 700, xmax: 800 },
          text: "of users finished onboarding", desc: "A concise label line in muted slate.", color_palette: ["#0F172A"] },
        { id: "o-1", type: "obj", bbox: { ymin: 120, xmin: 460, ymax: 260, xmax: 600 },
          desc: "A simple cyan circular checkmark badge.", color_palette: ["#22D3EE"] },
      ],
    },
  },
]

export const TEMPLATE_CATEGORIES = [
  "Typography", "Product", "Portrait", "UI", "Branding", "Scene",
] as const
