# Ideogram 4.0 Local Studio — Project Reference

> **Source of truth for all implementation.** Every API signature, parameter name, and
> constraint in this document was verified against live source code or official documentation.
> No guesswork. Update this file if anything is found to differ during implementation.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [JSON Caption Format](#4-json-caption-format) ← read this before touching anything else
5. [Backend Design](#5-backend-design)
6. [Frontend Design](#6-frontend-design)
7. [Installation Scripts](#7-installation-scripts)
8. [Environment Variables](#8-environment-variables)
9. [Critical Implementation Notes](#9-critical-implementation-notes)

---

## 1. Project Overview

A browser-based local image-generation studio for **Ideogram 4.0** — a 9.3B-parameter
single-stream Diffusion Transformer that uses structured JSON captions for unparalleled
text rendering and layout control.

### What the user can do

- Type a plain English description → Magic Prompt converts it to structured JSON automatically
- Or use the visual editor to build/tweak JSON without seeing raw JSON
- Draw bounding boxes on a canvas to place objects and text elements precisely
- Pick colors per element and globally via hex color pickers
- Switch between Photo and Illustration style modes
- Choose sampler presets (Turbo / Default / Quality)
- Select resolution from presets or custom width/height
- Toggle between fp8 (~13 GB VRAM) and bf16 (~22 GB VRAM) model variants
- Browse generation history in a gallery, reload any previous generation into the editor
- Download images, copy seeds, delete history entries

### What it is not

Ideogram 4.0 is **text-to-image only**. There is no img2img, inpainting, or ControlNet.
"Edit" means editing the structured prompt of a prior generation and re-running it.

---

## 2. Architecture

```
Browser (React SPA)
       │
       │  HTTP  →  GET /api/*   (REST: gallery, settings, magic-prompt, model status)
       │  WS    →  /ws/{job_id} (real-time generation progress)
       │  GET / →  served static files (compiled React dist/)
       ▼
FastAPI Server (port 8000, single process, single worker)
       │
       ├── StaticFiles  →  dist/        (compiled React app)
       ├── REST routes  →  /api/*
       ├── WebSocket    →  /ws/{job_id}
       │
       ├── InferencePipeline (abstract)
       │     ├── FP8Pipeline   (ideogram4 package → ideogram-ai/ideogram-4-fp8)
       │     └── BF16Pipeline  (diffusers → CalamitousFelicitousness/Ideogram-4-bf16-Diffusers)
       │
       ├── MagicPromptService
       │     ├── Ideogram4MagicPromptV1  (Ideogram API — default)
       │     ├── ClaudeSonnetMagicPromptV1 (OpenRouter)
       │     └── ClaudeOpusMagicPromptV1   (OpenRouter)
       │
       ├── CaptionVerifier  (validates JSON before sending to model)
       │
       └── aiosqlite (SQLite at app.db)
             └── jobs table (all generation history)
```

**Key runtime facts:**
- `--workers 1` always — multiple workers would each load the model into VRAM
- Model stays loaded in VRAM between generations (warm start)
- Static files served from `dist/` at root; all API routes prefixed `/api/`; WebSocket at `/ws/`
- Dev mode: Vite dev server at 5173 proxies `/api/*` and `/ws/*` to FastAPI at 8000

---

## 3. Project Structure

```
E:\IdeoGram_4\
│
├── backend/
│   ├── main.py              # FastAPI app, lifespan, all route registrations
│   ├── inference.py         # Abstract InferencePipeline + FP8Pipeline + BF16Pipeline
│   ├── magic_prompt.py      # MagicPromptService wrapping ideogram4's magic_prompt module
│   ├── caption.py           # CaptionBuilder (dict → ordered dict → minified JSON string)
│   ├── gallery.py           # GalleryService — async CRUD over SQLite jobs table
│   ├── settings.py          # AppSettings (Pydantic BaseSettings, reads .env)
│   ├── schemas.py           # Pydantic request/response models for all REST endpoints
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── canvas/
│   │   │   │   ├── BBoxCanvas.tsx       # Main drag-and-drop bounding box editor
│   │   │   │   ├── BBoxRect.tsx         # Individual draggable/resizable element box
│   │   │   │   └── CanvasOverlay.tsx    # Transparent overlay above generated image
│   │   │   ├── elements/
│   │   │   │   ├── ElementList.tsx      # Ordered list of all elements in the prompt
│   │   │   │   ├── ElementCard.tsx      # Single element (obj or text) editor card
│   │   │   │   ├── AddElementMenu.tsx   # Dropdown: "+ Add Object" / "+ Add Text"
│   │   │   │   └── ElementTypeBadge.tsx # "OBJ" / "TEXT" pill badge
│   │   │   ├── palette/
│   │   │   │   ├── PaletteEditor.tsx    # Color palette editor (global or per-element)
│   │   │   │   ├── ColorSwatch.tsx      # Single hex color chip with picker popup
│   │   │   │   └── HexInput.tsx         # #RRGGBB uppercase-enforced text input
│   │   │   ├── style/
│   │   │   │   ├── StylePanel.tsx       # Tabs: Photo | Illustration
│   │   │   │   ├── PhotoStyleForm.tsx   # aesthetics, lighting, photo, medium, palette
│   │   │   │   └── IllustrationStyleForm.tsx # aesthetics, lighting, medium, art_style, palette
│   │   │   ├── controls/
│   │   │   │   ├── SamplerPresetPicker.tsx  # 3-card selector: Turbo/Default/Quality
│   │   │   │   ├── ResolutionPicker.tsx     # Aspect ratio grid + custom W×H inputs
│   │   │   │   ├── ModelVariantToggle.tsx   # fp8 / bf16 toggle with VRAM indicator
│   │   │   │   └── SeedControl.tsx          # Random/fixed seed + seed number input
│   │   │   ├── prompt/
│   │   │   │   ├── PromptBar.tsx        # Natural language input + Magic Prompt button
│   │   │   │   ├── MagicPromptStatus.tsx # Spinner/result toast while API call runs
│   │   │   │   └── HighLevelDescription.tsx # Textarea for high_level_description field
│   │   │   ├── gallery/
│   │   │   │   ├── GalleryGrid.tsx      # Masonry grid of all past generations
│   │   │   │   ├── GalleryCard.tsx      # Single image card with hover actions
│   │   │   │   └── GalleryDetail.tsx    # Full-screen detail: image + prompt + metadata
│   │   │   └── ui/                      # shadcn/ui components (auto-generated, do not edit)
│   │   │
│   │   ├── pages/
│   │   │   ├── Generate.tsx    # Main 3-column creation page
│   │   │   ├── Gallery.tsx     # Full-page history browser
│   │   │   └── Settings.tsx    # Model config, API keys, output dir
│   │   │
│   │   ├── stores/
│   │   │   ├── promptStore.ts     # Zustand: the entire structured prompt state
│   │   │   ├── generationStore.ts # Zustand: active job, progress, last result
│   │   │   └── settingsStore.ts   # Zustand: persisted app settings (localStorage)
│   │   │
│   │   ├── hooks/
│   │   │   ├── useGenerate.ts      # Manages WebSocket lifecycle for a generation job
│   │   │   ├── useMagicPrompt.ts   # TanStack Query mutation for /api/magic-prompt
│   │   │   ├── useGallery.ts       # TanStack Query for gallery CRUD
│   │   │   └── useModelStatus.ts   # Polls /api/model/status on mount
│   │   │
│   │   ├── types/
│   │   │   ├── caption.ts    # TypeScript types mirroring the JSON caption schema
│   │   │   ├── api.ts        # Request/response types matching backend schemas.py
│   │   │   └── gallery.ts    # Gallery item type
│   │   │
│   │   ├── lib/
│   │   │   ├── caption.ts    # captionToJSON(), jsonToCaption(), validateCaption()
│   │   │   ├── bbox.ts       # pixelToNorm(), normToPixel(), clampBBox()
│   │   │   └── utils.ts      # shadcn cn() helper (auto-generated)
│   │   │
│   │   ├── App.tsx           # Router setup (React Router v7)
│   │   ├── main.tsx          # ReactDOM.createRoot entry point
│   │   └── index.css         # @import "tailwindcss"; + CSS variables
│   │
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   └── components.json       # shadcn/ui config (auto-generated by init)
│
├── outputs/                  # Generated PNG files (created at runtime)
├── app.db                    # SQLite database (created at runtime)
├── .env.example              # Template for required environment variables
├── .env                      # Actual env file (gitignored)
├── install.bat               # One-time setup: venv + pip + npm + build
└── run.bat                   # Start server + open browser
```

---

## 4. JSON Caption Format

**Source:** `ideogram-oss/ideogram4` — `src/ideogram4/caption_verifier.py` and `docs/prompting.md`

This is the format the model was trained on. The `CaptionVerifier` emits *warnings* (not hard
errors) for violations, but violations degrade output quality because the model was trained on
strictly conformant captions.

### 4.1 Top-level structure

```json
{
  "high_level_description": "...",
  "style_description": { ... },
  "compositional_deconstruction": { ... }
}
```

| Key | Type | Required | Constraint |
|-----|------|----------|------------|
| `high_level_description` | string | Optional | ≤ 50 words (from system prompt) |
| `style_description` | object | Optional | See §4.2 |
| `compositional_deconstruction` | object | **Required** | See §4.3 |

Only these three keys are allowed at top level. Any other key triggers an "unknown keys" warning.

### 4.2 `style_description`

Must contain **exactly one** of `photo` or `art_style` — never both, never neither.

**Photo branch** — key order is mandatory:
```
aesthetics → lighting → photo → medium → [color_palette]
```

**Illustration branch** — key order is mandatory:
```
aesthetics → lighting → medium → art_style → [color_palette]
```

| Field | Type | Branch | Description |
|-------|------|--------|-------------|
| `aesthetics` | string | both | Keywords: `"warm, cinematic, moody"` |
| `lighting` | string | both | `"golden hour, rim light from upper left"` |
| `photo` | string | photo only | `"35mm, f/1.4, bokeh, slight film grain"` |
| `medium` | string | both | Free-form — `"photograph"`, `"illustration"`, `"graphic_design"`, etc. No enum. |
| `art_style` | string | illustration only | `"flat vector, bold outlines, geometric"` |
| `color_palette` | list[string] | both | Optional. Max **16** colors. Format: `#RRGGBB` uppercase. |

Known keys exactly (verifier validates against this set):
`aesthetics`, `lighting`, `photo`, `art_style`, `medium`, `color_palette`

### 4.3 `compositional_deconstruction`

```
background → elements
```

Both are required; `background` must appear before `elements`.

| Field | Type | Description |
|-------|------|-------------|
| `background` | string | Environment/setting description |
| `elements` | list[object] | Ordered list of visual elements |

### 4.4 Elements

Two valid element types: `"obj"` and `"text"`. No others.

**Object element** — key order:
```
type → [bbox] → desc → [color_palette]
```

**Text element** — key order:
```
type → [bbox] → text → desc → [color_palette]
```

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `type` | string | Yes | `"obj"` or `"text"` only |
| `bbox` | list[int] | Optional | `[ymin, xmin, ymax, xmax]` — see §4.5 |
| `text` | string | `"text"` type only | Literal string to render. Use `\n` for line breaks. |
| `desc` | string | Yes | 30–60 words; hard cap 60 words (from system prompt) |
| `color_palette` | list[string] | Optional | Max **5** colors per element. Same `#RRGGBB` format. |

Known element keys exactly: `type`, `bbox`, `text`, `desc`, `color_palette`

### 4.5 Bounding Box

Sourced directly from `CaptionVerifier._verify_bbox()`:

```
bbox = [ymin, xmin, ymax, xmax]
```

| Property | Value |
|----------|-------|
| Order | **Y first**: `[ymin, xmin, ymax, xmax]` |
| Type | All four values must be `int` (not float) |
| Range | `0` to `1000` inclusive (normalized, not 0–1) |
| Origin | Top-left corner |
| Constraints | `ymin <= ymax`, `xmin <= xmax` |
| Optional | Yes — omit the key entirely; do **not** include `"bbox": null` |

Pixel → normalized conversion:
```python
ymin = int((rect_top    / canvas_height) * 1000)
xmin = int((rect_left   / canvas_width)  * 1000)
ymax = int((rect_bottom / canvas_height) * 1000)
xmax = int((rect_right  / canvas_width)  * 1000)
```

### 4.6 Color Palette Format

```python
# Verifier check:
len(color) == 7
color[0] == "#"
all(c in "0123456789ABCDEF" for c in color[1:])
```

- Exactly 7 characters: `#` + 6 uppercase hex digits
- Lowercase hex (`#ff0000`) is invalid — must be `#FF0000`
- Shorthand (`#F00`) is invalid
- Max 16 colors in `style_description.color_palette`
- Max 5 colors in any element's `color_palette`

### 4.7 Serialization

```python
json.dumps(caption, separators=(",", ":"), ensure_ascii=False)
```

- Minified — no spaces after `:` or `,`
- `ensure_ascii=False` — non-ASCII stored as literal UTF-8, not `\uXXXX`

### 4.8 Minimal Valid Caption

```json
{"compositional_deconstruction":{"background":"A white studio background.","elements":[{"type":"obj","desc":"A red apple centered on a clean white surface."}]}}
```

### 4.9 Full Photo Caption Example

```json
{
  "high_level_description": "A medium-shot photograph of a barista pouring latte art in a cozy cafe.",
  "style_description": {
    "aesthetics": "warm, cozy, inviting",
    "lighting": "soft window light, warm tones",
    "photo": "50mm, f/2.0, shallow depth of field",
    "medium": "photograph",
    "color_palette": ["#6B3A2A", "#D4A96A", "#F5F0E8", "#3C2415", "#A67C52"]
  },
  "compositional_deconstruction": {
    "background": "A warm cafe interior with wooden shelves of coffee equipment slightly out of focus.",
    "elements": [
      {
        "type": "obj",
        "bbox": [100, 200, 900, 800],
        "desc": "A barista's hands carefully pouring steamed milk from a silver pitcher into a ceramic cup, creating a leaf latte art pattern."
      }
    ]
  }
}
```

### 4.10 Full Illustration Caption Example

```json
{
  "high_level_description": "A clean, modern business card layout for a tech company.",
  "style_description": {
    "aesthetics": "minimal, professional, geometric",
    "lighting": "even, diffuse studio lighting",
    "medium": "graphic_design",
    "art_style": "flat vector design, generous whitespace, sans-serif typography",
    "color_palette": ["#FFFFFF", "#F0F0F0", "#333333", "#0066FF", "#00CC88"]
  },
  "compositional_deconstruction": {
    "background": "A solid off-white card surface with subtle paper texture.",
    "elements": [
      {
        "type": "text",
        "text": "ACME TECH",
        "desc": "Bold dark grey sans-serif company name across the upper third of the card."
      },
      {
        "type": "text",
        "text": "hello@acme.tech",
        "desc": "Small blue sans-serif contact email near the bottom of the card."
      }
    ]
  }
}
```

---

## 5. Backend Design

### 5.1 Requirements

```
# backend/requirements.txt

# Core web framework
fastapi>=0.115.0
uvicorn[standard]>=0.30.0

# Ideogram 4 — official package (fp8 + nf4)
# Install from source: pip install git+https://github.com/ideogram-oss/ideogram4.git
# OR: pip install -e . from a cloned copy
# Dependencies pulled in by ideogram4:
torch>=2.11
transformers>=4.49.0
safetensors>=0.4.5
accelerate>=1.0.0
einops>=0.7.0
sentencepiece
pillow
huggingface_hub>=0.26.0
requests>=2.28
bitsandbytes>=0.49.2

# Diffusers (main branch, for bf16 pipeline)
# Install: pip install git+https://github.com/huggingface/diffusers.git
# Note: Ideogram4Pipeline is only in diffusers main, not released yet (as of June 2026)

# Database
aiosqlite>=0.20.0

# Settings
python-dotenv>=1.0.0
pydantic-settings>=2.0.0

# Utilities
python-multipart>=0.0.9    # for file upload support
```

### 5.2 App Entrypoint (`main.py`)

```python
# Exact patterns — verified against FastAPI docs

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import webbrowser, threading, os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    app.state.db = await aiosqlite.connect("app.db")
    await gallery.init_db(app.state.db)
    app.state.pipeline = None       # loaded lazily on first generate or on Settings save
    app.state.pipeline_variant = None

    def open_browser():
        import time; time.sleep(1.5)
        webbrowser.open("http://localhost:8000")
    threading.Thread(target=open_browser, daemon=True).start()

    yield

    # SHUTDOWN
    await app.state.db.close()

app = FastAPI(lifespan=lifespan)

# CORS for dev (Vite at 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes (all prefixed /api)
app.include_router(api_router, prefix="/api")

# Register WebSocket route
app.include_router(ws_router)

# Serve compiled React SPA — MUST be last
# Catch-all: any unmatched path returns index.html (required for React Router)
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    file_path = f"../frontend/dist/{full_path}"
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse("../frontend/dist/index.html")
```

### 5.3 Inference Pipeline

**Source for fp8:** `ideogram-oss/ideogram4` — `src/ideogram4/pipeline_ideogram4.py`
**Source for bf16:** `huggingface/diffusers` — `src/diffusers/pipelines/ideogram4/pipeline_ideogram4.py`

#### Abstract base

```python
from abc import ABC, abstractmethod
from PIL import Image
from dataclasses import dataclass

@dataclass
class GenerationSettings:
    height: int
    width: int
    sampler_preset: str          # "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"
    seed: int | None
    raise_on_caption_issues: bool = True

class InferencePipeline(ABC):
    @abstractmethod
    def load(self) -> None:
        """Load weights into VRAM. Blocking. May take 20-40s first run."""

    @abstractmethod
    def generate(
        self,
        prompt_json: str,
        settings: GenerationSettings,
        step_callback=None,       # called on each step (step_idx: int, total: int)
    ) -> Image.Image: ...

    @abstractmethod
    def unload(self) -> None:
        """Release VRAM."""
```

#### FP8 Pipeline (ideogram4 package)

```python
# Exact API from ideogram4.__init__ and pipeline_ideogram4.py

from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig
from ideogram4.sampler_configs import PRESETS   # dict[str, SamplerParameters]
import torch

class FP8Pipeline(InferencePipeline):
    REPO = "ideogram-ai/ideogram-4-fp8"

    def load(self):
        config = Ideogram4PipelineConfig(weights_repo=self.REPO)
        self._pipe = Ideogram4Pipeline.from_pretrained(
            config=config,
            device="cuda",
            dtype=torch.bfloat16,
        )

    def generate(self, prompt_json: str, settings: GenerationSettings, step_callback=None) -> Image.Image:
        preset = PRESETS[settings.sampler_preset]
        # ideogram4 pipeline has no step callback — progress is indeterminate
        images = self._pipe(
            prompts=prompt_json,              # str | list[str]
            height=settings.height,
            width=settings.width,
            num_steps=preset.num_steps,
            guidance_schedule=preset.guidance_schedule,
            mu=preset.mu,
            std=preset.std,
            seed=settings.seed,
            raise_on_caption_issues=settings.raise_on_caption_issues,
        )
        return images[0]                      # always list[Image.Image]
```

**PRESETS (exact from `sampler_configs.py`):**

```python
PRESETS = {
    "V4_QUALITY_48": SamplerParameters(
        num_steps=48,
        guidance_schedule=(3.0,) * 3 + (7.0,) * 45,   # index 0 = LAST step
        mu=0.0,
        std=1.5,
    ),
    "V4_DEFAULT_20": SamplerParameters(
        num_steps=20,
        guidance_schedule=(3.0,) * 2 + (7.0,) * 18,
        mu=0.0,
        std=1.75,
    ),
    "V4_TURBO_12": SamplerParameters(
        num_steps=12,
        guidance_schedule=(3.0,) * 1 + (7.0,) * 11,
        mu=0.5,
        std=1.75,
    ),
}
```

Note: `guidance_schedule` indices are in **reverse loop order** — index 0 is the LAST
(polish) step, index `num_steps-1` is the first step.

#### BF16 Pipeline (diffusers)

```python
# Exact API from diffusers main pipeline_ideogram4.py

from diffusers import Ideogram4Pipeline as DiffusersPipeline
import torch

class BF16Pipeline(InferencePipeline):
    REPO = "CalamitousFelicitousness/Ideogram-4-bf16-Diffusers"

    # Sampler parameters mapped to diffusers __call__ parameters:
    PRESETS = {
        "V4_QUALITY_48": {
            "num_inference_steps": 48,
            "guidance_schedule": list((7.0,) * 45 + (3.0,) * 3),   # forward order in diffusers
            "mu": 0.0,
            "std": 1.5,
        },
        "V4_DEFAULT_20": {
            "num_inference_steps": 20,
            "guidance_schedule": list((7.0,) * 18 + (3.0,) * 2),
            "mu": 0.0,
            "std": 1.75,
        },
        "V4_TURBO_12": {
            "num_inference_steps": 12,
            "guidance_schedule": list((7.0,) * 11 + (3.0,) * 1),
            "mu": 0.5,
            "std": 1.75,
        },
    }

    def load(self):
        import os
        kwargs = {"torch_dtype": torch.bfloat16}
        # HF_TOKEN only needed for gated repos; the community bf16 model may not
        # be gated, but pass the token anyway if present for future-proofing.
        if token := os.environ.get("HF_TOKEN"):
            kwargs["token"] = token
        self._pipe = DiffusersPipeline.from_pretrained(
            self.REPO, **kwargs
        ).to("cuda")

    def generate(self, prompt_json: str, settings: GenerationSettings, step_callback=None) -> Image.Image:
        preset = self.PRESETS[settings.sampler_preset]
        generator = torch.Generator("cuda").manual_seed(settings.seed) if settings.seed is not None else None

        def _callback(pipe, step_i: int, timestep: int, kwargs: dict) -> dict:
            if step_callback:
                step_callback(step_i, preset["num_inference_steps"])
            return {}   # must return dict; keys would override callback_kwargs locals

        result = self._pipe(
            prompt=prompt_json,
            height=settings.height,
            width=settings.width,
            num_inference_steps=preset["num_inference_steps"],
            guidance_scale=None,                          # mutually exclusive with guidance_schedule
            guidance_schedule=preset["guidance_schedule"],
            mu=preset["mu"],
            std=preset["std"],
            prompt_upsampling=False,                      # we handle this ourselves via MagicPrompt
            generator=generator,
            output_type="pil",
            return_dict=True,
            callback_on_step_end=_callback,
            callback_on_step_end_tensor_inputs=["latents"],
        )
        return result.images[0]
```

**Critical:** In `diffusers.Ideogram4Pipeline.__call__`, `guidance_scale` and
`guidance_schedule` are mutually exclusive. When using `guidance_schedule`, always explicitly
pass `guidance_scale=None`. The default already has `guidance_schedule` populated so it's
consistent, but be explicit to avoid confusion.

**Note on guidance_schedule direction:** The `ideogram4` package uses reverse order
(index 0 = last step), while diffusers uses forward order (index 0 = first step). The
`BF16Pipeline` preset definitions above already convert to forward order. This is verified
by the diffusers `Ideogram4Pipeline.__call__` default:
`guidance_schedule=(7.0,) * 45 + (3.0,) * 3` — 45 high-guidance steps first, 3 polish steps last.

### 5.4 Magic Prompt Service

**Source:** `ideogram-oss/ideogram4` — `src/ideogram4/magic_prompt.py`

```python
from ideogram4.magic_prompt import (
    MagicPrompt,
    MAGIC_PROMPTS,           # {"ideogram-4-v1": ..., "claude-sonnet-v1": ..., "claude-opus-v1": ...}
    DEFAULT_MAGIC_PROMPT,    # "ideogram-4-v1"
    aspect_ratio_from_size,  # (width: int, height: int) -> str  e.g. "16:9"
)
from ideogram4.magic_prompt import Ideogram4MagicPromptV1  # not in __init__, import directly

class MagicPromptService:
    def __init__(self, backend: str, api_key: str | None = None):
        # backend: "ideogram-4-v1" | "claude-sonnet-v1" | "claude-opus-v1"
        cls = MAGIC_PROMPTS.get(backend)
        if cls is None:
            cls = Ideogram4MagicPromptV1
        self._backend: MagicPrompt = cls(api_key=api_key, strip_bboxes=False)

    def expand(self, text: str, width: int, height: int) -> str:
        # Returns a minified JSON string
        aspect_ratio = aspect_ratio_from_size(width, height)  # e.g. "16:9"
        return self._backend.expand(text, aspect_ratio=aspect_ratio)
```

**Magic Prompt API call (what Ideogram4MagicPromptV1 does internally):**

```
POST https://api.ideogram.ai/v1/ideogram-v4/magic-prompt
Headers: { "Api-Key": "<IDEOGRAM_API_KEY>", "Content-Type": "application/json" }
Body:    { "text_prompt": "<plain text>", "aspect_ratio": "16x9" }

Response: { "aspect_ratio": "16x9", "json_prompt": { ... caption dict ... } }
```

Note: The internal API uses `x` separator (`16x9`), not `:`. The `expand()` method
takes `W:H` format and converts internally. You should always pass the result of
`aspect_ratio_from_size(width, height)` to `expand()`.

### 5.5 Caption Builder

```python
# caption.py — builds and validates the structured JSON caption from UI state

import json
from collections import OrderedDict
from ideogram4.caption_verifier import CaptionVerifier

verifier = CaptionVerifier()

def build_caption(ui_state: dict) -> tuple[str, list[str]]:
    """
    Build a minified JSON caption string from the UI state dict.
    Returns (caption_json_string, list_of_warnings).
    The warnings come from CaptionVerifier; generation can proceed with warnings
    but quality may be degraded.
    """
    caption = OrderedDict()

    if ui_state.get("high_level_description"):
        caption["high_level_description"] = ui_state["high_level_description"]

    style = _build_style(ui_state)
    if style:
        caption["style_description"] = style

    caption["compositional_deconstruction"] = _build_compositional(ui_state)

    warnings = verifier.verify(dict(caption))
    json_str = json.dumps(caption, separators=(",", ":"), ensure_ascii=False)
    return json_str, warnings

def _build_style(state: dict) -> OrderedDict | None:
    style = state.get("style_description")
    if not style:
        return None
    result = OrderedDict()
    is_photo = style.get("mode") == "photo"
    # Strict key order enforced here
    result["aesthetics"] = style["aesthetics"]
    result["lighting"]   = style["lighting"]
    if is_photo:
        result["photo"]  = style["photo"]
    result["medium"]     = style["medium"]
    if not is_photo:
        result["art_style"] = style["art_style"]
    if style.get("color_palette"):
        result["color_palette"] = style["color_palette"]
    return result

def _build_compositional(state: dict) -> OrderedDict:
    comp = OrderedDict()
    comp["background"] = state["background"]
    comp["elements"] = [_build_element(e) for e in state.get("elements", [])]
    return comp

def _build_element(e: dict) -> OrderedDict:
    el = OrderedDict()
    el["type"] = e["type"]                  # "obj" | "text"
    if e.get("bbox"):
        el["bbox"] = [int(v) for v in e["bbox"]]   # must be ints
    if e["type"] == "text":
        el["text"] = e["text"]
    el["desc"] = e["desc"]
    if e.get("color_palette"):
        el["color_palette"] = e["color_palette"]
    return el
```

### 5.6 WebSocket — Generation Progress

```python
# Verified pattern from FastAPI docs + asyncio docs

import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import WebSocket, WebSocketDisconnect

executor = ThreadPoolExecutor(max_workers=1)  # one generation at a time

@app.websocket("/ws/{job_id}")
async def generation_websocket(websocket: WebSocket, job_id: str):
    await websocket.accept()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    try:
        params = await websocket.receive_json()
        await websocket.send_json({"type": "started", "job_id": job_id})

        def run_generation():
            try:
                def on_step(step_i: int, total: int):
                    asyncio.run_coroutine_threadsafe(
                        queue.put({"type": "progress", "step": step_i, "total": total}),
                        loop,
                    )
                image = pipeline.generate(params["prompt_json"], settings, step_callback=on_step)
                path = save_image(image, job_id)
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "done", "image_path": path}), loop
                )
            except Exception as e:
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "error", "message": str(e)}), loop
                )

        loop.run_in_executor(executor, run_generation)

        while True:
            msg = await queue.get()
            await websocket.send_json(msg)
            if msg["type"] in ("done", "error"):
                break

    except WebSocketDisconnect:
        pass  # client disconnected cleanly
```

### 5.7 REST API Endpoints

All routes prefixed `/api/`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/model/status` | `{status: "unloaded"\|"loading"\|"ready", variant: "fp8"\|"bf16"\|null, vram_used_mb: int}` |
| `POST` | `/api/model/load` | Body: `{variant: "fp8"\|"bf16"}` — loads model, returns 202 while loading |
| `GET` | `/api/gallery` | `{items: GalleryItem[], total: int}`. Query: `?page=1&per_page=20&sort=desc` |
| `GET` | `/api/gallery/{job_id}` | Single gallery item with full prompt JSON |
| `DELETE` | `/api/gallery/{job_id}` | Deletes DB record + image file |
| `POST` | `/api/magic-prompt` | Body: `{text: str, width: int, height: int}` → `{caption_json: str, warnings: str[]}` |
| `GET` | `/api/settings` | Returns current AppSettings (without secret keys) |
| `PUT` | `/api/settings` | Updates settings, reloads Magic Prompt backend if changed |
| `GET` | `/api/outputs/{filename}` | Serves image files from outputs/ directory |

WebSocket: `WS /ws/{job_id}` — see §5.6

### 5.8 Gallery (SQLite Schema)

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,               -- UUID4 string
    status TEXT NOT NULL,              -- "pending" | "running" | "done" | "failed"
    prompt_json TEXT,                  -- full caption JSON string
    prompt_text TEXT,                  -- original plain-text input (before magic prompt)
    settings_json TEXT NOT NULL,       -- GenerationSettings as JSON
    image_path TEXT,                   -- relative path under outputs/
    seed INTEGER,
    width INTEGER,
    height INTEGER,
    sampler_preset TEXT,
    model_variant TEXT,                -- "fp8" | "bf16"
    duration_ms INTEGER,               -- wall-clock generation time
    created_at TEXT NOT NULL,          -- ISO 8601 UTC
    error_message TEXT                 -- populated on failure
);
```

### 5.9 Settings (`settings.py`)

```python
from pydantic_settings import BaseSettings

class AppSettings(BaseSettings):
    # Model
    model_variant: str = "fp8"              # "fp8" | "bf16"
    hf_token: str | None = None             # HuggingFace token (required for gated repos)

    # Magic Prompt
    magic_prompt_backend: str = "ideogram-4-v1"   # "ideogram-4-v1" | "claude-sonnet-v1" | "claude-opus-v1"
    ideogram_api_key: str | None = None
    openrouter_api_key: str | None = None

    # Output
    output_dir: str = "./outputs"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
```

---

## 6. Frontend Design

### 6.1 Package Versions

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^5.0.0",
    "@dnd-kit/react": "latest",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "latest",
    "vite": "^6.0.0"
  }
}
```

### 6.2 Vite Configuration

```typescript
// frontend/vite.config.ts
// Verified against Vite docs: https://vite.dev/config/server-options.html

import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
      "/outputs": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
})
```

### 6.3 Tailwind / shadcn Setup

**`src/index.css`** (Tailwind v4 — no `tailwind.config.js` needed):
```css
@import "tailwindcss";
```

**`components.json`** (generated by `npx shadcn@latest init -t vite`):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

shadcn components to install:
```
npx shadcn@latest add button card input label slider tabs badge
npx shadcn@latest add dialog tooltip popover separator scroll-area
npx shadcn@latest add select switch progress toast
```

### 6.4 shadcn Init Command

```bash
cd frontend
npx shadcn@latest init -t vite
```

### 6.5 TypeScript Types

```typescript
// src/types/caption.ts

export type ElementType = "obj" | "text"

export interface BBox {
  ymin: number   // 0–1000 int
  xmin: number
  ymax: number
  xmax: number
}

export interface BaseElement {
  id: string              // client-only UUID for React keys / dnd-kit ids
  type: ElementType
  bbox?: BBox
  desc: string
  color_palette?: string[]   // max 5, #RRGGBB uppercase
}

export interface ObjElement extends BaseElement {
  type: "obj"
}

export interface TextElement extends BaseElement {
  type: "text"
  text: string
}

export type AnyElement = ObjElement | TextElement

export type StyleMode = "photo" | "illustration"

export interface StyleDescription {
  mode: StyleMode
  aesthetics: string
  lighting: string
  medium: string
  photo?: string       // photo mode only
  art_style?: string   // illustration mode only
  color_palette?: string[]   // max 16
}

export interface PromptState {
  high_level_description: string
  style_description: StyleDescription
  background: string
  elements: AnyElement[]
}
```

```typescript
// src/types/api.ts

export interface MagicPromptRequest {
  text: string
  width: number
  height: number
}

export interface MagicPromptResponse {
  caption_json: string
  warnings: string[]
}

export interface GenerationRequest {
  prompt_json: string
  height: number
  width: number
  sampler_preset: "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"
  seed: number | null
  model_variant: "fp8" | "bf16"
}

export type WsMessage =
  | { type: "started"; job_id: string }
  | { type: "progress"; step: number; total: number }
  | { type: "done"; image_path: string }
  | { type: "error"; message: string }
```

### 6.6 State Management (Zustand)

```typescript
// src/stores/promptStore.ts

import { create } from "zustand"
import { PromptState, AnyElement } from "@/types/caption"

interface PromptStore extends PromptState {
  setHighLevelDescription: (v: string) => void
  setBackground: (v: string) => void
  addElement: (el: AnyElement) => void
  updateElement: (id: string, patch: Partial<AnyElement>) => void
  removeElement: (id: string) => void
  reorderElements: (oldIndex: number, newIndex: number) => void
  setStyleField: (key: keyof PromptState["style_description"], value: unknown) => void
  setStyleMode: (mode: "photo" | "illustration") => void
  loadFromJson: (captionJson: string) => void
  reset: () => void
}

// src/stores/generationStore.ts

interface GenerationStore {
  status: "idle" | "running" | "done" | "error"
  jobId: string | null
  progress: { step: number; total: number } | null
  resultImagePath: string | null
  errorMessage: string | null
  startGeneration: (jobId: string) => void
  setProgress: (step: number, total: number) => void
  setDone: (imagePath: string) => void
  setError: (message: string) => void
  reset: () => void
}
```

### 6.7 BBox Canvas Component

```typescript
// src/components/canvas/BBoxCanvas.tsx
// Uses @dnd-kit/react for draggable boxes

import { DragDropProvider } from "@dnd-kit/react"

interface BBoxCanvasProps {
  width: number    // generation width (for aspect ratio)
  height: number   // generation height
  elements: AnyElement[]
  onElementMove: (id: string, bbox: BBox) => void
  backgroundImage?: string   // URL of last generated image (shown underneath)
}

// Canvas aspect ratio maintained via CSS padding-top trick:
// paddingTop = `${(height / width) * 100}%`
// position: relative, overflow: hidden

// Each element renders as a BBoxRect — absolute positioned div
// with colored border + element type label.
// Drag converts from pixel deltas to normalized 0-1000 coords.
```

**Pixel ↔ Normalized coordinate helpers:**

```typescript
// src/lib/bbox.ts

export function pixelToNorm(
  px: number, py: number,
  pw: number, ph: number,
  canvasW: number, canvasH: number
): BBox {
  return {
    ymin: Math.round((py / canvasH) * 1000),
    xmin: Math.round((px / canvasW) * 1000),
    ymax: Math.round(((py + ph) / canvasH) * 1000),
    xmax: Math.round(((px + pw) / canvasW) * 1000),
  }
}

export function normToPixel(
  bbox: BBox, canvasW: number, canvasH: number
): { left: number; top: number; width: number; height: number } {
  return {
    left:   (bbox.xmin / 1000) * canvasW,
    top:    (bbox.ymin / 1000) * canvasH,
    width:  ((bbox.xmax - bbox.xmin) / 1000) * canvasW,
    height: ((bbox.ymax - bbox.ymin) / 1000) * canvasH,
  }
}

export function clampBBox(bbox: BBox): BBox {
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)))
  return {
    ymin: clamp(bbox.ymin),
    xmin: clamp(bbox.xmin),
    ymax: clamp(Math.max(bbox.ymin, bbox.ymax)),
    xmax: clamp(Math.max(bbox.xmin, bbox.xmax)),
  }
}
```

### 6.8 dnd-kit Setup

```bash
npm install @dnd-kit/react
```

```tsx
// BBoxRect.tsx — draggable bounding box element
// Verified: useDraggable returns { ref, isDragging }
//           transform comes from useDragDropManager (separate hook)
import { useDraggable, useDragDropManager } from "@dnd-kit/react"

