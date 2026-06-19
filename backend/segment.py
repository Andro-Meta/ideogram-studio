"""SAM2 object segmentation (via Ultralytics) for precise edit masks — give it
the user's box, get back a clean object outline. Used by the full-image-edit
keep-original composite so we paste the actual OBJECT (crisp fur edges), not a
rectangle of "what changed". Lazy-loaded and fully optional: if Ultralytics /
the weights aren't present it returns nothing and the caller falls back to the
difference mask.
"""
from __future__ import annotations

import logging

import numpy as np
from PIL import Image

from settings import MODELS_DIR

logger = logging.getLogger("ideogram.segment")

_model = None   # None = untried, False = tried & unavailable, else the loaded model
_WEIGHTS = MODELS_DIR / "sam2.1_t.pt"   # tiny SAM2.1 (~75 MB), auto-downloaded


def _get():
    """Lazy-load the SAM2 model. Returns the model, or None if unavailable."""
    global _model
    if _model is not None:
        return _model or None
    try:
        from ultralytics import SAM
        _model = SAM(str(_WEIGHTS))   # Ultralytics downloads the asset if missing
        logger.info("SAM2 loaded (%s)", _WEIGHTS.name)
    except Exception as exc:   # not installed / no weights / load error
        logger.warning("SAM2 unavailable (%s) — falling back to the difference mask", exc)
        _model = False
    return _model or None


def available() -> bool:
    return _get() is not None


def segment_boxes(image: Image.Image, boxes_px: list[list[int]]) -> list[np.ndarray]:
    """Segment one object per box. `boxes_px` are [x0, y0, x1, y1] pixel boxes.
    Returns a list of boolean HxW masks (image-sized), or [] if SAM is
    unavailable / found nothing."""
    model = _get()
    if model is None or not boxes_px:
        return []
    arr = np.asarray(image.convert("RGB"))
    H, W = arr.shape[:2]
    try:
        res = model(arr, bboxes=boxes_px, verbose=False)
    except Exception as exc:
        logger.warning("SAM2 segmentation failed (%s)", exc)
        return []
    r = res[0]
    if r.masks is None:
        return []
    data = r.masks.data.cpu().numpy()   # (N, h, w) — may be at a different size
    out: list[np.ndarray] = []
    for i in range(data.shape[0]):
        m = data[i]
        if m.shape != (H, W):
            m = np.asarray(Image.fromarray((m > 0.5).astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 127
        else:
            m = m > 0.5
        out.append(m)
    return out
