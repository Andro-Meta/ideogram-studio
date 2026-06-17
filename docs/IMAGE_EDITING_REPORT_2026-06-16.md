# Image Editing for Ideogram 4 — Research Report, Audit & Fix Plan

**Date:** 2026-06-16
**Author:** Engineering research pass (Cowork)
**Scope:** External research (Ideogram 4, ComfyUI, Hugging Face) + audit of our own edit pipeline + an actionable plan to make our editing suite work correctly.

---

## 0. TL;DR

Your hunch is **correct, and confirmed against both the wider ecosystem and our own code.**

- The right way to edit is: **feed the full image for context, but first downscale a high-resolution input to the model's native working resolution (~1 megapixel) while *preserving the source aspect ratio*, then composite the result back at the original resolution.** Every serious 2026 edit pipeline (Flux Kontext, Qwen-Image-Edit) does exactly this.
- **We do the "full image" part, but the downscale is broken.** `inpaint.py` clamps **each axis independently to 2048** (`gen_w = min(2048, round_to(orig_w, 16))`, same for height). For any non-square image larger than 2048 on a side, this **squashes the aspect ratio** — a 4000×3000 photo becomes 2048×2048 (a ~33% horizontal squash), the model edits a distorted scene, and the result is stretched back, re-distorting. It also runs the DiT at up to 4 MP (no megapixel budget), which is ~4× slower than needed and an OOM risk.
- The fix is small and already half-built: the frontend has the correct helper (`aspectMatchedResolution`, `caption.ts:333`) used for *generation* but **never wired into the edit path**. We port that exact recipe into the edit backend and, ideally, add crop-and-stitch for small masks on large images.

**Second concern, equally fundamental (added 2026-06-16, pass 2): the edit *prompt* is image-blind, and that — not feathering — is why painted regions don't match the larger image.** When you paint a region and type a short phrase, we run it through Magic Prompt, which an LLM expands into a *complete whole-scene JSON caption* (with a default "neutral background" and a fresh subject). The masked region then denoises toward that self-contained scene, which has no knowledge of the surrounding lighting, palette, or perspective — so the patch drifts. We also force Magic Prompt ON for every edit, the opposite of Ideogram's own guidance for fills, and feathering only hides the pixel *seam*, never a content/color mismatch. Full diagnosis in §6.

The rest of this document gives the cited research, the full audit, and the implementation plan.

---

## 1. How Ideogram 4 editing actually works

Ideogram exposes editing both in the Canvas web UI and via the API. The key facts for our purposes:

