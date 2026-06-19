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


def _keep_object_blobs(binary: np.ndarray, boxes_px: list[tuple[int, int, int, int]],
                       min_rel: float = 0.15, min_abs_frac: float = 0.0015) -> np.ndarray:
    """Keep the actual added object(s) and drop unrelated changes that merely fall
    inside the rectangle (e.g. a held photo, a re-rendered waistline). Per box,
    keep blobs whose centroid is in that box and whose area is a meaningful share
    of the box's biggest blob — so a legitimately small SECOND object (its own
    box) survives, but incidental in-box drift doesn't. Speckle below an absolute
    floor is always dropped. No-op if scipy is unavailable."""
    try:
        from scipy import ndimage
    except Exception:
        return binary
    lab, n = ndimage.label(binary)
    if n <= 1:
        return binary
    H, W = binary.shape
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    coms = ndimage.center_of_mass(binary, lab, range(1, n + 1))  # (y, x) per blob
    floor = min_abs_frac * H * W
    keep: set[int] = set()
    for (y0, y1, x0, x1) in (boxes_px or [(0, H, 0, W)]):
        inbox = [i for i in range(n) if y0 <= coms[i][0] < y1 and x0 <= coms[i][1] < x1]
        if not inbox:
            continue
        local_max = max(sizes[i] for i in inbox)
        for i in inbox:
            if sizes[i] >= max(min_rel * local_max, floor):
                keep.add(i + 1)
    if not keep:                      # safety: never return empty
        keep = {int(np.argmax(sizes)) + 1}
    return np.isin(lab, list(keep))


def difference_mask(
    original: Image.Image, regen: Image.Image, boxes: list[list[int]], *,
    threshold: float = 36.0, margin: float = 0.05,
    close: int = 9, open_: int = 5, halo: int = 5, feather: int = 5,
) -> np.ndarray:
    """Soft mask (HxW float 0..1) of where `regen` meaningfully differs from
    `original`, restricted to `boxes` ([ymin, xmin, ymax, xmax], 0–1000) + a
    margin. Pipeline: threshold → despeckle (`open_`) → keep only the real object
    blob(s) (drop unrelated in-box drift) → fill interior (`close`) → small `halo`
    so the object's shadow/contact still reads natural → `feather` the seam."""
    W, H = original.size
    o = np.asarray(original.convert("RGB")).astype(np.float32)
    r = np.asarray(regen.convert("RGB")).astype(np.float32)
    diff = np.sqrt(((r - o) ** 2).sum(2))   # per-pixel RGB distance, 0..441

    region = np.zeros((H, W), bool)
    boxes_px: list[tuple[int, int, int, int]] = []
    my, mx = int(margin * H), int(margin * W)
    if boxes:
        for box in boxes:
            ymin, xmin, ymax, xmax = box[:4]
            y0 = max(0, int(ymin / 1000 * H) - my); y1 = min(H, int(ymax / 1000 * H) + my)
            x0 = max(0, int(xmin / 1000 * W) - mx); x1 = min(W, int(xmax / 1000 * W) + mx)
            region[y0:y1, x0:x1] = True
            boxes_px.append((y0, y1, x0, x1))
    else:
        region[:] = True   # no boxes → consider the whole frame (caller's choice)

    # Label on the RAW threshold: the object is one connected blob (holes inside
    # don't split it), incidental drift + speckle are separate blobs — so blob
    # filtering cleanly keeps the object before any morphology grows/bridges it.
    binm = (diff > threshold) & region
    binm = _keep_object_blobs(binm, boxes_px)   # the object(s), not in-box drift/speckle
    mi = Image.fromarray((binm * 255).astype(np.uint8))
    if close:                                   # fill the object's interior holes
        mi = mi.filter(ImageFilter.MaxFilter(_odd(close))).filter(ImageFilter.MinFilter(_odd(close)))
    if halo:                                    # keep the object's shadow/contact
        mi = mi.filter(ImageFilter.MaxFilter(_odd(halo)))
    if feather:
        mi = mi.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(mi).astype(np.float32) / 255.0


def _boxes_to_px(boxes: list[list[int]], W: int, H: int) -> list[list[int]]:
    # [ymin,xmin,ymax,xmax] 0–1000 -> [x0,y0,x1,y1] px (SAM box order)
    return [[int(b[1] / 1000 * W), int(b[0] / 1000 * H),
             int(b[3] / 1000 * W), int(b[2] / 1000 * H)] for b in boxes]


def _sam_mask_with_shadow(
    original: Image.Image, regen: Image.Image, boxes: list[list[int]], *,
    occlude_boxes: list[list[int]] | None = None,
    threshold: float = 36.0, shadow_radius: int = 18, feather: int = 4,
) -> np.ndarray | None:
    """Precise mask = the SAM-segmented object(s) UNION the object's cast
    shadow/contact (significant difference in a halo just outside the object),
    MINUS any occluder. For "behind" boxes we SAM the ORIGINAL there to get the
    existing foreground (the bench) and keep it on top → z-order occlusion.
    Returns None if SAM is unavailable (caller falls back to the diff mask)."""
    import segment
    if not segment.available():
        return None
    W, H = original.size
    masks = segment.segment_boxes(regen, _boxes_to_px(boxes, W, H))
    if not masks:
        return None
    obj = np.zeros((H, W), bool)
    for mk in masks:
        obj |= mk

    o = np.asarray(original.convert("RGB")).astype(np.float32)
    r = np.asarray(regen.convert("RGB")).astype(np.float32)
    diff = np.sqrt(((r - o) ** 2).sum(2))
    dil = np.asarray(
        Image.fromarray((obj * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(_odd(shadow_radius)))
    ) > 127
    shadow = (diff > threshold) & dil & (~obj)   # real change just outside the object
    keep = obj | shadow

    if occlude_boxes:   # z-order: subtract the existing foreground so the object sits behind it
        occ = np.zeros((H, W), bool)
        for mk in segment.segment_boxes(original, _boxes_to_px(occlude_boxes, W, H)):
            occ |= mk
        keep &= ~occ

    m = keep.astype(np.uint8) * 255
    if feather:
        m = np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(feather)))
    return m.astype(np.float32) / 255.0


def composite_change(
    original: Image.Image, regen: Image.Image, boxes: list[list[int]], *,
    use_sam: bool = True, threshold: float = 36.0,
    occlude_boxes: list[list[int]] | None = None, **kw,
) -> tuple[Image.Image, Image.Image, float]:
    """Keep `original` everywhere, paste `regen` only where it changed in-box.
    Returns (composited RGB, extracted RGBA layer of the change, coverage 0..1).
    Prefers a SAM-segmented object mask (crisp); falls back to the difference
    mask if SAM is unavailable. `occlude_boxes` keep the original foreground there
    on top (z-order occlusion)."""
    if regen.size != original.size:
        regen = regen.resize(original.size, Image.LANCZOS)
    m = None
    if use_sam:
        m = _sam_mask_with_shadow(original, regen, boxes, threshold=threshold, occlude_boxes=occlude_boxes)
    if m is None:
        m = difference_mask(original, regen, boxes, threshold=threshold, **kw)
    o = np.asarray(original.convert("RGB")).astype(np.float32)
    r = np.asarray(regen.convert("RGB")).astype(np.float32)
    comp = (o * (1 - m[..., None]) + r * m[..., None]).clip(0, 255).astype(np.uint8)
    layer = np.dstack([r.astype(np.uint8), (m * 255).astype(np.uint8)])
    return Image.fromarray(comp, "RGB"), Image.fromarray(layer, "RGBA"), float(m.mean())
