"""
Caption builder — converts the UI prompt state dict into the ordered, minified
JSON string that Ideogram 4 expects.

All key ordering rules, bbox constraints, and color format requirements are
sourced from ideogram-oss/ideogram4 caption_verifier.py and docs/prompting.md.
"""
from __future__ import annotations
import json
import re
from collections import OrderedDict

# CaptionVerifier is available after `pip install ideogram-4` (from git)
try:
    from ideogram4.caption_verifier import CaptionVerifier
    _verifier = CaptionVerifier()
    _has_verifier = True
except ImportError:
    _verifier = None
    _has_verifier = False

_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _normalise_hex(color: str) -> str | None:
    """Return uppercase #RRGGBB or None if invalid."""
    c = color.strip()
    if not c.startswith("#"):
        c = "#" + c
    if not _HEX_RE.match(c):
        return None
    return c.upper()


def _clean_palette(palette: list[str], max_colors: int) -> list[str]:
    result = []
    for c in palette:
        h = _normalise_hex(c)
        if h and h not in result:
            result.append(h)
        if len(result) >= max_colors:
            break
    return result


def build_caption(state: dict) -> tuple[str, list[str]]:
    """
    Build a minified JSON caption string from the UI prompt state.

    Args:
        state: dict matching PromptStateModel fields:
            high_level_description, style_description, background, elements

    Returns:
        (caption_json_string, list_of_warnings)
        Warnings from CaptionVerifier — generation can proceed with warnings
        but quality may degrade.
    """
    caption: OrderedDict = OrderedDict()

    hld = state.get("high_level_description", "").strip()
    if hld:
        caption["high_level_description"] = hld

    style = _build_style(state.get("style_description", {}))
    if style:
        caption["style_description"] = style

    caption["compositional_deconstruction"] = _build_compositional(state)

    warnings: list[str] = []
    if _has_verifier:
        warnings = _verifier.verify(dict(caption))

    json_str = json.dumps(caption, separators=(",", ":"), ensure_ascii=False)
    return json_str, warnings


def _build_style(style: dict) -> OrderedDict | None:
    if not style:
        return None

    aesthetics = style.get("aesthetics", "").strip()
    lighting   = style.get("lighting", "").strip()
    medium     = style.get("medium", "").strip()

    is_photo = style.get("mode", "photo") == "photo"
    mode_field = style.get("photo", "").strip() if is_photo else style.get("art_style", "").strip()

    if not any([aesthetics, lighting, medium, mode_field]):
        return None
    result: OrderedDict = OrderedDict()

    # Strict key order enforced by the model's training data
    result["aesthetics"] = aesthetics or "natural"
    result["lighting"]   = lighting   or "natural lighting"

    if is_photo:
        photo = style.get("photo", "").strip()
        result["photo"]  = photo or "standard lens"
        result["medium"] = medium or "photograph"
    else:
        result["medium"]    = medium or "illustration"
        art_style = style.get("art_style", "").strip()
        result["art_style"] = art_style or "digital art"

    palette = _clean_palette(style.get("color_palette", []), max_colors=16)
    if palette:
        result["color_palette"] = palette

    return result


def _build_compositional(state: dict) -> OrderedDict:
    comp: OrderedDict = OrderedDict()
    comp["background"] = state.get("background", "").strip() or "A neutral background."
    comp["elements"]   = [_build_element(e) for e in state.get("elements", [])]
    return comp


def _cap_words(text: str, limit: int = 60) -> str:
    """Cap a description at `limit` words, preferring a clean sentence boundary.

    The magic-prompt model occasionally overruns the ~60-word element budget,
    which degrades image quality. Trim back to the last sentence end within the
    limit when one is reasonably close; otherwise hard-cut and end with a period."""
    words = text.split()
    if len(words) <= limit:
        return text
    head = " ".join(words[:limit])
    cut = max(head.rfind("."), head.rfind("!"), head.rfind("?"))
    if cut >= len(head) * 0.6:
        return head[: cut + 1]
    return head.rstrip(" ,;:-") + "."


def _build_element(e: dict) -> OrderedDict:
    el: OrderedDict = OrderedDict()
    el["type"] = e.get("type", "obj")   # "obj" | "text"

    bbox = e.get("bbox")
    if bbox:
        # bbox is stored as {ymin, xmin, ymax, xmax} dict or [y,x,y,x] list
        if isinstance(bbox, dict):
            arr = [
                int(bbox.get("ymin", 0)), int(bbox.get("xmin", 0)),
                int(bbox.get("ymax", 1000)), int(bbox.get("xmax", 1000)),
            ]
        else:
            arr = [int(v) for v in bbox[:4]]
        # Clamp to 0-1000 and ensure min <= max
        arr = [max(0, min(1000, v)) for v in arr]
        arr[2] = max(arr[0], arr[2])   # ymax >= ymin
        arr[3] = max(arr[1], arr[3])   # xmax >= xmin
        el["bbox"] = arr

    if el["type"] == "text":
        el["text"] = e.get("text", "")

    el["desc"] = _cap_words(e.get("desc", "").strip()) or "An element in the scene."

    palette = _clean_palette(e.get("color_palette", []), max_colors=5)
    if palette:
        el["color_palette"] = palette

    return el


def parse_caption_json(json_str: str) -> dict:
    """
    Parse a magic-prompt JSON string back into a UI prompt state dict.
    Tolerant of missing keys.
    """
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        return {}

    state: dict = {}
    state["high_level_description"] = data.get("high_level_description", "")

    sd = data.get("style_description", {})
    if sd:
        mode = "photo" if "photo" in sd else "illustration"
        state["style_description"] = {
            "mode":         mode,
            "aesthetics":   sd.get("aesthetics", ""),
            "lighting":     sd.get("lighting", ""),
            "medium":       sd.get("medium", ""),
            "photo":        sd.get("photo", ""),
            "art_style":    sd.get("art_style", ""),
            "color_palette": sd.get("color_palette", []),
        }
    else:
        state["style_description"] = {
            "mode": "photo", "aesthetics": "", "lighting": "",
            "medium": "", "photo": "", "art_style": "", "color_palette": [],
        }

    comp = data.get("compositional_deconstruction", {})
    state["background"] = comp.get("background", "")

    elements = []
    for i, el in enumerate(comp.get("elements", [])):
        bbox_raw = el.get("bbox")
        bbox = None
        if bbox_raw and len(bbox_raw) == 4:
            bbox = {
                "ymin": bbox_raw[0], "xmin": bbox_raw[1],
                "ymax": bbox_raw[2], "xmax": bbox_raw[3],
            }
        elements.append({
            "id":            f"el-{i}",
            "type":          el.get("type", "obj"),
            "bbox":          bbox,
            "text":          el.get("text", ""),
            "desc":          el.get("desc", ""),
            "color_palette": el.get("color_palette", []),
        })
    state["elements"] = elements
    return state
