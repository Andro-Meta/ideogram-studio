<div align="center">

# Ideogram 4.0 Local Studio

**A browser-based studio for running [Ideogram 4.0](https://huggingface.co/ideogram-ai)'s open weights locally — on your own GPU.**

Type a plain-English idea, reverse-engineer a prompt from any image, blend an image into a new one, and generate with industry-leading text rendering and layout control. Everything runs on your machine; no images or prompts leave it except optional prompt-assist calls you opt into.

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)
![CUDA](https://img.shields.io/badge/CUDA-24GB%20GPU-76b900)
![CodeQL](https://github.com/Andro-Meta/ideogram-studio/actions/workflows/codeql.yml/badge.svg)

</div>

---

## What is this?

Ideogram 4.0 is a **9.3B-parameter single-stream Diffusion Transformer** that consumes a *structured JSON caption* (high-level description, style block, and bounding-box-placed elements) instead of a flat prompt. That structure is what gives it best-in-class text rendering and precise layout.

This studio wraps the open weights in a fast, friendly interface so you never have to hand-write JSON:

- **Write a prompt** in plain English → *Magic Prompt* expands it into a full structured caption.
- **Generate from an image** → a vision model reverse-engineers a complete, editable prompt from any picture.
- **Blend an image in** → an image-to-image slider (0–100%) mixes the original into the result.
- **Place objects and text** on a bounding-box canvas, pick per-element colors, switch Photo/Illustration modes.
- **Browse, reuse, and refine** every generation from a local gallery.

It runs comfortably on a single 24 GB consumer GPU (RTX 3090 / 4090) via 4-bit weights.

---

## Features

### Prompting
- **Magic Prompt** — plain English → structured Ideogram-4 JSON caption. Backends: Ideogram's hosted API, **OpenRouter free models ($0)**, or a local LLM.
- **Image → Prompt** — upload any image (even ones you didn't make here) and a free vision model writes a full, editable prompt from it.
- **Visual prompt builder** — high-level description, Style block (aesthetics / lighting / medium / art-style), typed **text** and **object** elements, and per-element + global **hex color palettes**. No raw JSON required.
- **Enhance descriptions (keep layout)** — lay out the composition with simple element descriptions + boxes, then let the LLM flesh out each one into vivid detail. Bounding boxes, types, and rendered text are preserved exactly (only descriptions are sent and returned).
- **Style mash-up & AI Fuse** — combine two style presets into one hybrid look.
- **Layout canvas** — pin elements and drag bounding boxes to control *where* things appear.

### Generation
- **Sampler presets** — Turbo (12 steps), Default (20), Quality (48).
- **Resolution** — aspect-ratio presets *and* custom width/height (256–2048, ×16). Uploading an image **auto-matches the canvas to its aspect ratio** at a fast ~1 MP budget.
- **Batch** — render N seeds from one prompt and pick your favorite.
- **Live progress** over WebSocket, with seed control (lock for reproducibility) and one-click reuse.
- **LoRA adapters** — load `.safetensors` or Hugging Face repos (NF4·D / BF16 pipelines).

### Local image editing *(built on the text-to-image weights — see [How editing works](#how-editing-works))*
- **Image-to-image blend / Remix** — a 0–100% slider that mixes the uploaded image into the generation.
- **AI Region Fill (inpaint)** — mask an area and regenerate just that region.
- **Extend / Reframe (outpaint)** — grow the canvas to a new aspect ratio and continue the scene.
- **Layered editor** — selections (rect / ellipse / lasso / brush / wand), adjustment layers, undo history.
- **Upscale** — 4× with AuraSR-v2.

### Library & access
- **Gallery** — SQLite-backed history with favorites, search, reuse-prompt, one-click delete + 5 s undo, and a zoomable lightbox with ←/→ navigation.
- **Mobile-friendly & LAN access** — responsive down to phone width; the server binds your LAN so you can open it from a phone on the same Wi-Fi. Works behind a reverse proxy (e.g. Caddy) for a friendly hostname.
- **Content-safety toggle** — optional Hive moderation (off by default).

---

## Requirements

| | Minimum | Notes |
|---|---|---|
| **OS** | Windows 10/11 | Scripts are `.bat`; the Python/Node stack itself is cross-platform. |
| **GPU** | NVIDIA, **24 GB VRAM** | RTX 3090 / 4090 for the NF4 path. fp8/bf16 need datacenter cards. |
| **Python** | 3.10+ | "Add to PATH" during install. |
| **Node.js** | LTS | Builds the React frontend. |
| **Disk** | ~25 GB free | ~8 GB deps + ~16 GB model weights. |
| **Hugging Face token** | required | Weights are gated — [get one](https://huggingface.co/settings/tokens) and [accept the license](https://huggingface.co/ideogram-ai/ideogram-4-nf4). |

---

## Quick start (Windows)

```bat
:: 1. Clone
git clone https://github.com/Andro-Meta/ideogram-studio.git
cd ideogram-studio

:: 2. Install — checks Python/Node/GPU/disk, creates a venv, installs PyTorch +
::    the ideogram4 + diffusers packages, and builds the frontend.
install.bat

:: 3. Run — starts the server, preloads the NF4·D model, opens your browser,
::    and prints the URL to use from your phone.
run.bat
```

Then open **http://localhost:8000**. The first generation downloads the weights (~16 GB, one time); watch the **Status** panel for progress — you can use the rest of the app while it loads.

### From your phone
`run.bat` binds the server to your LAN and prints `http://<this-PC-IP>:8000`. Open that in your phone's browser on the **same Wi-Fi**. (Windows may ask to allow port 8000 on private networks the first time — click Allow.)

---

## Model variants

Pick under **Settings → Model**. **NF4·D is the recommended default** for 24 GB GPUs and is the only path (with BF16) that supports LoRA and the local editing features.

| Variant | Download | VRAM | Best for |
|---|---|---|---|
| **`nf4d`** ⭐ | 16.1 GB | ~20 GB | **24 GB consumer GPUs.** NF4 in diffusers layout — live step-by-step progress, LoRA, image editing. |
| `nf4` | 16.1 GB | ~20 GB | 24 GB GPUs, official inference package. |
| `fp8` | 27.5 GB | ~30 GB | A100/H100-class GPUs (+~48 GB RAM). Higher fidelity. |
| `bf16` | 53.6 GB | ~40 GB | Datacenter-scale, experimental community weights. |

---

## Configuration

Settings live in `.env` (created from `.env.example` on first install) and can also be edited in the app's **Settings** tab.

| Key | Purpose |
|---|---|
| `HF_TOKEN` | **Required** — downloads the gated model weights. |
| `OPENROUTER_API_KEY` | Powers Magic Prompt + Image→Prompt via **free** OpenRouter models ($0). Use a regular inference key (not a provisioning/management key). |
| `IDEOGRAM_API_KEY` | Optional alternative Magic Prompt backend (Ideogram's hosted API). |
| `HIVE_TEXT_KEY` / `HIVE_VISUAL_KEY` | Optional content-moderation. |

> **Cost:** generation is 100% local and free. The prompt-assist features default to **free** OpenRouter models, so they cost nothing. Nothing is sent anywhere unless you configure these keys and use those features.

---

## Architecture

```
Browser (React SPA, served from the backend)
  │  GET /api/*        REST: gallery, settings, magic-prompt, model status, edit
  │  WS  /ws/{job_id}  real-time generation progress
  ▼
FastAPI (port 8000, single process / single worker)
  ├── StaticFiles            compiled React dist/
  ├── PipelineManager        loads the Ideogram4Pipeline (diffusers / ideogram4)
  ├── Magic-Prompt service    Ideogram API / OpenRouter (free) / local LLM
  ├── Inpaint / Remix / Extend   local masked latent-blend editing
  └── SQLite gallery          history, seeds, prompt JSON
        ▼
   NVIDIA GPU (CUDA) — 4-bit weights, ~20 GB VRAM
```

**Stack:** FastAPI · PyTorch · 🤗 diffusers (`Ideogram4Pipeline`) · the `ideogram4` package · SQLite — React 19 · TypeScript · Vite · Tailwind v4 · Zustand · TanStack Query · Radix UI.

### Project structure
```
backend/         FastAPI app
  main.py            routes, WebSocket generation, static serving
  inference.py       PipelineManager + generation
  inpaint.py         RePaint-style masked latent-blend editing
  magic_prompt_service.py   prompt expansion + image captioning backends
  caption.py         JSON caption build/verify
  gallery.py         SQLite history
  schemas.py         pydantic request/response models
frontend/        React + TypeScript SPA (built to dist/, served by the backend)
install.bat      one-shot setup        run.bat   start the studio
project.md       deep implementation reference
```

---

## How editing works

Ideogram 4.0's **open weights are text-to-image only** — there is no official img2img, inpaint, or ControlNet. The editing features in this studio (Image-to-image blend, AI Region Fill, Extend) are a **local [RePaint](https://arxiv.org/abs/2201.09865)-style masked latent-blend** built on top of the diffusers pipeline: known regions are pinned to the (noised) original at each denoising step while masked regions regenerate, then composited back at full resolution. It's a faithful local approximation of hosted editing — entirely on your GPU, nothing uploaded.

For image-to-image, the source is resized to a valid Ideogram resolution (aspect-matched, ~1 MP, multiples of 16, ≤ 2048) before generation so a raw phone photo renders correctly and fast.

---

## Security notes

- Running `run.bat` exposes the studio to **your local network** with no authentication — fine for a home LAN, but don't run it on untrusted/public Wi-Fi.
- Secrets live in `.env`, which is git-ignored; only `.env.example` is committed.
- The repo runs **CodeQL** static analysis on every push.

---

## Acknowledgements

- **[Ideogram](https://ideogram.ai)** for the Ideogram 4.0 model and open weights.
- **[Hugging Face diffusers](https://github.com/huggingface/diffusers)** for `Ideogram4Pipeline`.
- **[AuraSR](https://huggingface.co/fal/AuraSR-v2)** for upscaling.

---

<div align="center">
<sub>Not affiliated with or endorsed by Ideogram. "Ideogram" is a trademark of its respective owner.</sub>
</div>
