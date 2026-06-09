"""
Post-generation image upscaling — two backends, two curated models:

  AuraSR v2  (default)
    Architecture: GigaGAN (0.6B params), 2024, Apache 2.0
    Install: pip install aura-sr
    Downloads: fal/AuraSR-v2 from HuggingFace automatically
    Built-in overlapped tiling; designed for AI-generated images.
    Best overall across photorealistic and illustrated outputs.

  4xNomosUniDAT
    Architecture: DAT transformer via spandrel
    Download: Phips/4xNomosUniDAT_otf from HuggingFace
    The only upscaler trained on a genuinely diverse dataset:
    photographs + anime/illustration + painted art + text + maps.
    Use when text legibility or illustration style fidelity matters most.

Public API: upscale(image_bytes, model_name) → (png_bytes, orig_wh, up_wh)
"""
from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).parent / "models" / "upscalers"
_TILE = 512     # spandrel tile input size; 512→2048 per tile at 4×

# ── Model registry ────────────────────────────────────────────────────────────

_REGISTRY: dict[str, dict] = {
    "AuraSR-v2": {
        "backend": "aura_sr",
        "repo_id": "fal/AuraSR-v2",
        "scale": 4,
        "label": "4× AuraSR v2",
        "description": "Cutting-edge GigaGAN. Recommended for most images.",
    },
    "4xLexicaHAT": {
        "backend": "spandrel",
        "repo_id": "Phips/4xLexicaHAT",
        "filename": "4xLexicaHAT.pth",
        "scale": 4,
        "label": "4× LexicaHAT",
        "description": "HAT transformer trained on AI-generated images. Sharpest on clean AI-gen output.",
    },
    "4xNomosUniDAT": {
        "backend": "spandrel",
        "repo_id": "Phips/4xNomosUniDAT_otf",
        "filename": "4xNomosUniDAT_otf.pth",
        "scale": 4,
        "label": "4× NomosUniDAT",
        "description": "DAT transformer trained on photos, illustration, painting, and text. Best when art style fidelity matters.",
    },
}


# ── Feature detection ─────────────────────────────────────────────────────────

def is_aura_sr_available() -> bool:
    try:
        import aura_sr  # noqa: F401
        return True
    except ImportError:
        return False


def is_spandrel_available() -> bool:
    try:
        import spandrel  # noqa: F401
        return True
    except ImportError:
        return False


def available_models() -> list[dict]:
    return [
        {
            "name": k,
            "scale": v["scale"],
            "label": v["label"],
            "description": v["description"],
        }
        for k, v in _REGISTRY.items()
    ]


# ── AuraSR backend ────────────────────────────────────────────────────────────

_cache: dict[str, Any] = {}


def _load_aura_sr(name: str) -> dict:
    if name in _cache:
        return _cache[name]
    from aura_sr import AuraSR
    logger.info("Loading AuraSR v2 from HuggingFace …")
    model = AuraSR.from_pretrained(_REGISTRY[name]["repo_id"])
    entry: dict = {"model": model, "scale": 4, "backend": "aura_sr"}
    _cache[name] = entry
    return entry


def _run_aura_sr(entry: dict, img: Image.Image) -> Image.Image:
    return entry["model"].upscale_4x_overlapped(img)


# ── Spandrel backend ──────────────────────────────────────────────────────────

def _device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _load_spandrel(name: str) -> dict:
    if name in _cache:
        return _cache[name]
    import spandrel
    info = _REGISTRY[name]
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = _MODELS_DIR / info["filename"]
    if not path.exists():
        from huggingface_hub import hf_hub_download
        logger.info("Downloading %s from %s …", name, info["repo_id"])
        downloaded = hf_hub_download(
            repo_id=info["repo_id"],
            filename=info["filename"],
            local_dir=str(_MODELS_DIR),
        )
        path = Path(downloaded)
    logger.info("Loading spandrel model '%s'", name)
    descriptor = spandrel.ModelLoader().load_from_file(str(path))
    assert isinstance(descriptor, spandrel.ImageModelDescriptor), (
        f"Expected ImageModelDescriptor, got {type(descriptor)}"
    )
    device = _device()
    inner = descriptor.model.to(device).eval()
    entry: dict = {"inner": inner, "scale": info["scale"], "device": device, "backend": "spandrel"}
    _cache[name] = entry
    return entry


def _pil_to_tensor(img: Image.Image, device: torch.device) -> torch.Tensor:
    arr = np.array(img.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)


def _tensor_to_pil(t: torch.Tensor) -> Image.Image:
    arr = t.squeeze(0).permute(1, 2, 0).float().clamp(0, 1).cpu().numpy()
    return Image.fromarray((arr * 255).round().astype(np.uint8))


def _run_tiled(inner: Any, tensor: torch.Tensor, scale: int) -> torch.Tensor:
    _, c, h, w = tensor.shape
    pad_h = (-h) % _TILE
    pad_w = (-w) % _TILE
    if pad_h or pad_w:
        tensor = torch.nn.functional.pad(tensor, (0, pad_w, 0, pad_h), mode="reflect")
    _, _, ph, pw = tensor.shape
    out_h, out_w = h * scale, w * scale
    buf = torch.zeros(1, c, ph * scale, pw * scale, device=tensor.device)
    for y in range(0, ph, _TILE):
        for x in range(0, pw, _TILE):
            tile = tensor[:, :, y : y + _TILE, x : x + _TILE]
            with torch.no_grad():
                out_tile = inner(tile)
            oy, ox = y * scale, x * scale
            buf[:, :, oy : oy + out_tile.shape[2], ox : ox + out_tile.shape[3]] = out_tile
    return buf[:, :, :out_h, :out_w]


def _run_spandrel(entry: dict, img: Image.Image) -> Image.Image:
    inner, scale, device = entry["inner"], entry["scale"], entry["device"]
    tensor = _pil_to_tensor(img, device)
    _, _, h, w = tensor.shape
    if h > _TILE or w > _TILE:
        output = _run_tiled(inner, tensor, scale)
    else:
        with torch.no_grad():
            output = inner(tensor)
    return _tensor_to_pil(output)


# ── Public entry point ────────────────────────────────────────────────────────

def upscale(
    image_bytes: bytes,
    model_name: str = "AuraSR-v2",
) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    """
    Upscale an image.
    Returns (png_bytes, (orig_w, orig_h), (upscaled_w, upscaled_h)).
    Models are downloaded on first use and cached in memory.
    """
    if model_name not in _REGISTRY:
        raise ValueError(f"Unknown upscaler: {model_name!r}. Available: {list(_REGISTRY)}")

    info = _REGISTRY[model_name]
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    orig_size = img.size

    if info["backend"] == "aura_sr":
        if not is_aura_sr_available():
            raise RuntimeError("aura-sr not installed. Run: pip install aura-sr")
        result = _run_aura_sr(_load_aura_sr(model_name), img)
    else:
        if not is_spandrel_available():
            raise RuntimeError("spandrel not installed. Run: pip install spandrel>=0.3.4")
        result = _run_spandrel(_load_spandrel(model_name), img)

    buf = BytesIO()
    result.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), orig_size, result.size
