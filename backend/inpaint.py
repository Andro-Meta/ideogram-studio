"""
Masked latent-blend inpainting for the diffusers Ideogram 4 pipeline.

Ideogram's open weights are text-to-image only — there is no inpaint pipeline.
But the diffusers Ideogram4Pipeline is a flow-matching DiT whose denoising loop
exposes `latents` through callback_on_step_end, and its VAE encode/decode is
invertible. That's enough to do real RePaint-style inpainting:

  1. VAE-encode the source image into the model's packed token latent z0.
  2. Start the usual denoising from noise, but every step overwrite the
     UNMASKED tokens with the source's forward-noised latent at that sigma.
     The unmasked region is pinned to the original's trajectory; the masked
     region denoises freely toward the prompt.
  3. Decode, then composite in pixel space with a feathered mask so everything
     outside the selection is byte-for-byte the original.

The token layout is mirrored exactly from the pipeline's decode step (see
pipeline_ideogram4.py §9): tokens are a grid_h×grid_w grid, each token packing
ae_channels·patch·patch values, normalised by the VAE's batch-norm stats.
"""
from __future__ import annotations

import logging
from typing import Callable

import numpy as np
from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)


def _round_to(v: int, multiple: int) -> int:
    return max(multiple, int(round(v / multiple)) * multiple)


# Ideogram's editing/inpaint path is V3-era and works at ~1 megapixel matched to
# the source aspect ratio (see docs/IMAGE_EDITING_REPORT_2026-06-16.md §1, §3).
# These are the documented ResolutionV3 buckets (~1 MP), all divisible by 16, so
# the DiT samples at a resolution the edit capability was actually trained on.
_NATIVE_EDIT_BUCKETS: tuple[tuple[int, int], ...] = (
    (1024, 1024),
    (1152, 896), (896, 1152),
    (1216, 832), (832, 1216),
    (1248, 832), (832, 1248),
    (1312, 736), (736, 1312),
    (1344, 768), (768, 1344),
    (1408, 704), (704, 1408),
    (1536, 640), (640, 1536),
    (1536, 512), (512, 1536),
)

# Below this many pixels per side the DiT degrades; above ~2048 it OOMs / drifts.
_EDIT_MIN_SIDE = 256
_EDIT_MAX_SIDE = 2048
_EDIT_BUDGET = 1024 * 1024          # ~1 MP working area for edits
# Snap to a native bucket only when its aspect is within this of the source, so
# bucketing never reintroduces the aspect distortion we're fixing (the masked
# result is composited back at the original resolution, so a bucket whose aspect
# differs from the source would stretch the generated patch on the way back).
_BUCKET_ASPECT_TOLERANCE = 0.06


def _aspect_preserving_size(
    w: int, h: int, unit: int, budget: int = _EDIT_BUDGET
) -> tuple[int, int]:
    """~`budget`-pixel size with the SAME aspect ratio as (w, h), each side
    snapped to `unit` and within [256, 2048]. Clamps are applied PROPORTIONALLY
    (rescaling both sides together) so the aspect ratio is preserved even for
    extreme/ultrawide inputs — the fix for the old per-axis `min(2048, …)` clamp
    that squashed any non-square image. Max-side cap takes priority over the
    min-side floor for aspect ratios too extreme to satisfy both."""
    scale = (budget / float(w * h)) ** 0.5
    gw, gh = w * scale, h * scale

    longest = max(gw, gh)
    if longest > _EDIT_MAX_SIDE:                 # shrink both to fit the long side
        r = _EDIT_MAX_SIDE / longest
        gw, gh = gw * r, gh * r

    shortest = min(gw, gh)
    if shortest < _EDIT_MIN_SIDE:                # grow both to lift the short side
        r = _EDIT_MIN_SIDE / shortest
        gw, gh = gw * r, gh * r
        longest = max(gw, gh)
        if longest > _EDIT_MAX_SIDE:             # extreme ratio: cap wins
            r = _EDIT_MAX_SIDE / longest
            gw, gh = gw * r, gh * r

    # Final per-axis guarantee: a ratio too extreme to satisfy both bounds (>8:1
    # at this budget) would otherwise leave the short side below 256 and feed the
    # DiT a degenerate dimension. Clamp each side into [256, 2048] — this caps the
    # working aspect at 8:1 rather than going sub-floor.
    gw = min(_EDIT_MAX_SIDE, max(_EDIT_MIN_SIDE, gw))
    gh = min(_EDIT_MAX_SIDE, max(_EDIT_MIN_SIDE, gh))
    return _round_to(gw, unit), _round_to(gh, unit)


