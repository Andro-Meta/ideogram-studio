# Ideogram 4 Studio — Build Spec & Implementation Log (2026-06-16)

Companion to `RESEARCH_2026-06-16.md`. Covers porting the best community ideas
from the GitHub `ideogram-4` topic + Hugging Face into the studio. Features 1–5
are **implemented in this session** (CPU-testable, no model changes). The
GPU-gated tracks (§6) are **specced for implementation** and need the 24 GB box.

> **Verification caveat (same as the 06-14 log):** the Linux sandbox's file
> mount intermittently returns corrupted/truncated tails for files, which makes
> `tsc -b` through the mount report bogus syntax errors in *untouched* working
> files (e.g. `ColorSwatch.tsx`, `CfgControl.tsx`, `colorPalettes.ts`). The
> authoritative `E:\` files were confirmed byte-clean and valid UTF-8. The Python
> backend modules were compiled **and functionally tested** (they read clean).
> Run `cd frontend && npx tsc -b` on the real machine to get a true typecheck —
> it's the first step in the Claude Code test prompt (§7).

---

## What shipped (features 1–5)

### Feature 1 — Artifact suppression / pseudo–negative-prompt  ✅
The on-model substitute for a negative prompt: append *positive* quality
constraints to the caption ("sharp focus, no motion blur") since Ideogram 4 has
no negative field. Ported from `hardhant/ComfyUI-AliAn-Ideogram-Magic-Prompt`.

- **`frontend/src/lib/constraintPresets.ts`** (new) — 5 categories (Sharpness,
  Clean, No artifacts, Color, Anatomy) + `buildConstraintClause(ids, custom)`.
  Pure module.
- **`frontend/src/components/controls/ArtifactSuppression.tsx`** (new) — master
  toggle + category chips + free-text field, with a live "Appended: …" preview.
  Off by default.
- **`frontend/src/stores/settingsStore.ts`** — added `artifactSuppression`,
  `artifactCategoryIds`, `artifactCustom` (+ setters), a v4 migration, and the
  `currentConstraintClause()` helper.
- **`frontend/src/lib/caption.ts`** — `buildCaption(state, { constraintClause })`
  appends `". Rendering quality: <clause>."` to `high_level_description`. Applied
  *after* validation so it never trips the word-count warnings.
- **`frontend/src/pages/Generate.tsx`** — a reactive selector computes the
  clause; every `buildCaption(promptState, captionOpts)` call (generate, remix,
  copy, preview) uses it, so what you see is what generates.
- **`backend/constraints.py`** (new) — backend mirror (`build_constraint_clause`,
  `apply_constraints_to_caption`, idempotent) for the CLI. **Unit-tested.**

*Conflict handled:* the 06-14 audit (T11) forbids a *text-negative box*; this is
positive-constraint injection, marketed as "Quality constraints," not "negative
prompt." Caption stays bbox-native.

### Feature 2 — Full native ratios + megapixel selector  ✅
Ported from `Saganaki22/ideogram4_prompter-ComfyUI`, snapping to ×16 (our
pipeline's requirement) **not ×8**.

- **`frontend/src/lib/caption.ts`** — `NATIVE_ASPECT_RATIOS` (all 17 native
  ratios, tall→wide) + `resolutionForRatio(rw, rh, megapixels)` that derives a
  valid size via the existing, production-tested `clampAspect` (×16, 256–2048,
  ≤6:1). `MP_MIN`/`MP_MAX` bounds.
- **`frontend/src/components/controls/ResolutionPicker.tsx`** (rewritten) —
  native-ratio chips + a **megapixel slider** (0.25–4.0) that recomputes W×H
  live; custom W/H preserved; live "X.XX MP" readout. Replaces the old fixed
  SD/HD preset table + HD toggle.
- **`settingsStore.ts`** — `megapixels` (default 1.0) + `ratioLabel` ("1:1").

The 8 previously-missing ratios (`1:2/2:1`, `1:3/3:1`, `1:4/4:1`, `10:16/16:10`)
are now selectable. All native ratios are ≤4:1, inside the model's ≤6:1 range.

### Feature 3 — Built-in prompt/template library  ✅
Inspired by `EvoLinkAI/awesome-ideogram-4.0-prompts` — but every caption is
original (no copied prompt text).

- **`frontend/src/lib/promptTemplates.ts`** (new) — 8 complete `PromptState`
  starters across Typography / Product / Portrait / UI / Branding / Scene, each
  with boxed elements + suggested resolution.
- Surfaced via the toolbar (Feature 4). Loading assigns fresh element ids and
  applies the template's resolution.

### Feature 4 — Scene presets + headless CLI  ✅
Ported from `jonasnordlund/intuition` (save/load + CLI).

- **`frontend/src/lib/scenePreset.ts`** (new) — versioned `.ideoscene.json`
  format (prompt + generation settings + constraints), `buildScene` /
  `serializeScene` / `parseScene` (tolerant, friendly errors) / `downloadScene`.
- **`frontend/src/components/prompt/PromptToolbar.tsx`** (new) — a toolbar above
  the prompt with **Templates** (dialog grid), **Save** (download scene), and
  **Load** (file picker → hydrates prompt + settings). Rendered in
  `Generate.tsx`.
- **`backend/ideogram_cli.py`** (new) — headless CLI: `caption` (offline build +
  validate + constraints), `magic-prompt`, `describe`, `generate` (WS client of
  the running server, saves the PNG). A client of the local studio — reuses the
  same pipeline/gallery; no second model load. **`caption` tested offline;
  argparse for all subcommands tested.**

### Feature 5 — Curated LoRA gallery  ✅
- **`frontend/src/lib/loraGallery.ts`** (new) — 6 vetted HF LoRAs (Realism
  Engine, Ektachrome, Tarot, DeverStyle, Fantasy Realism, Unconditional).
- **`frontend/src/components/controls/LoraPanel.tsx`** — a collapsible "Browse
  curated" section; one click applies via the existing
  `/api/loras/apply` (`hf_repo`) plumbing. Disabled when already loaded.

---

## 6. GPU-gated tracks (specced — implement on the 24 GB box)

These need the model loaded and/or new heavy deps, so they're designed here and
should be built + verified on hardware.

### 6.1 Quant backends — GGUF / INT8 / SDNQ (run below 24 GB)
**Goal:** add model variants that fit 12–16 GB cards, from the HF quant ecosystem
(`leejet/ideogram-4-GGUF`, `transformerlab/...-int8-w8a8`, `Disty0/...-SDNQ-FP8`).

> **STATUS: `gguf-q4k` SCAFFOLD SHIPPED.** `GGUFQ4KPipeline` is in `inference.py`
> and fully wired (variant `gguf-q4k` in `PipelineManager.REPOS` + `load()` branch,
> `system_check` REPOS/`VARIANT_REQS`/assess loop, `schemas.py` + `settings.py`
> Literals, `types/caption.ts`, and the Model toggle tile). It loads the Q4_K GGUF
> transformer via diffusers `GGUFQuantizationConfig` and assembles a real
> `Ideogram4Pipeline`, inheriting `generate()`/`inpaint()`. **Verify on the GPU
> box:** (a) confirm the exact GGUF filename on the hub (`GGUF_FILENAME`), (b)
> confirm the transformer class symbol `Ideogram4Transformer2DModel` exists in the
> installed diffusers (clear errors fire if not), (c) optionally trim the base
> download to only the VAE/text-encoder/scheduler subfolders (TODO noted in
> `load()`). LoRA is intentionally disabled on the GGUF base. INT8/SDNQ remain
> unimplemented — add them the same way once GGUF is proven.

**Design:**
- These do **not** drop into the diffusers `Ideogram4Pipeline`; they need their
  own loader/runtime. Add a new `QuantPipeline` alongside the existing pipeline
  classes in `inference.py`, behind new `model_variant` values:
  `gguf-q4k`, `gguf-q8`, `int8`, `sdnq-fp8`.
- **GGUF path:** load the transformer from a `.gguf` via `stable-diffusion.cpp`
  bindings or ComfyUI's GGUF loader (`gguf` + a dequant-on-load shim); keep the
  diffusers VAE/text path. Simplest first target: `gguf-q4k` (~6–7 GB) on a 12 GB
  card. Wire `PipelineManager` to branch on the variant prefix.
- **INT8/SDNQ:** load via the publisher's recipe (SDNQ via `diffusers` +
  `sdnq` package; INT8 via the `transformerlab` w8a8 weights). These stay closer
  to the diffusers path, so they may support the existing CFG/edit features —
  verify per variant.
- **Schema/UI:** extend the `model_variant` `Literal` in `schemas.py`,
  `settings.py`, `types/caption.ts`, and `system_check.py`'s
  `VariantAssessment` table (download GB / VRAM GB / RAM GB / label) so the
  hardware report and Model picker show them. **LoRA/edit support is per-variant
  — gate `supports_lora` / `supports_inpaint` honestly.**

**Risks:** quant loaders pin specific torch/CUDA builds; GGUF dequant may be CPU
slow on load; quality varies by quant. Stage `gguf-q4k` first, measure, then add
the others.

### 6.2 Inpaint-LoRA evaluation (`BitPoet/Ideogram4-Inpaint-LoRA`)
**Goal:** compare a learned inpaint adapter against our training-free RePaint
latent-blend (`inpaint.py`).

> **STATUS: A/B HARNESS SHIPPED.** `backend/eval_inpaint_lora.py` (standalone)
> loads nf4d/bf16, runs the same image+mask+seed once as baseline RePaint and once
> with the inpaint LoRA applied, and writes `_A_baseline`, `_B_lora`, and a
> side-by-side `_compare` PNG to `outputs/inpaint_eval/`. Run:
> `python eval_inpaint_lora.py --image base.png --mask mask.png --prompt caption.json`.
> If the LoRA wins, add the "High-quality fill (LoRA)" toggle described below.

**Design:**
- It's a normal LoRA — load it through the existing LoRA plumbing on NF4·D/BF16,
  then run the current inpaint flow with the adapter applied (the adapter biases
  the denoiser toward clean fills).
- Add an **A/B harness**: same image + mask + seed, once with RePaint only, once
  with the inpaint-LoRA applied; save both to the gallery tagged for comparison.
- If it wins, expose a "High-quality fill (LoRA)" toggle on the inpaint panel
  that auto-applies/removes the adapter around the edit.

**Open question:** whether the adapter expects a specific masked-latent
conditioning (some inpaint LoRAs do). Inspect the repo's example workflow before
wiring; fall back to "apply as a plain style LoRA during inpaint" if not.

### 6.3 Local captioner for Image→Prompt (JoyCaption)
**Goal:** an offline alternative to the OpenRouter vision call in
`magic_prompt_service.describe_image`, for full local privacy.

**Design:**
- Add a `describe_backend` setting: `openrouter` (current default) | `local`.
- `local` runs **JoyCaption Beta One** (`fancyfeast/joy-caption-beta-one`) — a
  Llava-style captioner — via `transformers`, loaded lazily and RAM/VRAM-guarded
  like the PiD upscaler (`pid_upscale.py` is the pattern: opt-in, never crashes
  the host, unloads after use). On a 24 GB card it shares VRAM with the model, so
  guard + unload between calls.
- Keep the same `_DESCRIBE_INSTRUCTION` prompt so output style matches.
- Surface the choice in Settings; default stays the free OpenRouter path.

**Lighter alternative:** CLIP-Interrogator (`pharmapsychotic/CLIP-Interrogator`)
is smaller but lower quality — offer as a "fast/low-VRAM" sub-option.

---

## 7. Claude Code test prompt (run on the GPU box)

Paste the block in §7 of this file's companion message, or this:

> Work in `E:\IdeoGram_4`. We just added 5 features (artifact suppression, native
> ratios + megapixel resolution, template library, scene presets + CLI, curated
> LoRA gallery). Verify and smoke-test them:
>
> 1. **Typecheck/build:** `cd frontend && npm run build` (or `npx tsc -b`). Fix
>    any *real* TS errors introduced by the new/edited files: `lib/constraintPresets.ts`,
>    `lib/loraGallery.ts`, `lib/promptTemplates.ts`, `lib/scenePreset.ts`,
>    `lib/caption.ts`, `stores/settingsStore.ts`, `components/controls/ResolutionPicker.tsx`,
>    `components/controls/ArtifactSuppression.tsx`, `components/prompt/PromptToolbar.tsx`,
>    `components/controls/LoraPanel.tsx`, `pages/Generate.tsx`. Report anything you change.
> 2. **Backend:** `cd backend && python -m py_compile constraints.py ideogram_cli.py`
>    then `python ideogram_cli.py caption <a prompt-state json> --constraints sharpness,noise`
>    and confirm the caption JSON has the "Rendering quality:" clause.
> 3. **Run the app** (`run.bat`) and check:
>    - Settings rail shows **Quality constraints** (toggle → chips → custom field);
>      enabling it and copying the caption JSON shows the appended clause.
>    - **Resolution** shows all native ratio chips + a **megapixels** slider; the
>      readout W×H updates and stays a multiple of 16; "Custom…" still works.
>    - **Templates / Save / Load** toolbar above the prompt: a template loads
>      into the editor + canvas; Save downloads a `.ideoscene.json`; Load restores it.
>    - **LoRA panel → Browse curated**: a card applies the HF LoRA (needs HF token
>      for gated repos).
> 4. **Generate** a real image with **Quality constraints ON, CFG 3.5→2.0, a
>    16:9 @ ~2 MP** size, and confirm it generates (no collapse) and looks sharp.
>    Then generate from the **Event Poster** template and check the text renders.
> 5. Report: what passed, any TS/runtime errors you fixed, and a couple of output
>    images for the poster + a photo template.
>
> The **GGUF Q4_K scaffold** and the **inpaint-LoRA A/B harness** are already in
> the tree — optionally smoke-test them (see the "GGUF / eval" section of this
> doc). Do **not** build INT8/SDNQ or the JoyCaption local captioner yet — those
> remain specced in §6 for a follow-up.

---

## File manifest (this session)

**New:** `frontend/src/lib/constraintPresets.ts`, `frontend/src/lib/loraGallery.ts`,
`frontend/src/lib/promptTemplates.ts` (12 templates), `frontend/src/lib/scenePreset.ts`,
`frontend/src/components/controls/ArtifactSuppression.tsx`,
`frontend/src/components/prompt/PromptToolbar.tsx`, `backend/constraints.py`,
`backend/ideogram_cli.py`, `backend/eval_inpaint_lora.py`,
`docs/RESEARCH_2026-06-16.md`, `docs/BUILD_SPEC_2026-06-16.md`.

**Edited:** `frontend/src/lib/caption.ts`, `frontend/src/stores/settingsStore.ts`,
`frontend/src/components/controls/ResolutionPicker.tsx`,
`frontend/src/components/controls/LoraPanel.tsx`,
`frontend/src/components/controls/ModelVariantToggle.tsx`,
`frontend/src/types/caption.ts`, `frontend/src/pages/Generate.tsx`,
`backend/inference.py` (GGUFQ4KPipeline + wiring), `backend/system_check.py`,
`backend/schemas.py`, `backend/settings.py`.

### GGUF / eval — optional GPU follow-up tests
- **GGUF variant:** in the Model panel pick **GGUF Q4** and Generate. First run
  fixes `GGUF_FILENAME` / the transformer class if the clear errors fire; expect
  ~10–12 GB VRAM. LoRA panel is hidden for this variant (by design).
- **Inpaint-LoRA A/B:** `cd backend && python eval_inpaint_lora.py --image <base.png>
  --mask <mask.png> --prompt <caption.json>` → check `outputs/inpaint_eval/` for the
  side-by-side and decide whether the LoRA beats RePaint.
