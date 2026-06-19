"""Difference compositing — keep the ORIGINAL image pixel-exact and paste back
only what a whole-frame edit actually changed inside the user's box(es).

The full-image-edit re-renders the WHOLE frame (faithful, but not pixel-exact —
everything outside the addition shifts slightly, the "deep fried" look). Since the
user drew the box(es) where the new content goes, we diff regen-vs-original WITHIN
those boxes: the real addition (the object + its contact shadow) towers over the
diffuse global drift, so a threshold + morphology isolates it cleanly. We then
composite ONLY that back onto the untouched original — and hand back the isolated
content as its own RGBA layer.

Pure numpy + PIL (PIL Max/MinFilter = dilate/erode), no scipy dependency.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter


def _odd(n: int) -> int:
    return int(n) | 1


def difference_mask(
    original: Image.Image, regen: Image.Image, boxes: list[list[int]], *,
    threshold: float = 36.0, margin: float = 0.05,
    close: int = 9, open_: int = 5, feather: int = 5,
) -> np.ndarray:
    """Soft mask (HxW float 0..1) of where `regen` meaningfully differs from
    `original`, restricted to `boxes` ([ymin, xmin, ymax, xmax], 0–1000) + a
    margin (for shadows/contact). `close` fills the object interior, `open_`
    drops speckle from the diffuse global drift, `feather` softens the seam."""
    W, H = original.size
    o = np.asarray(original.convert("RGB")).astype(np.float32)
    r = np.asarray(regen.convert("RGB")).astype(np.float32)
    diff = np.sqrt(((r - o) ** 2).sum(2))   # per-pixel RGB distance, 0..441

    region = np.zeros((H, W), bool)
    my, mx = int(margin * H), int(margin * W)
    if boxes:
        for box in boxes:
            ymin, xmin, ymax, xmax = box[:4]
            y0 = max(0, int(ymin / 1000 * H) - my); y1 = min(H, int(ymax / 1000 * H) + my)
            x0 = max(0, int(xmin / 1000 * W) - mx); x1 = min(W, int(xmax / 1000 * W) + mx)
            region[y0:y1, x0:x1] = True
    else:
        region[:] = True   # no boxes → consider the whole frame (caller's choice)

    m = ((diff > threshold) & region).astype(np.uint8) * 255
    mi = Image.fromarray(m)
    if close:
        mi = mi.filter(ImageFilter.MaxFilter(_odd(close))).filter(ImageFilter.MinFilter(_odd(close)))
    if open_:
        mi = mi.filter(ImageFilter.MinFilter(_odd(open_))).filter(ImageFilter.MaxFilter(_odd(open_)))
    if feather:
        mi = mi.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(mi).astype(np.float32) / 255.0


def composite_change(
    original: Image.Image, regen: Image.Image, boxes: list[list[int]], **kw,
) -> tuple[Image.Image, Image.Image, float]:
    """Keep `original` everywhere, paste `regen` only where it changed in-box.
    Returns (composited RGB, extracted RGBA layer of the change, coverage 0..1)."""
    if regen.size != original.size:
        regen = regen.resize(original.size, Image.LANCZOS)
    m = difference_mask(original, regen, boxes, **kw)
    o = np.asarray(original.convert("RGB")).astype(np.float32)
    r = np.asarray(regen.convert("RGB")).astype(np.float32)
    comp = (o * (1 - m[..., None]) + r * m[..., None]).clip(0, 255).astype(np.uint8)
    layer = np.dstack([r.astype(np.uint8), (m * 255).astype(np.uint8)])
    return Image.fromarray(comp, "RGB"), Image.fromarray(layer, "RGBA"), float(m.mean())
