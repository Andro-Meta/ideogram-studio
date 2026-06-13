"""
Split a generated image into separate transparent layers.

Ideogram 4 can't natively output layers, but it *is* bounding-box native — we
know where each element is. So for each element we feed its bbox to SAM
(Segment Anything) as a box prompt to get a precise mask, and drop the matted
object onto a full-size transparent canvas. This is the approach Kijai endorsed
in the Banodoco #ideogram channel ("build it with SAM — you already have the
boxes to target"). rembg/ISNet is the fallback if SAM is unavailable, and is
also used for the whole-image foreground cutout when the prompt had no boxes.

The result is one RGBA layer per element plus a background layer — ready for
Photoshop/Procreate or recompositing.
"""
from __future__ import annotations

import re
import threading
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

# Both models are heavy to build and not thread-safe — make each once and
# serialise access (this app is single-user / single-worker).
_session = None
_sam = None  # (model, processor, device)
_lock = threading.Lock()


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
                # Precise: SAM box-prompt → full-size mask → matte at native place.
                mask = _sam_mask(image, box_px)
                rgba = np.dstack([rgb, (mask.astype("uint8") * 255)])
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