**Native resolutions.** Ideogram 4 *generation* runs at 2K buckets (2048×2048, 1440×2880, 2880×1440, 1664×2496, … up to ultrawide 3072×1024). The **masked-edit / inpaint API path is still V3-era and returns ~1 MP buckets** (1024×1024, 1312×736, 736×1312, 1248×832, 1408×704, 1536×512, …). So editing happens at roughly 1 megapixel matched to the source aspect ratio, not at 2K. ([generate-v4 resolution enum](https://developer.ideogram.ai/api-reference/api-reference/generate-v4); [inpaint-v3 resolution enum](https://developer.ideogram.ai/api-reference/api-reference/inpaint-v3); [aspect-ratio/dimensions table](https://docs.ideogram.ai/using-ideogram/generation-settings/aspect-ratio-and-dimensions))

**The "generation window" — a fixed pixel budget.** Ideogram's own docs are explicit: *"The total number of pixels remains constant for any aspect ratio, regardless of the generation window size on the canvas."* The model always works at a fixed ~1 MP budget for the chosen aspect ratio; the edited region is then **interpolated/extrapolated to fit the canvas grid on download.** If your window covers a large/upscaled area, the fixed budget is stretched and *"the Magic Fill-generated section is often about twice the size of the original image"* → blurrier. This is the documented confirmation that Ideogram **downscales to a native budget, samples, then resamples back to source dimensions.** ([Canvas overview](https://docs.ideogram.ai/canvas-and-editing/canvas/canvas-overview); [Magic Fill](https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill))

**Mask convention (API).** The hosted inpaint endpoint requires *"a black and white image of the same size as the image being edited,"* and — note — **black = the region to edit, white = keep** (the inverse of most tools). We don't call this endpoint (we run local weights), but it matters if we ever add a hosted-edit fallback. ([inpaint-v3](https://developer.ideogram.ai/api-reference/api-reference/inpaint-v3))

**Editing features Ideogram ships:** Magic Fill (inpaint), Extend (outpaint), Remix (image+prompt with `image_weight`), Reframe (square→target resolution, no prompt/mask), Replace Background (auto subject, no mask), Edit-with-prompt (maskless, up to 10 images), Upscale, Layerize/editable text layers. ([Ideogram 4.0 blog](https://ideogram.ai/blog/ideogram-4.0/); endpoint refs: [remix-v4](https://developer.ideogram.ai/api-reference/api-reference/remix-v4), [reframe-v3](https://developer.ideogram.ai/api-reference/api-reference/reframe-v3), [replace-background-v3](https://developer.ideogram.ai/api-reference/api-reference/replace-background-v3), [edit-with-prompt](https://developer.ideogram.ai/api-reference/api-reference/edit-with-prompt))

**Official best practice for quality edits:** keep the generation window small but include surrounding context; match the window aspect ratio to the content; upscale the source first for fine-detail fixes; localize the prompt to the window; upscale the final to recover sharpness lost to the grid resample. ([Magic Fill](https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill))

> ⚠️ **Caveat (verified honestly):** No V4 inpaint/edit endpoint exists publicly yet — hosted masked editing is V3 (~1 MP). The Canvas docs describing the downscale-to-grid behavior predate 4.0 (one note still says "v2.0 is used in Canvas," now stale). The *mechanism* (fixed budget → resample back) is well documented; the exact internal interpolation algorithm is not published.

---

## 2. What the ecosystem does (ComfyUI + Hugging Face)

The whole field converged on the same recipe you intuited.

### 2.1 Hugging Face / diffusers — the canonical preprocessing

Modern DiT edit pipelines **resize the full input to ≈1 MP preserving aspect ratio, snapping each side to a multiple of 32**, output floored to a multiple of `vae_scale_factor*2` (=16). Verified from pipeline source:

- **Qwen-Image-Edit** `calculate_dimensions(target_area=1024*1024, ratio=w/h)` → `width=sqrt(area*ratio)`, `height=width/ratio`, both `round(dim/32)*32`. ([pipeline_qwenimage_edit.py](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit.py))
- **Flux Kontext** additionally **buckets** the condition image to its 17 trained ~1 MP resolutions by closest aspect ratio (`PREFERRED_KONTEXT_RESOLUTIONS`: 1024×1024, 1248×832, 832×1248, 1392×752, …). ([pipeline_flux_kontext.py](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/flux/pipeline_flux_kontext.py))
- **Qwen-Image-Edit-2509/2511** use a *dual* resolution: the vision-language encoder sees a **384²** version, the VAE sees a **1 MP** version. (Relevant only if we ever adopt a VLM-conditioned edit model.) ([pipeline_qwenimage_edit_plus.py](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit_plus.py))
- **diffusers inpaint conventions:** mask **white = fill, black = keep** (opposite of Ideogram's API); `VaeImageProcessor` auto-resizes to multiples of 8; `resize_mode="fill"` preserves aspect ratio (pad/crop) while default does not; `mask_processor.blur()` softens edges; `apply_overlay()` pins the unmasked region to the original — the diffusers analogue of our latent blend. ([inpaint guide](https://huggingface.co/docs/diffusers/using-diffusers/inpaint); [image processor](https://huggingface.co/docs/diffusers/api/image_processor))

The dominant 2026 paradigm is **maskless full-image instruction editing** (Qwen-Image-Edit-2511, Flux Kontext, Step1X-Edit v1.2, OmniGen2, HiDream-E1.1). Masked editing is a separate pipeline variant (`FluxFill`, `FluxKontextInpaint`, SD/SDXL inpaint). Notable outliers: **ICEdit** is hard-locked to 512-px width; **HiDream-E1-Full** to 768². **Z-Image-Edit is not yet released** (only text-to-image Z-Image/Turbo exist as of 2026-06-16). ([Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511); [FLUX.1-Kontext-dev](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev); [Step1X-Edit-v1p2](https://huggingface.co/stepfun-ai/Step1X-Edit-v1p2); [OmniGen2](https://huggingface.co/OmniGen2/OmniGen2); [HiDream-E1-1](https://huggingface.co/HiDream-ai/HiDream-E1-1); [ICEdit](https://huggingface.co/sanaka87/ICEdit-MoE-LoRA))

**Relevant methods (papers):** [RePaint](https://huggingface.co/papers/2201.09865) (resample the known region each step — this is literally what our `inpaint_region` does), [Differential Diffusion](https://huggingface.co/papers/2306.00950) (per-pixel soft strength instead of a binary mask), [PFB-Diff](https://huggingface.co/papers/2306.16894) (feature-level blending to kill seams), [editing survey](https://huggingface.co/papers/2402.17525).

### 2.2 ComfyUI — recent nodes (last ~month) and the resolution pattern

- **Ideogram 4.0 open weights + day-0 ComfyUI support** (June 3, 2026) — the big event, but it's **text-to-image only**; no local Ideogram-4 inpaint/edit node exists yet. Ideogram inpainting in ComfyUI today goes through the **API V3 partner node** (text-to-image + inpainting modes). ([Comfy blog](https://blog.comfy.org/p/ideogram-4-day-0-support-in-comfyui); [Comfy-Org/Ideogram-4](https://huggingface.co/Comfy-Org/Ideogram-4); [Ideogram V3 partner node](https://docs.comfy.org/built-in-nodes/partner-node/image/ideogram/ideogram-v3))
- **lquesada/ComfyUI-Inpaint-CropAndStitch** — the canonical resolution/aspect solution, and it's *exactly* your hunch generalized: **crop around the mask (+ a context margin) → resize that crop to the model's native resolution → sample → stitch back into the original at full resolution**, never passing unmasked pixels through VAE. Crops *before* resizing (a 2025-04 fix for large-image/small-mask crashes); `output_resize_to_target_size` forces native res (1024 for SDXL/Flux); `mask_blend_pixels` grows+blurs the stitch mask for seamless edges; supports upscale-before-sample for detail and downscale-before-sample to avoid "double head" artifacts. Updated 2026-01-09 (GPU support). ([repo](https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch))
- **lrzjason/ComfyUI-EditUtils** (updated 2026-05-04) — the most recent *edit* node; "longest edge" resize + pad with stored `pad_info` for exact recropping, claims high-res editing "without pixel shifts." Solves the precise resolution-fidelity problem. ([repo](https://github.com/lrzjason/ComfyUI-EditUtils))
- **Differential Diffusion** (core) + **Gaussian Blur Mask** = the standard seamless soft-mask recipe; **Set Latent Noise Mask** (preferred for base/Flux models) vs **VAE-Encode-for-Inpainting** (dedicated inpaint checkpoints only). ([DifferentialDiffusion docs](https://docs.comfy.org/built-in-nodes/DifferentialDiffusion); [Set Latent Noise Mask](https://comfyui-wiki.com/en/comfyui-nodes/latent/inpaint/set-latent-noise-mask))

**Takeaway:** the entire ecosystem agrees on (1) downscale full image to ~1 MP preserving aspect ratio (snap to 16/32; Kontext buckets), and (2) for localized edits, crop-and-stitch around the mask so the edited region keeps full resolution. We currently do neither correctly.

---

## 3. Audit of our implementation

### 3.1 Architecture (how editing works today)

Four edit paths; only one runs the model:

1. **Local pixel editor** (`frontend/src/components/editor/*`, no model) — selections, adjustment layers, flatten, save via `/api/edit/save` (re-encode only).
2. **AI region fill (inpaint)** — `useInpaint.ts` → `POST /api/edit/inpaint` (`main.py:1273`). Sends flattened canvas + mask; empty selection → full-white mask = remix whole image. Backend uses `height=image.height, width=image.width` **verbatim** (`main.py:1296`), structures the prompt via MagicPrompt, calls `inference.BF16Pipeline.inpaint` → `inpaint.inpaint_region`.
3. **Outpaint / extend** — `useExtend.ts` → `POST /api/edit/extend` (`main.py:1347`); builds a target canvas from `target_ratio`, edge-pads via `build_outpaint` (`inpaint.py:78`), samples with strength 0.95.
4. **Split-to-layers** — `layers.py` (SAM + ViTMatte); unrelated to the resolution issue.

The sampler `inpaint.inpaint_region` (`inpaint.py:103-200`) is a sound **RePaint-style latent blend**: VAE-encode source → tokens, denoise from noise, overwrite unmasked tokens with the source's flow-matched forward latent each step, gradually release masked tokens, decode, feathered pixel composite to pin the original outside the mask. **The blending math, mask convention, feathering, and full-image context are all correct.** The problem is purely the resolution selection.

### 3.2 The core bug

`inpaint.py:135-139`:
```python
orig_w, orig_h = image.size
gen_w = min(2048, _round_to(orig_w, unit))   # unit = 16 (confirmed: vae_scale_factor 8 * patch_size 2)
gen_h = min(2048, _round_to(orig_h, unit))
src = image.convert("RGB").resize((gen_w, gen_h), Image.LANCZOS)
```

This clamps **each axis independently to 2048**, which is *not* an aspect-preserving downscale:

- **4000×3000 (4:3)** → 2048×2048 → squashed to **1:1** (~33% horizontal compression). Model edits a distorted scene; result is LANCZOS-stretched back to 4000×3000, re-distorting. Everything in frame looks squished.
- **6000×4000 (3:2)** → 2048×2048 → same squash.
- **3000×4000 (portrait)** → 2048×2048 → vertical stretch.
- **No megapixel budget:** a 2048×2048 edit is 4 MP — 4× the ~1 MP the edit path should use; ~4× slower and a real OOM risk next to the resident ~16–22 GB model.
- **Non-native resolution:** even when aspect survives, the DiT samples at arbitrary sizes the edit capability wasn't trained on; no bucketing.
- **Inside the mask** content is generated distorted *and* upscaled → soft. (Outside the mask is fine — the pixel composite pins it to the byte-exact original.)

The frontend **already has the correct fix** and uses it for generation but not editing — `aspectMatchedResolution()` (`caption.ts:333`): `scale = sqrt(budget / (srcW*srcH))`, snap to 16, clamp 256–2048, anchor the long side. The edit path reuses none of it.

### 3.3 Findings table

| # | Severity | Location | Problem | Fix direction |
|---|----------|----------|---------|---------------|
| 1 | **Critical** | `inpaint.py:136-139` | Per-axis `min(2048, round_to(dim,16))` **destroys aspect ratio** for non-square images >2048/side (4000×3000→2048×2048). | Aspect-preserving ~1 MP downscale (`sqrt(area/(w*h))`, snap ×16). |
| 2 | **Critical** | `inpaint.py:136-139` | **No megapixel cap** — DiT runs up to 4 MP. OOM risk, ~4× slower. | Same fix; ~1 MP working budget. |
| 3 | **Major** | `inpaint.py` (module) | Edits run at non-native resolutions (no bucketing to Ideogram ~1 MP edit buckets / native ratios). | Snap aspect-preserved size to nearest native bucket. |
| 4 | **Major** | `inpaint.py:103-200` | **No crop-and-stitch.** Small mask on a huge image forces a full-frame resize (wasted budget + softness) and can't recover detail. | Add crop-around-mask+context → resize crop to native → sample → stitch back at original res. |
| 5 | **Major** | `main.py:1296`, `inpaint.py:139,192` | Output LANCZOS-upscaled from a capped/distorted gen size → masked content soft even when aspect is fine. | Crop-and-stitch limits round-trip to the edited region; optional detail-restore. |
| 6 | **Major** | `main.py:1367` vs `schemas.py:434` | Extend target size from `round(oh*tw/th)` not snapped to ×16; relies on `inpaint_region` to fix it, which re-triggers bug #1 (e.g. 2048→16:9 = 3641 wide → clamped to 2048 → distorted). | Snap extend target to ×16 + apply the same ~1 MP downscale. |
| 7 | Minor | `inpaint.py:71` | Token-grid mask feather is anisotropic when the grid is distorted. | Resolves once #1 is fixed. |
| 8 | Minor | `main.py:1388,1395` | Extend hardcodes `V4_DEFAULT_20` + strength 0.95; no MP control. | Expose strength/preset; budget canvas to ~1 MP. |
| 9 | Minor | `inpaint.py:152`, `schemas.py:412` | Strength clamped in two places (redundant). | Consolidate. |
| 10 | Minor | `main.py:1223,1266` | Inpaint accepts up to 8192² with no ingest downscale → hits #1/#2 hardest. | Validate/downscale on ingest. |
| 11 | Info | `inference.py:710` | GGUF path `supports_inpaint=True` is unverified scaffolding; inherits the same bug. | One fix in `inpaint_region` covers all pipelines. |

**Not bugs (verified correct):** mask convention is internally consistent (white/opaque alpha = regenerate end-to-end); latent pinning + feathered pixel composite are implemented correctly; full-image context is fed (good). The mask convention is the *inverse* of Ideogram's hosted V3 API (black=edit) — only relevant if we add a hosted-edit fallback.

**Cleanup:** `main.py:1208-1211` has a stale comment claiming editing only happens in the browser, contradicted by the working diffusion edit endpoints below it.

### 3.4 Verdict on your hunch

> *"We're supposed to feed the full image to make edits to. And if the image is too high resolution, it needs to be brought down to Ideogram's resolution for the aspect ratio in the original image — automatically."*

**Correct on all counts.** "Feed the full image" — we already do (good for context). "Downscale to native resolution for the source aspect ratio, automatically" — **we do not, and the placeholder logic that stands in for it corrupts aspect ratio and risks OOM.** This is the single biggest defect in the edit suite, and the fix is a direct port of logic we already wrote for generation.

---

## 4. The plan

Ordered by impact. Phases 1–2 fix the fundamental defect; 3–4 bring us to ecosystem parity; 5 is verification.

### Phase 1 — Aspect-preserving native-resolution downscale (the core fix) — *Critical*
1. Add a shared helper `edit_resolution(orig_w, orig_h, budget=1024*1024, unit=16)` that mirrors the frontend `aspectMatchedResolution`: `scale = sqrt(budget/(w*h))`, multiply, snap each side to `unit`, clamp to [256, 2048]. Put it where both `inpaint.py` and the extend path can use it (e.g. a small `resolution.py`, or top of `inpaint.py`).
2. Replace `inpaint.py:136-139` to use it instead of the per-axis `min(2048, …)`.
3. Apply the same budget to the **extend** canvas (`main.py:1367` / `build_outpaint`) so the padded canvas is snapped to `unit` and held to ~1 MP before sampling.
4. Keep the existing resize-back + feathered composite (already correct).

**Outcome:** no more squashing; edits run at ~1 MP matched to the source aspect; ~4× faster; OOM risk gone.

### Phase 2 — Native-bucket snapping (optional but recommended) — *Major*
- Snap the Phase-1 result to the nearest Ideogram ~1 MP edit bucket by closest aspect ratio (the Kontext approach), so we sample at resolutions the model handles best. Reuse the bucket list from `schemas.py`/`caption.ts` rather than inventing one.

### Phase 3 — Crop-and-stitch for localized edits — *Major*
- For a small mask on a large image, crop a bounding box around the mask + a context margin, run the Phase-1 pipeline on the crop, then stitch back into the original at full resolution with a blurred blend mask (the lquesada CropAndStitch pattern). This recovers full detail in the edited region and is faster. Expose it as the default for region edits, with full-image as the fallback for large/whole-image masks.

### Phase 4 — Polish & parity — *Minor/Major*
- Snap extend targets to `unit` at the source (`main.py`), expose strength/preset for extend (#8), add ingest downscale guard for >~4 MP uploads (#10), consolidate duplicate strength clamps (#9), remove the stale comment (#3.3), and (optional) add Differential-Diffusion-style soft strength for smoother boundaries.

### Phase 5 — Verification — *Required*
- Unit-test `edit_resolution` against 4000×3000, 6000×4000, 3000×4000, 1024×1024, 8000×6000, and extreme ratios — assert aspect preserved within one `unit`, area ≤ budget, sides divisible by 16, within [256,2048].
- Visual regression: inpaint + extend on a 4:3 and a 16:9 high-res photo; confirm no squashing and unmasked region is byte-identical.
- Confirm no VRAM regression (peak should drop, not rise).

### Lowest-effort highest-impact
If we do nothing else, **Phase 1 alone** removes the distortion and OOM risk and is ~20 lines reusing logic we already shipped. Phases 2–3 bring us to parity with Kontext/Qwen and ComfyUI's CropAndStitch.

---

## 6. Prompt system, JSON, Magic Prompt, Describe — and the "background doesn't match" diagnosis

*(Added in pass 2, in response to: feathering, the edit prompt system, image→prompt, and JSON/magic-prompt handling.)*

### 6.1 Feathering — verdict

**Feathering is not an Ideogram feature.** Verified across the Magic Fill docs, the Editor docs, and the full inpaint-v3 API schema (request body is only `image`, `mask`, `prompt`, `magic_prompt`, `num_images`, `seed`, `rendering_speed`, `style_type`, `style_preset`, `color_palette`, `style_codes`, reference images) — there is **no feather radius, blend, or mask-softening parameter anywhere.** Ideogram's *only* documented blend mechanism is "include surrounding context in the generation window and let the model harmonize" (it generates matching reflections/shadows/lighting as an emergent effect of generating *with* context). ([Magic Fill](https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill); [inpaint-v3](https://developer.ideogram.ai/api-reference/api-reference/inpaint-v3))

So our 6px Gaussian feather + token-grid feather (`inpaint.py:71, 197-198`) is **our own idea**, borrowed from diffusers/RePaint practice (diffusers exposes `mask_processor.blur()` + `apply_overlay()` for exactly this). It is a *legitimate caller-side technique* and worth keeping — but it only softens the **pixel seam**. It cannot fix a patch whose **content, color, or lighting** is wrong. Your "background didn't match" symptom is a content/grounding problem, not a seam problem, so feathering was never going to fix it.

### 6.2 How our edit prompt is actually built (audit)

End-to-end for `/api/edit/inpaint` (`main.py:1273-1344`):

1. The editor collects a free-text `fillPrompt` (manual typing only) and sends a **plain string** + mask (`EditorDialog.tsx:91`, `useInpaint.ts:33`). No region info, no bbox, no crop of the surroundings.
2. Backend runs it through **Magic Prompt expansion** (`main.py:1311-1317`): `fill_prompt = await mp.expand(body.prompt, image.width, image.height)`.
3. `mp.expand()` (`magic_prompt_service.py:204-231`) does an **LLM round-trip** that rewrites the short phrase into a **full minified Ideogram-4 JSON caption** — `high_level_description` + whole-scene `background` + `elements`. With a terse input, `caption.py`'s defaults fill `background` with *"A neutral background."* (`caption.py:116`).
4. That whole-scene caption is applied to the **entire latent**; only unmasked *pixels* are pinned back at the end (`inpaint.py:163-199`). The masked tokens denoise toward the whole-scene caption, with the only continuity coming from the img2img `strength` schedule (pixel/structure, not prompt-level).

Key facts:
- **No edit-specific or region-localized caption mode exists.** `caption.py:build_caption()` (the structured whole-scene builder) isn't even called by the edit endpoints; edits synthesize a caption from the edit text alone, with zero knowledge of the surrounding image.
- **Magic Prompt is forced ON for every edit.** There is no off switch on the edit path — contradicting Ideogram's explicit guidance: *"it is recommended not to use Magic Prompt, as it might alter your optimized prompt"* for Magic Fill. ([Magic Prompt](https://docs.ideogram.ai/using-ideogram/generation-settings/magic-prompt); [Magic Fill](https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill))
- **Extend is partially shielded** because its default prompt says *"matching the existing style, lighting, perspective, and subject"* (`main.py:1378`) — inpaint has **no** such instruction.

### 6.3 The JSON / Magic Prompt model (important correction to pass 1)

Ideogram 4's generate endpoint takes two mutually-exclusive fields, and the interaction is documented verbatim:
- `text_prompt` → **Magic Prompt enabled automatically** (LLM rewrites your text).
- `json_prompt` → **Magic Prompt disabled; the structured prompt is consumed by the diffusion model directly.**

([generate-v4](https://developer.ideogram.ai/api-reference/api-reference/generate-v4))

So the **correct editing model** is: build/derive a JSON caption that is *grounded in the actual image*, modify only the element(s) the user wants to change, and feed it as `json_prompt` **without** a magic-prompt rewrite. We currently do the inverse — we take a short phrase and let Magic Prompt *invent* a whole new scene caption, discarding the image context. That is the prompt-side root cause of drift.

Schema notes (corrections to pass 1): the v4 `json_prompt` is `{ high_level_description (req), style_description {aesthetics, lighting, medium req; art_style, photo opt}, compositional_deconstruction { background (req), elements[] } }`; elements are `obj` (`desc`, optional `bbox`) or `text` (`text`, `desc`, optional `bbox`); **bbox is `[y_min, x_min, y_max, x_max]` in [0,1000], row-first.** Color palette is **prose inside `style_description`**, not a typed field in v4 json_prompt (the typed hex `color_palette` is a v3 form param). v4 generate has **no** `magic_prompt` param — on/off is implied by text vs json. ([generate-v4 OpenAPI](https://developer.ideogram.ai/api-reference/api-reference/generate-v4.md))

### 6.4 Image → prompt ("create a prompt from the image")

- We **have** a describe path — `magic_prompt_service.describe_image()` (`:81-114`) sends the image to a free OpenRouter vision model and returns a **single plain-text paragraph** describing the *whole image*. But it is wired **only into the Generate-tab prompt bar** (`PromptBar.tsx`), **never the editor** (`EditorDialog.tsx` doesn't import it). So today you cannot generate an edit prompt from the image inside the editor.
- Ideogram ships **two** official describe endpoints: legacy `/describe` → plain text, and **`/v1/ideogram-v4/describe` → a structured `V4JsonPrompt`** with an `include_bbox` flag — i.e. an official **image→JSON-caption** tool whose output can be fed straight back as `json_prompt`. This is the natural round-trip for editing. ([describe-v4](https://developer.ideogram.ai/api-reference/api-reference/describe-v4.md))
- For our local pipeline, the equivalent is a local VLM (Florence-2, Qwen2.5-VL, JoyCaption, MiniCPM-V) to caption the image — ideally the **masked region plus its context** — into a JSON caption the user can edit. ([VisionCaptioner](https://github.com/Brekel/VisionCaptioner))

### 6.5 How the best instruction-edit models keep the background consistent

This is the pattern to emulate at the prompt level:
- **Flux Kontext** (official guide): *"Explicitly state what should remain unchanged"* — e.g. *"Change the background to a beach while keeping the person in the exact same position, scale, and pose… Only replace the environment around them."* Name subjects directly, choose verbs carefully ("replace the background" not "transform"). ([BFL Kontext guide](https://docs.bfl.ml/guides/prompting_guide_kontext_i2i))
- **Qwen-Image-Edit** (official card): has an explicit *appearance-editing* mode *"requiring all other regions of the image to remain completely unchanged,"* achieved by dual conditioning (semantic VLM + appearance VAE) — a model-level guarantee, plus short imperative prompts. ([Qwen-Image-Edit](https://huggingface.co/Qwen/Qwen-Image-Edit))

For our mask-based Ideogram path, the equivalent levers are: (1) ground the caption in the actual image (so `background`/`style_description` describe the *real* surroundings, not "neutral background"), (2) keep the prompt scoped to the window's contents per Ideogram guidance, and (3) don't let Magic Prompt overwrite it.

### 6.6 Background-mismatch diagnosis — summary

The painted region fails to match the larger image because of **three compounding causes**, in priority order:

1. **Image-blind, Magic-Prompt-synthesized whole-scene caption** (§6.2/§6.3) — the masked region is steered toward an invented scene with a neutral background, not the real surroundings. *Primary cause.*
2. **Aspect distortion** (§3.2) — on a high-res non-square photo the whole frame is squashed, so the generated content is at the wrong scale and won't align at the seam. *Secondary, compounds #1.*
3. **No preservation instruction on inpaint** (§6.2) — unlike extend, inpaint never tells the model to match existing style/lighting.

Feathering (§6.1) is unrelated to all three — it only hides the seam. Fixing the prompt grounding (Phase 6) + aspect handling (Phase 1) is what actually resolves the symptom.

---

## 7. Plan additions (prompt system)

These extend the §4 plan. Phases 1–3 (resolution) and 6 (prompt grounding) are the two pillars that fix your two concerns.

### Phase 6 — Ground the edit prompt in the image — *Critical (fixes background mismatch)*
1. **Stop forcing Magic Prompt on edits.** Default edits to *no* LLM rewrite; expose an explicit toggle (default off), matching Ideogram's guidance. Keep the refusal-avoidance benefit by building a *grounded* JSON caption instead of a bare string (see below).
2. **Build a grounded JSON caption for edits.** Before sampling, derive a caption from the *actual source image* (local VLM describe, or reuse `describe_image`, ideally over the masked region + context), then splice the user's instruction into the relevant element / `high_level_description`, keeping the real `background` and `style_description` (lighting/palette/medium) of the surroundings. Feed it as a `json_prompt`-style caption — which is exactly the path that *disables* magic-prompt rewriting.
3. **Add an inpaint preservation clause** analogous to extend's: instruct the model to match the existing style, lighting, perspective, and palette of the surrounding image.
4. **Wire Describe into the editor.** Add a "prompt from image" button in `EditorDialog` (currently only on the Generate tab) so the user can seed the edit caption from the image and then tweak it.

### Phase 7 — Editor prompt UX — *Major*
- Let the user describe **only the masked region/window** (per Ideogram best practice), show the grounded caption they can edit, and offer the Kontext-style "keep everything else unchanged" affordance. Make Magic Prompt a visible, default-off control on the edit dialog.

### Phase 8 — Verification (prompt) — *Required*
- A/B the same masked edit with (old) forced-magic-prompt vs (new) grounded-caption-no-rewrite on a textured background photo; confirm the patch matches surrounding lighting/palette. Confirm Magic-Prompt-off is actually honored end-to-end.

---

## 8. Implementation status (2026-06-16)

All phases implemented and unit-verified (pure functions; the diffusion path needs the GPU box to run end-to-end).

Backend:
- `inpaint.py` — new `edit_resolution()` (aspect-preserving ~1 MP, proportional clamps to [256,2048], snap to native bucket within 6% aspect) replaces the per-axis `min(2048,…)` squash; `_NATIVE_EDIT_BUCKETS`; new `inpaint_image()` crop-and-stitch wrapper (`_mask_bbox`/`_expand_bbox`) that crops localized masks to native res and stitches back, auto-falling back to full-image for whole-image/extend masks.
- `inference.py` — `BF16Pipeline.inpaint` now calls `inpaint_image`.
- `magic_prompt_service.py` — new `build_edit_caption()` builds a grounded JSON caption deterministically (the `json_prompt` path, no LLM rewrite) with a preservation clause.
- `main.py` — inpaint & extend endpoints now ground the caption via `describe_image` (default on) and skip Magic Prompt by default (opt-in); extend snaps target to ×16 and honors `strength`/`sampler_preset`; stale "text-to-image only" comment removed.
- `schemas.py` — `InpaintRequest.ground`/`.magic_prompt`; `ExtendRequest.ground`/`.strength`/`.sampler_preset`.

Frontend:
- `useInpaint.ts`/`useExtend.ts` — pass `ground`/`magicPrompt`. `useDescribeImage.ts` accepts a Blob.
- `EditorDialog.tsx` — "Suggest from image" button (describe current canvas), Magic Prompt toggle (default off), updated help text, stale note removed.

Verification: `edit_resolution` holds aspect error <1% on standard ratios and ≤3.7% worst-case (vs 25–65% before), ~1 MP area, sides ÷16, clamped — standard photo ratios hit native buckets exactly; `build_edit_caption` emits valid grounded captions; crop geometry correct; backend `py_compile` clean; frontend `tsc --noEmit` clean.

Note: the repo's `backend/__pycache__` holds pre-change `.pyc` files. On your machine Python invalidates them automatically by mtime, but if anything looks stale, delete `backend/__pycache__`. Restart the server (`run.bat`) to load the new code.

---

## 5. Sources

**Ideogram (official)**
- https://developer.ideogram.ai/api-reference/api-reference/generate-v4 — V4 2K resolution buckets
- https://developer.ideogram.ai/api-reference/api-reference/inpaint-v3 — masked edit endpoint; same-size mask; black=edit; ~1 MP output buckets
- https://developer.ideogram.ai/api-reference/api-reference/remix-v4 · /reframe-v3 · /replace-background-v3 · /edit-with-prompt · /upscale — edit feature endpoints
- https://docs.ideogram.ai/canvas-and-editing/canvas/canvas-overview — generation window = fixed pixel budget; interpolate-to-grid on download
- https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill — Magic Fill mechanics + quality best practices
- https://docs.ideogram.ai/using-ideogram/generation-settings/aspect-ratio-and-dimensions — per-version aspect→pixel tables
- https://ideogram.ai/blog/ideogram-4.0/ — 256–2048 px/side, noise schedule auto-adjusts per resolution, editing feature list

**ComfyUI**
- https://blog.comfy.org/p/ideogram-4-day-0-support-in-comfyui — Ideogram 4 open weights, day-0 (2026-06-03); t2i only
- https://huggingface.co/Comfy-Org/Ideogram-4 · https://github.com/ideogram-oss/ideogram4 — open weights
- https://docs.comfy.org/built-in-nodes/partner-node/image/ideogram/ideogram-v3 — V3 partner node (t2i + inpaint)
- https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch — crop-and-stitch mechanics (changelog 2026-01-09, 2025-04-06)
- https://github.com/lrzjason/ComfyUI-EditUtils — recent edit node (2026-05-04); longest-edge + pad, no pixel shift
- https://docs.comfy.org/built-in-nodes/DifferentialDiffusion — per-pixel soft mask
- https://comfyui-wiki.com/en/comfyui-nodes/latent/inpaint/set-latent-noise-mask — Set Latent Noise Mask vs VAE-Encode-for-Inpainting

**Hugging Face / diffusers**
- https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit.py — `calculate_dimensions`, 1 MP, ×32 snap
- https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/flux/pipeline_flux_kontext.py — `PREFERRED_KONTEXT_RESOLUTIONS` buckets, auto-resize
- https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit_plus.py — dual 384²/1 MP scheme
- https://huggingface.co/docs/diffusers/using-diffusers/inpaint · https://huggingface.co/docs/diffusers/api/image_processor — mask conventions, resize modes, blur, apply_overlay
- Models: https://huggingface.co/Qwen/Qwen-Image-Edit-2511 · https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev · https://huggingface.co/stepfun-ai/Step1X-Edit-v1p2 · https://huggingface.co/OmniGen2/OmniGen2 · https://huggingface.co/HiDream-ai/HiDream-E1-1 · https://huggingface.co/sanaka87/ICEdit-MoE-LoRA
- Papers: https://huggingface.co/papers/2201.09865 (RePaint) · https://huggingface.co/papers/2306.00950 (Differential Diffusion) · https://huggingface.co/papers/2306.16894 (PFB-Diff) · https://huggingface.co/papers/2402.17525 (editing survey) · https://arxiv.org/abs/2508.02324 (Qwen-Image) · https://arxiv.org/abs/2506.15742 (Flux Kontext)

**Prompt system / Magic Prompt / Describe (pass 2)**
- https://developer.ideogram.ai/api-reference/api-reference/generate-v4 · /generate-v4.md — text_prompt enables / json_prompt disables Magic Prompt; V4JsonPrompt schema, bbox semantics
- https://docs.ideogram.ai/using-ideogram/generation-settings/magic-prompt — Magic Prompt AUTO/ON/OFF behavior
- https://docs.ideogram.ai/canvas-and-editing/canvas/magic-fill — "recommended not to use Magic Prompt"; localize prompt to the window; include context to blend; no feather param
- https://developer.ideogram.ai/api-reference/api-reference/describe-v4.md · /describe.md — official image→JSON caption (v4) vs plain-text (legacy)
- https://docs.bfl.ml/guides/prompting_guide_kontext_i2i — Kontext "state what stays unchanged" background-preservation phrasing
- https://huggingface.co/Qwen/Qwen-Image-Edit — appearance-editing mode (all other regions unchanged)
- https://github.com/Brekel/VisionCaptioner — local VLM reverse-prompt-to-caption tooling reference

**Our code (audited)**
- `backend/inpaint.py` (`inpaint_region` :103-200, resolution :135-139, `build_outpaint` :78, feather :71/:197-198), `backend/main.py` (edit endpoints :1273/:1347, MagicPrompt-on-edit :1311-1317, extend default prompt :1378, describe :427), `backend/magic_prompt_service.py` (`expand` :204-231, `describe_image` :81-114), `backend/caption.py` (whole-scene builder :46-167, "A neutral background." default :116 — NOT used by edits), `backend/inference.py` (:643, :710), `backend/schemas.py` (:412, :434), `frontend/src/lib/caption.ts` (`aspectMatchedResolution` :333 — correct helper, unused in editing), `frontend/src/components/editor/EditorDialog.tsx` (manual fillPrompt, no Describe), `frontend/src/components/prompt/PromptBar.tsx` (Describe wired here only), `frontend/src/hooks/useInpaint.ts`.