def edit_resolution(
    w: int, h: int, unit: int, *, budget: int = _EDIT_BUDGET, snap_bucket: bool = False
) -> tuple[int, int]:
    """Pick the working resolution for an edit: aspect-preserving ~1 MP, each
    side a multiple of `unit`, clamped to [256, 2048].

    The result is composited/resized back at the SOURCE resolution, so the
    working size must match the source aspect or the patch is stretched on the
    way back. `snap_bucket` is therefore OFF by default: bucket-snapping (to a
    "trained" native resolution) is only safe when a bucket's aspect matches the
    source within _BUCKET_ASPECT_TOLERANCE, and even that small mismatch is a
    visible stretch for a seamless fill, so we prefer the continuous
    aspect-preserving size. Mirrors the frontend's aspectMatchedResolution /
    clampAspect (lib/caption.ts) — same ~1 MP budget + [256,2048] policy; edits
    intentionally preserve the SOURCE aspect (up to the budget's ~8:1 limit)
    rather than imposing generation's 6:1 user-choice cap, since the source
    image's shape is fixed and we composite back onto it."""
    if not w or not h:
        return 1024, 1024
    gw, gh = _aspect_preserving_size(w, h, unit, budget)
    if snap_bucket:
        src = w / float(h)
        best: tuple[float, int, int] | None = None
        for bw, bh in _NATIVE_EDIT_BUCKETS:
            if bw % unit or bh % unit:
                continue
            err = abs((bw / float(bh)) / src - 1.0)
            if err <= _BUCKET_ASPECT_TOLERANCE and (best is None or err < best[0]):
                best = (err, bw, bh)
        if best is not None:
            return best[1], best[2]
    return gw, gh


def _encode_to_tokens(pipe, image_tensor):
    """PIL-preprocessed image tensor (B,3,H,W in [-1,1]) → packed token latent
    (B, num_tokens, ae_channels*patch*patch), the exact inverse of the
    pipeline's decode unpack + bn-denorm."""
    import torch

    patch = pipe.patch_size
    with torch.no_grad():
        posterior = pipe.vae.encode(image_tensor.to(pipe.vae.dtype))
        lat = posterior.latent_dist.mode()           # (B, ac, H_lat, W_lat)
    b, ac, h_lat, w_lat = lat.shape
    grid_h, grid_w = h_lat // patch, w_lat // patch

    # (B, ac, gh, p, gw, p) → (B, gh, gw, p, p, ac) → (B, gh*gw, ac*p*p)
    z = lat.view(b, ac, grid_h, patch, grid_w, patch)
    z = z.permute(0, 2, 4, 3, 5, 1).contiguous()
    z = z.view(b, grid_h * grid_w, ac * patch * patch)

    # Normalise with the same bn stats decode denormalises with.
    bn_mean = pipe.vae.bn.running_mean.view(1, 1, -1).to(z.device, z.dtype)
    bn_std = torch.sqrt(pipe.vae.bn.running_var + pipe.vae.config.batch_norm_eps)
    bn_std = bn_std.view(1, 1, -1).to(z.device, z.dtype)
    z = (z - bn_mean) / bn_std
    return z, grid_h, grid_w


def _mask_to_tokens(mask_img: Image.Image, grid_h: int, grid_w: int):
    """L-mode mask (255 = regenerate) → (1, num_tokens, 1) float in [0,1].

    Downsamples to the token grid and feathers the boundary by ~1 token, so
    tokens straddling the edge are PARTIALLY known. That soft transition lets
    content continue across the selection edge instead of being hard-cut (the
    "the saw vanished at the mask line" problem)."""
    import torch

    m = mask_img.convert("L").resize((grid_w, grid_h), Image.BILINEAR)
    m = m.filter(ImageFilter.GaussianBlur(0.8))            # ~1-token feather
    arr = np.asarray(m, dtype=np.float32) / 255.0          # (gh, gw)
    t = torch.from_numpy(arr).view(1, grid_h * grid_w, 1)
    return t