function BBoxRect({ element, canvasW, canvasH, onMove }) {
  const { ref, isDragging } = useDraggable({ id: element.id })
  const manager = useDragDropManager()
  const transform = manager?.dragOperation.transform   // { x, y } | null

  const px = element.bbox ? normToPixel(element.bbox, canvasW, canvasH) : defaultPx
  const style = {
    position: "absolute" as const,
    left: px.left + (isDragging && transform ? transform.x : 0),
    top: px.top  + (isDragging && transform ? transform.y : 0),
    width: px.width,
    height: px.height,
    cursor: isDragging ? "grabbing" : "grab",
  }

  return (
    <div ref={ref} style={style} className="border-2 border-violet-500 rounded">
      <ElementTypeBadge type={element.type} />
    </div>
  )
}
```

### 6.9 Color Validation

```typescript
// src/lib/color.ts

const HEX_RE = /^#[0-9A-F]{6}$/

export function isValidHex(color: string): boolean {
  return HEX_RE.test(color)
}

export function normalizeHex(color: string): string {
  return color.toUpperCase().replace(/^#?/, "#").slice(0, 7)
}
```

Enforced at input time in `HexInput.tsx`: auto-uppercase on change, reject non-hex chars.

### 6.10 Page Layout — Generate

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR: [Logo] [Generate] [Gallery] [Settings]  [Model Status] │
├─────────────────┬────────────────────────┬──────────────────────┤
│ LEFT PANEL      │ CENTER CANVAS          │ RIGHT PANEL          │
│ 320px           │ flex, min-h 512px      │ 360px                │
│                 │                        │                      │
│ [PromptBar]     │ Generated image or     │ [StylePanel]         │
│ [Magic Prompt   │ aspect-ratio           │   Photo|Illustration │
│  toggle + btn]  │ placeholder canvas     │   tabs               │
│                 │                        │                      │
│ [HighLevel      │ BBoxCanvas overlay     │ [ElementList]        │
│  Description]   │ (drag bboxes here)     │   + AddElementMenu   │
│                 │                        │   per-element cards  │
│ [Background]    │ [Progress bar]         │                      │
│                 │                        │ [SamplerPresets]     │
│                 │                        │ [ResolutionPicker]   │
│                 │                        │ [ModelVariantToggle] │
│                 │                        │ [SeedControl]        │
│                 │                        │                      │
│                 │                        │ [Generate Button]    │
└─────────────────┴────────────────────────┴──────────────────────┘
```

### 6.11 Sampler Preset UI

Three cards, one selected at a time:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Turbo      │  │   Default    │  │   Quality    │
│   12 steps   │  │   20 steps   │  │   48 steps   │
│   ~15s       │  │   ~25s       │  │   ~60s       │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 6.12 Resolution Picker

Aspect ratio grid (click to select), then fine-tune W×H:

```
[1:1] [4:3] [3:4] [16:9] [9:16] [21:9] [Custom]
Width: [____] px   Height: [____] px
```

Constraints:
- Width and height must be multiples of 16 (enforced at input, snapped on blur)
- Range: 256–2048 for both dimensions
- Show VRAM estimate when user changes resolution

---

## 7. Installation Scripts

### `install.bat`

```batch
@echo off
echo ============================================================
echo  Ideogram 4.0 Local Studio - Installation
echo ============================================================

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from python.org
    pause & exit /b 1
)

:: Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from nodejs.org (LTS recommended)
    pause & exit /b 1
)

:: Create virtual environment
echo.
echo [1/5] Creating Python virtual environment...
python -m venv venv
if errorlevel 1 ( echo ERROR: venv creation failed & pause & exit /b 1 )

:: Install Python deps
echo.
echo [2/5] Installing Python dependencies...
call venv\Scripts\activate.bat
pip install --upgrade pip
pip install git+https://github.com/ideogram-oss/ideogram4.git
pip install git+https://github.com/huggingface/diffusers.git
pip install fastapi "uvicorn[standard]" aiosqlite pydantic-settings python-dotenv python-multipart
if errorlevel 1 ( echo ERROR: pip install failed & pause & exit /b 1 )

:: Create .env if missing
echo.
echo [3/5] Creating .env file...
if not exist .env (
    copy .env.example .env
    echo .env created from template. Edit it to add your API keys.
)

:: Install Node deps
echo.
echo [4/5] Installing Node.js dependencies...
cd frontend
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & cd .. & pause & exit /b 1 )

:: Build frontend
echo.
echo [5/5] Building React frontend...
call npm run build
if errorlevel 1 ( echo ERROR: npm build failed & cd .. & pause & exit /b 1 )
cd ..

:: Create outputs dir
if not exist outputs mkdir outputs

echo.
echo ============================================================
echo  Installation complete!
echo  Run: run.bat to start the studio.
echo  NOTE: On first run, model weights (~13-22 GB) will download.
echo ============================================================
pause
```

### `run.bat`

```batch
@echo off
echo Starting Ideogram 4.0 Local Studio...
call venv\Scripts\activate.bat
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --log-level info
```

### `.env.example`

```ini
# Ideogram API key — get free at https://developer.ideogram.ai
# Required for Magic Prompt with the "ideogram-4-v1" backend
IDEOGRAM_API_KEY=

# OpenRouter API key — required only if using Claude magic-prompt backends
# Get at https://openrouter.ai/keys
OPENROUTER_API_KEY=

# HuggingFace token — required to download gated model weights
# Get at https://huggingface.co/settings/tokens
# You must also accept the license at:
#   https://huggingface.co/ideogram-ai/ideogram-4-fp8
#   https://huggingface.co/ideogram-ai/ideogram-4-nf4
HF_TOKEN=

# Model variant: fp8 (13 GB VRAM) or bf16 (22 GB VRAM)
MODEL_VARIANT=fp8

# Magic prompt backend: ideogram-4-v1 | claude-sonnet-v1 | claude-opus-v1
MAGIC_PROMPT_BACKEND=ideogram-4-v1
```

---

## 8. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HF_TOKEN` | Yes | HuggingFace user access token; gated repos require it |
| `IDEOGRAM_API_KEY` | If using `ideogram-4-v1` backend | Free at developer.ideogram.ai |
| `OPENROUTER_API_KEY` | If using Claude backends | For claude-sonnet-v1 or claude-opus-v1 |
| `MODEL_VARIANT` | No (default: `fp8`) | `fp8` or `bf16` |
| `MAGIC_PROMPT_BACKEND` | No (default: `ideogram-4-v1`) | See above |

---

## 9. Critical Implementation Notes

### 9.1 Key Order is Quality-Critical

The JSON caption must have keys in **exactly the prescribed order**. `json.dumps()` on a
plain `dict` does not guarantee order in all Python versions. Always use `OrderedDict` or
construct the dict in the correct order (Python 3.7+ maintains insertion order). The
`build_caption()` function in `caption.py` handles this. Never bypass it.

### 9.2 BBox Coordinate Order

The bbox is `[ymin, xmin, ymax, xmax]` — **Y before X**. This is counterintuitive
(most graphics systems use x first). Double-check every place that converts between
pixel coordinates and bbox arrays.

### 9.3 Hex Colors Must Be Uppercase

The `CaptionVerifier` checks `all(c in "0123456789ABCDEF" for c in color[1:])`.
Lowercase hex fails. Always call `color.upper()` before including in captions.

### 9.4 guidance_schedule Direction Differs Between Backends

- `ideogram4` package: index 0 = **LAST** step (reverse order)
- `diffusers` `Ideogram4Pipeline`: index 0 = **FIRST** step (forward order)

The `BF16Pipeline` class in `inference.py` has the presets pre-converted to forward order.
Do not copy presets directly from the `ideogram4` PRESETS dict into diffusers calls.

### 9.5 guidance_scale vs guidance_schedule (diffusers)

In `diffusers.Ideogram4Pipeline.__call__`, `guidance_scale` and `guidance_schedule` are
mutually exclusive. When passing `guidance_schedule`, always also pass `guidance_scale=None`.
Failure to do so may cause unexpected behavior.

### 9.6 Magic Prompt API Uses `x` Separator

The `Ideogram4MagicPromptV1` API endpoint expects aspect ratio as `"16x9"` not `"16:9"`.
The `expand()` method takes `W:H` format and converts internally. Always use
`aspect_ratio_from_size(width, height)` to generate the aspect ratio string — do not
construct it manually.

### 9.7 `Ideogram4MagicPromptV1` is Not in `__init__`

```python
# WRONG:
from ideogram4 import Ideogram4MagicPromptV1  # ImportError

# CORRECT:
from ideogram4.magic_prompt import Ideogram4MagicPromptV1
```

### 9.8 Width and Height Must Be Multiples of 16

`vae_scale_factor (8) × patch_size (2) = 16`. Any non-multiple is invalid. Enforce in the
UI (snap to nearest 16 on input) and validate server-side before calling the pipeline.

### 9.9 Seed Handling

- `ideogram4` pipeline: pass `seed=<int>` directly to `__call__`
- `diffusers` pipeline: create a `torch.Generator("cuda").manual_seed(seed)` and pass as `generator`
- When seed is `None`, generate randomly and record the actual seed used for reproducibility

### 9.10 HF Token for Gated Repos

Both `ideogram-ai/ideogram-4-fp8` and `ideogram-ai/ideogram-4-nf4` are gated repos.
The user must:
1. Accept the Non-Commercial license at huggingface.co/ideogram-ai/ideogram-4-fp8
2. Provide `HF_TOKEN` in `.env`

The `ideogram4` package reads `HF_TOKEN` from the environment automatically via
`huggingface_hub`. For the diffusers pipeline, pass `token=os.environ["HF_TOKEN"]`
to `from_pretrained()`.

### 9.11 Single Worker

Always run uvicorn with `--workers 1`. Multiple workers each load the model into VRAM,
immediately exhausting GPU memory on any consumer card.

### 9.12 bf16 Community Model VRAM

The `CalamitousFelicitousness/Ideogram-4-bf16-Diffusers` community model requires
approximately 19–22 GB VRAM. On an RTX 4090 (24 GB), this leaves little headroom.
Display a warning in the UI when the user selects bf16.

### 9.13 Caption Passed to Pipeline Must Be Minified JSON String

Both the `ideogram4` package and `diffusers` pipeline accept the caption as a **string**
(the minified JSON), not as a Python dict. Always call `build_caption()` which returns
the serialized string, then pass that string as the prompt.

### 9.14 `strip_bboxes` Parameter

When constructing magic prompt backends, pass `strip_bboxes=False` so that the returned
caption includes bounding boxes that users can then see and edit in the canvas. The default
`strip_bboxes=True` removes spatial layout from the Magic Prompt output.

---

*Last updated: 2026-06-08*
*All APIs verified against source code and live documentation.*
