"""
Local image editing — rotate / flip / brightness / contrast / saturation /
sharpness, applied with Pillow.

Why this exists: the Ideogram 4 open-weights release is text-to-image only.
Ideogram kept Canvas, Magic Fill (inpainting) and Extend (outpainting) as
server-side products — neither the official ideogram4 package nor the
diffusers pipeline expose any image-to-image entry point. These tools cover
the everyday adjustments locally; AI-powered fill/extend is not possible
with the released weights.
"""
from __future__ import annotations

import io

from PIL import Image, ImageEnhance


def apply_edits(
    image_bytes: bytes,
    *,
    rotate: int = 0,            # 0 | 90 | 180 | 270 (clockwise)
    flip_h: bool = False,
    flip_v: bool = False,
    brightness: float = 1.0,    # 0.2 – 3.0, 1.0 = unchanged
    contrast: float = 1.0,
    saturation: float = 1.0,
    sharpness: float = 1.0,
) -> tuple[bytes, tuple[int, int]]:
    """Returns (png_bytes, (width, height)) of the edited image."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    if rotate in (90, 180, 270):
        # PIL rotates counter-clockwise; expand keeps the full canvas
        img = img.rotate(-rotate, expand=True)
    if flip_h:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flip_v:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

    def _clamp(v: float) -> float:
        return max(0.2, min(3.0, v))

    if brightness != 1.0:
        img = ImageEnhance.Brightness(img).enhance(_clamp(brightness))
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(_clamp(contrast))
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(_clamp(saturation))
    if sharpness != 1.0:
        img = ImageEnhance.Sharpness(img).enhance(_clamp(sharpness))

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), img.size