def build_outpaint(image: Image.Image, target_w: int, target_h: int):
    """Place `image` centered on a target_w×target_h canvas and return
    (padded_image, mask) for outpainting. The new border is edge-replicated
    (a plausible img2img start, not black) and the mask marks it white =
    regenerate; the original area is black = keep."""
    ow, oh = image.size
    target_w = max(ow, target_w)
    target_h = max(oh, target_h)
    left = (target_w - ow) // 2
    top = (target_h - oh) // 2

    arr = np.asarray(image.convert("RGB"))
    pads = ((top, target_h - oh - top), (left, target_w - ow - left), (0, 0))
    # Mirror (reflect) the border content into the new area, not edge-replicate.
    # Edge mode smears the single border row/column into long streaks (the blurry
    # "reflection" band at an extended edge); reflect gives the model real texture
    # to continue from. Reflect needs each pad < the source dim, so fall back to
    # edge for very large reframes.
    try:
        padded = np.pad(arr, pads, mode="reflect")
    except Exception:
        padded = np.pad(arr, pads, mode="edge")
    padded_img = Image.fromarray(padded)

    mask = np.full((target_h, target_w), 255, dtype=np.uint8)
    mask[top:top + oh, left:left + ow] = 0   # keep the original, regenerate the rest
    mask_img = Image.fromarray(mask, mode="L")
    return padded_img, mask_img


