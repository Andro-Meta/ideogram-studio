"""
Split a generated image into separate transparent layers.

Ideogram 4 can't natively output layers, but it *is* bounding-box native — we
know where each element is. So for each element we feed its bbox to SAM
(Segment Anything) as a box prompt to get a precise mask, and drop the matted
object onto a full-size transparent canvas. This is the approach Kijai endorsed
in the Banodoco #ideogram channel ("build it with SAM — you already have the
boxes to target"). rembg/ISNet is the fallback if SAM is unavailable, and is
also used for the whole-image foreground cutout when the prompt had no boxes.

SAM returns a *binary* mask — hard, jagged edges on hair, fur, glass, soft
shadows, and anti-aliased text. So we refine it into a SOFT alpha matte with
ViTMatte (hustvl/vitmatte-small-composition-1k, Apache-2.0, ~26M params): build
a trimap from the SAM mask (erode → definite FG, dilate → definite BG, the band
between → unknown) and let ViTMatte solve alpha in the unknown band only. This
is the standard "SAM → trimap → ViTMatte" pipeline (cf. hustvl/Matte-Anything).
It is best-effort: any failure (model not downloaded, OOM, etc.) falls straight
back to the binary SAM cutout, so layers always come out. Disable with
LAYERS_SOFT_MATTE=0.

The result is one RGBA layer per element plus a background layer — ready for
Photoshop/Procreate or recompositing.
"""
from __future__ import annotations

import os
import re
import threading
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Both models are heavy to build and not thread-safe — make each once and
# serialise access (this app is single-user / single-worker).
_session = None
_sam = None  # (model, processor, device)
_vitmatte = None  # (model, processor, device)
_vitmatte_ok = True  # flips false once if the model can't be loaded/used
_lock = threading.Lock()

# ViTMatte soft-alpha refinement of SAM masks. Off via LAYERS_SOFT_MATTE=0.
SOFT_MATTE = os.getenv("LAYERS_SOFT_MATTE", "1").strip().lower() not in ("0", "false", "no", "off")
VITMATTE_MODEL = "hustvl/vitmatte-small-composition-1k"
# Cap the matting resolution: the alpha solve is soft so a downscale-then-
# upscale is invisible, and it keeps memory/time bounded next to the ~20GB
# generation model that may still be resident on the GPU.
MATTE_MAX_SIDE = 1536


def _get_session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("isnet-general-use")
    return _session


def _get_sam():
    """Lazy-load SAM (facebook/sam-vit-base, ~375MB). Prefer CUDA; fall back to
    CPU if the GPU is full (the generation model already holds ~20GB)."""
    global _sam
    if _sam is None:
        import torch
        from transformers import SamModel, SamProcessor
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            model = SamModel.from_pretrained("facebook/sam-vit-base").to(dev).eval()
        except Exception:
            dev = "cpu"
            model = SamModel.from_pretrained("facebook/sam-vit-base").to(dev).eval()
        proc = SamProcessor.from_pretrained("facebook/sam-vit-base")
        _sam = (model, proc, dev)
    return _sam


def _sam_mask(image: Image.Image, box_px: tuple[int, int, int, int]) -> np.ndarray:
    """Box-prompted SAM mask (boolean, full image size). Picks the highest-IoU of
    SAM's three candidate masks."""
    import torch
    model, proc, dev = _get_sam()
    inputs = proc(image, input_boxes=[[list(box_px)]], return_tensors="pt").to(dev)
    with torch.no_grad():
        out = model(**inputs)
    masks = proc.image_processor.post_process_masks(
        out.pred_masks.cpu(), inputs["original_sizes"].cpu(), inputs["reshaped_input_sizes"].cpu()
    )
    iou = out.iou_scores.cpu().numpy()[0, 0]
    return masks[0][0][int(iou.argmax())].numpy()


def _get_vitmatte():
    """Lazy-load ViTMatte (hustvl/vitmatte-small-composition-1k, ~100MB). Returns
    None — and disables itself for the rest of the process — if it can't load, so
    callers fall back to the binary SAM mask."""
    global _vitmatte, _vitmatte_ok
    if not _vitmatte_ok:
        return None
    if _vitmatte is None:
        try:
            import torch
            from transformers import VitMatteForImageMatting, VitMatteImageProcessor
            dev = "cuda" if torch.cuda.is_available() else "cpu"
            model = VitMatteForImageMatting.from_pretrained(VITMATTE_MODEL).to(dev).eval()
            proc = VitMatteImageProcessor.from_pretrained(VITMATTE_MODEL)
            _vitmatte = (model, proc, dev)
        except Exception:
            _vitmatte_ok = False
            return None
    return _vitmatte


def _trimap_from_mask(mask_bool: np.ndarray, w: int, h: int) -> Image.Image:
    """Erode the SAM mask → definite FG (255); dilate it → definite BG outside;
    the band between them → unknown (128). ViTMatte only solves alpha in the
    unknown band, so the band width is the hair-vs-clean-edge knob. We scale it
    to ~1.5% of the short side (a real band is mandatory — a zero-width unknown
    region just returns the binary mask)."""
    m = Image.fromarray((mask_bool.astype("uint8") * 255), "L")
    iters = max(4, round(min(w, h) * 0.015))
    eroded, dilated = m, m
    for _ in range(iters):
        eroded = eroded.filter(ImageFilter.MinFilter(3))
        dilated = dilated.filter(ImageFilter.MaxFilter(3))
    e = np.asarray(eroded)
    d = np.asarray(dilated)
    tri = np.zeros((h, w), dtype="uint8")
    tri[d > 127] = 128   # inside dilated → unknown
    tri[e > 127] = 255   # inside eroded → definite foreground
    return Image.fromarray(tri, "L")


