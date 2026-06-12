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
    padded = np.pad(
        arr,
        ((top, target_h - oh - top), (left, target_w - ow - left), (0, 0)),
        mode="edge",                       # replicate border pixels into the new area
    )
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
    gen_w = min(2048, _round_to(orig_w, unit))
    gen_h = min(2048, _round_to(orig_h, unit))

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