def inpaint_region(
    pipe,
    image: Image.Image,
    mask: Image.Image,
    prompt: str,
    *,
    num_steps: int,
    guidance_schedule,
    mu: float,
    std: float,
    seed: int,
    strength: float = 0.75,
    feather_px: int = 6,
    step_callback: Callable[[int, int], None] | None = None,
    budget: int = _EDIT_BUDGET,
) -> Image.Image:
    """Regenerate the masked region of `image` from `prompt`, keeping the rest.

    `strength` (0–1) is how much the selection may change, img2img-style: the
    masked tokens are held on the ORIGINAL image's noise trajectory for the
    first `(1 - strength)` of the steps, then released to denoise toward the
    prompt for the remaining `strength` of the steps. So the fill builds off
    your pixels (structure, pose, lighting) instead of inventing from scratch.
    strength=1 fully regenerates; low strength is a gentle, structure-keeping
    edit. The unmasked region is always pinned to the original.

    Runs on the diffusers pipeline (`pipe` is BF16Pipeline._pipe-style object).
    Returns a new PIL image at the original resolution.
    """
    import torch

    device = pipe._execution_device
    unit = pipe.vae_scale_factor * pipe.patch_size
    orig_w, orig_h = image.size
    # Aspect-preserving ~1 MP working size matched to the source ratio (was a
    # per-axis `min(2048, …)` clamp that squashed any non-square image and ran
    # the DiT at up to 4 MP). The masked result is composited back at the
    # original resolution below, so unmasked pixels stay byte-exact regardless.
    gen_w, gen_h = edit_resolution(orig_w, orig_h, unit, budget=budget)

    src = image.convert("RGB").resize((gen_w, gen_h), Image.LANCZOS)
    img_t = pipe.image_processor.preprocess(src, height=gen_h, width=gen_w).to(device)

    z0, grid_h, grid_w = _encode_to_tokens(pipe, img_t)
    mask_tok = _mask_to_tokens(mask, grid_h, grid_w).to(device, z0.dtype)

    generator = torch.Generator(device=device).manual_seed(seed)
    noise = torch.randn(z0.shape, generator=generator, device=device, dtype=z0.dtype)

    # The masked region is held on the original's trajectory at full anchor
    # until `release_step`, then the anchor ramps to 0 over a few steps so the
    # region is released *gradually* (a hard cutover leaves a visible seam at
    # the switch). The UNMASKED region is always pinned to the original.
    strength = max(0.1, min(1.0, strength))
    release_step = int(round((1.0 - strength) * num_steps))
    ramp = max(1, num_steps // 8)            # gradual-release window, ~2-3 steps

    def _anchor(i: int) -> float:
        if i < release_step:
            return 1.0
        if i < release_step + ramp:
            return 1.0 - (i - release_step + 1) / (ramp + 1)
        return 0.0

    def _on_step(p, i: int, t, kwargs: dict) -> dict:
        latents = kwargs["latents"]
        sigmas = p.scheduler.sigmas
        s = sigmas[i + 1] if i + 1 < len(sigmas) else sigmas[-1]
        known = (s * noise + (1.0 - s) * z0).to(latents.dtype)   # flow-match forward
        a = _anchor(i)
        masked = (1.0 - a) * latents + a * known                 # gradual release
        blended = mask_tok * masked + (1.0 - mask_tok) * known   # always pin outside
        if step_callback:
            step_callback(i, num_steps)
        return {"latents": blended}

    result = pipe(
        prompt=prompt,
        height=gen_h,
        width=gen_w,
        num_inference_steps=num_steps,
        guidance_scale=None,
        guidance_schedule=guidance_schedule,
        mu=mu,
        std=std,
        prompt_upsampling=False,
        generator=generator,
        latents=noise,                                # we control the init noise
        output_type="pil",
        return_dict=True,
        callback_on_step_end=_on_step,
        callback_on_step_end_tensor_inputs=["latents"],
    )
    gen = result.images[0].resize((orig_w, orig_h), Image.LANCZOS)

    # Pixel-space composite with a feathered mask: guarantees everything outside
    # the selection is exactly the original (the VAE round-trip is lossy).
    m = mask.convert("L").resize((orig_w, orig_h), Image.LANCZOS)
    if feather_px > 0:
        m = m.filter(ImageFilter.GaussianBlur(feather_px))
    out = Image.composite(gen.convert("RGB"), image.convert("RGB"), m)
    return out


def mask_coverage(mask: Image.Image, thresh: int = 8) -> float:
    """Fraction of the frame marked for regeneration (mask > thresh), 0–1. Used to
    tell a localized fill from a whole-image regen (remix)."""
    arr = np.asarray(mask.convert("L"))
    return float((arr > thresh).mean()) if arr.size else 0.0


def _mask_bbox(mask_L: Image.Image, thresh: int = 8) -> tuple[int, int, int, int] | None:
    """Tight bounding box (x0, y0, x1, y1) of the regenerate region (mask > thresh),
    or None if the mask is empty."""
    arr = np.asarray(mask_L.convert("L"))
    ys, xs = np.where(arr > thresh)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _expand_bbox(
    bbox: tuple[int, int, int, int], w: int, h: int, frac: float
) -> tuple[int, int, int, int]:
    """Grow `bbox` by `frac` of its size on each side (clamped to the image), so
    the model sees surrounding context — Ideogram's documented substitute for a
    feather: 'include some unmasked visual references to help the AI understand
    the context.'"""
    x0, y0, x1, y1 = bbox
    ex = int((x1 - x0) * frac)
    ey = int((y1 - y0) * frac)
    return max(0, x0 - ex), max(0, y0 - ey), min(w, x1 + ex), min(h, y1 + ey)


def inpaint_image(
    pipe,
    image: Image.Image,
    mask: Image.Image,
    prompt: str,
    *,
    crop: bool = True,
    context_frac: float = 0.6,
    min_crop_frac: float = 0.5,
    **kwargs,
) -> Image.Image:
    """Edit entry point. For a localized mask on a larger image, crop around the
    mask (+ a context margin), inpaint that crop at the model's native ~1 MP
    resolution, then stitch it back into the original at full resolution
    (ComfyUI 'crop-and-stitch' pattern). For a whole-image / border mask (remix,
    extend/outpaint) the mask bbox spans the canvas, so this falls back to a
    full-image inpaint automatically.

    Stitching is seamless because `inpaint_region` already composites unmasked
    pixels back to the byte-exact source within the crop, so pasting the crop
    over the original touches only the edited region.
    """
    image = image.convert("RGB")
    mask_L = mask.convert("L")
    # The bbox/crop math assumes mask and image share pixel coordinates. A client
    # could post a differently-sized mask; align it to the image first so the crop
    # isn't taken from the wrong region.
    if mask_L.size != image.size:
        mask_L = mask_L.resize(image.size, Image.LANCZOS)
    ow, oh = image.size

    if crop:
        bbox = _mask_bbox(mask_L)
        if bbox is not None:
            bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            # Only crop when the masked region is meaningfully smaller than the
            # whole frame — otherwise full-image context is worth more.
            if bw * bh < min_crop_frac * ow * oh:
                cx0, cy0, cx1, cy1 = _expand_bbox(bbox, ow, oh, context_frac)
                crop_img = image.crop((cx0, cy0, cx1, cy1))
                crop_mask = mask_L.crop((cx0, cy0, cx1, cy1))
                filled = inpaint_region(pipe, crop_img, crop_mask, prompt, **kwargs)
                out = image.copy()
                # Paste back through the (feathered) mask so ONLY regenerated
                # pixels are written — the crop's unmasked margin stays byte-exact
                # and no rectangular crop-edge seam appears (the lossy VAE/resize
                # round-trip would otherwise tint the pasted margin).
                feather = kwargs.get("feather_px", 6)
                paste_mask = crop_mask.filter(ImageFilter.GaussianBlur(feather)) if feather > 0 else crop_mask
                out.paste(filled.convert("RGB"), (cx0, cy0), paste_mask)
                return out

    return inpaint_region(pipe, image, mask_L, prompt, **kwargs)
