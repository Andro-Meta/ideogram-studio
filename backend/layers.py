"""
Split a generated image into separate transparent layers.

Ideogram 4 can't natively output layers, but it *is* bounding-box native — we
know where each element is. So for each element we crop its bbox, matte the
object out of that crop (rembg / ISNet), and drop it onto a full-size
transparent canvas at the right place. The result is one RGBA layer per element
plus a background layer — ready for Photoshop/Procreate or recompositing.

If the prompt had no bounding boxes we fall back to a single
foreground/background split (whole-image subject cutout).
"""
from __future__ import annotations

import re
import threading
import zipfile
from pathlib import Path

from PIL import Image

# rembg's onnx session is heavy to build and not thread-safe — make it once and
# serialise access (this app is single-user / single-worker).
_session = None
_lock = threading.Lock()


def _get_session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("isnet-general-use")
    return _session


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

        for i, el in enumerate(boxed):
            bb = el["bbox"]  # [ymin, xmin, ymax, xmax] in 0–1000
            ymin, xmin, ymax, xmax = (max(0, min(1000, int(v))) / 1000 for v in bb[:4])
            left = int(max(0.0, xmin - pad) * W)
            top = int(max(0.0, ymin - pad) * H)
            right = int(min(1.0, xmax + pad) * W)
            bottom = int(min(1.0, ymax + pad) * H)
            if right - left < 4 or bottom - top < 4:
                continue
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