def _vitmatte_alpha(image_rgb: Image.Image, mask_bool: np.ndarray) -> np.ndarray | None:
    """Refine a binary SAM mask into a soft alpha matte (uint8 0–255, full size).
    Best-effort: returns None on any failure so the caller keeps the binary mask."""
    mm = _get_vitmatte()
    if mm is None:
        return None
    import torch
    model, proc, dev = mm
    W, H = image_rgb.size

    # Work at a capped resolution (fast + OOM-safe); the alpha is soft so the
    # downscale→solve→upscale round-trip is visually lossless.
    scale = min(1.0, MATTE_MAX_SIDE / max(W, H))
    wm, hm = max(1, round(W * scale)), max(1, round(H * scale))
    img_s = image_rgb.resize((wm, hm), Image.BILINEAR) if scale < 1.0 else image_rgb
    mask_img = Image.fromarray((mask_bool.astype("uint8") * 255), "L")
    mask_s = mask_img.resize((wm, hm), Image.NEAREST) if scale < 1.0 else mask_img
    trimap = _trimap_from_mask(np.asarray(mask_s) > 127, wm, hm)

    inputs = proc(images=img_s, trimaps=trimap, return_tensors="pt")

    def _run(device: str) -> np.ndarray:
        ins = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            return model.to(device)(**ins).alphas[0, 0].float().cpu().numpy()

    try:
        alpha = _run(dev)
    except RuntimeError:
        # Most likely CUDA OOM (gen model resident) — retry on CPU rather than die.
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        alpha = _run("cpu")

    # The processor pads to a multiple of 32 on the bottom/right — crop back.
    alpha = alpha[:hm, :wm]
    a_img = Image.fromarray(np.clip(alpha * 255.0, 0, 255).astype("uint8"), "L")
    if scale < 1.0:
        a_img = a_img.resize((W, H), Image.BILINEAR)
    return np.asarray(a_img)


def _safe(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "").strip())[:32].strip("_")
    return s or "element"


def _cutout(crop: Image.Image) -> Image.Image:
    from rembg import remove
    return remove(crop, session=_get_session()).convert("RGBA")


def split_into_layers(
    image: Image.Image, elements: list[dict], pad: float = 0.04,
) -> list[tuple[str, str, Image.Image]]:
    """Return [(name, kind, RGBA full-size image)] — background first, then a
    transparent layer per boxed element."""
    image = image.convert("RGB")
    W, H = image.size
    out: list[tuple[str, str, Image.Image]] = [("background", "background", image.convert("RGBA"))]

    boxed = [e for e in (elements or []) if e.get("bbox")]

    with _lock:
        if not boxed:
            # No layout boxes — one salient foreground cutout.
            out.append(("foreground", "foreground", _cutout(image)))
            return out

        rgb = np.array(image)
        for i, el in enumerate(boxed):
            bb = el["bbox"]  # [ymin, xmin, ymax, xmax] in 0–1000
            ymin, xmin, ymax, xmax = (max(0, min(1000, int(v))) / 1000 for v in bb[:4])
            box_px = (int(xmin * W), int(ymin * H), int(xmax * W), int(ymax * H))
            if box_px[2] - box_px[0] < 4 or box_px[3] - box_px[1] < 4:
                continue

            canvas: Image.Image | None = None
            try:
                # Precise: SAM box-prompt → full-size mask. Refine to a soft alpha
                # with ViTMatte (best-effort) for clean hair/glass/text edges;
                # fall back to the binary mask if matting is off or fails.
                mask = _sam_mask(image, box_px)
                alpha = None
                if SOFT_MATTE:
                    try:
                        alpha = _vitmatte_alpha(image, mask)
                    except Exception:
                        alpha = None
                if alpha is None:
                    alpha = mask.astype("uint8") * 255
                rgba = np.dstack([rgb, alpha.astype("uint8")])
                canvas = Image.fromarray(rgba, "RGBA")
            except Exception:
                canvas = None  # fall back to rembg on the padded crop
            if canvas is None:
                left = int(max(0.0, xmin - pad) * W)
                top = int(max(0.0, ymin - pad) * H)
                right = int(min(1.0, xmax + pad) * W)
                bottom = int(min(1.0, ymax + pad) * H)
                cut = _cutout(image.crop((left, top, right, bottom)))
                canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                canvas.paste(cut, (left, top), cut)

            label = el.get("text") or el.get("desc") or f"element_{i + 1}"
            out.append((f"{i + 1}_{_safe(label)}", el.get("type", "obj"), canvas))
    return out


def save_layers(
    layers: list[tuple[str, str, Image.Image]], out_dir: Path, stem: str,
) -> tuple[list[tuple[str, str, str]], str]:
    """Save each layer PNG + a combined ZIP. Returns (entries, zip_filename)
    where entries are (name, kind, filename). Filenames use only the validated
    stem + index, never user text, so they can't traverse."""
    out_dir.mkdir(parents=True, exist_ok=True)
    entries: list[tuple[str, str, str]] = []
    for idx, (name, kind, img) in enumerate(layers):
        fn = f"{stem}_layer{idx}.png"
        img.save(out_dir / fn, "PNG")
        entries.append((name, kind, fn))

    zip_name = f"{stem}_layers.zip"
    with zipfile.ZipFile(out_dir / zip_name, "w", zipfile.ZIP_DEFLATED) as z:
        for name, kind, fn in entries:
            # arcname is a friendly label inside the zip (safe chars only)
            z.write(out_dir / fn, arcname=f"{_safe(name)}.png")
    return entries, zip_name
