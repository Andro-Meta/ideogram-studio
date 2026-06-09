"""
Post-generation image upscaling via spandrel (RealESRGAN variants).
Models are downloaded from HuggingFace automatically on first use.

Tiling is used for inputs > 512 px per side to keep peak VRAM bounded.
Each 512×512 input tile produces a 2048×2048 output tile (4×) — well
within headroom on any GPU that can run Ideogram 4.
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

# All models from the well-maintained ai-forever/Real-ESRGAN HF repo.
_REGISTRY: dict[str, dict] = {
    "RealESRGAN-x4": {
        "repo_id": "ai-forever/Real-ESRGAN",
        "filename": "RealESRGAN_x4plus.pth",
        "scale": 4,
        "label": "4× Photo (RealESRGAN)",
    },
    "RealESRGAN-x4-anime": {
        "repo_id": "ai-forever/Real-ESRGAN",
        "filename": "RealESRGAN_x4plus_anime_6B.pth",
        "scale": 4,
        "label": "4× Illustration (RealESRGAN Anime)",
    },
    "RealESRGAN-x2": {
        "repo_id": "ai-forever/Real-ESRGAN",
        "filename": "RealESRGAN_x2plus.pth",
        "scale": 2,
        "label": "2× Subtle (RealESRGAN)",
    },
}

_TILE = 512         # input tile size; output = tile × scale per dimension
_cache: dict[str, dict] = {}


# ── Public helpers ────────────────────────────────────────────────────────────

def available_models() -> list[dict]:
    return [
        {"name": k, "scale": v["scale"], "label": v["label"]}
        for k, v in _REGISTRY.items()
    ]


def is_spandrel_available() -> bool:
    try:
        import spandrel  # noqa: F401
        return True
    except ImportError:
        return False


# ── Internal ──────────────────────────────────────────────────────────────────

def _device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _load(name: str) -> dict:
    """Load and cache a spandrel model, downloading from HF if absent."""
    if name in _cache:
        return _cache[name]

    if name not in _REGISTRY:
        raise ValueError(f"Unknown upscaler: {name!r}. Available: {list(_REGISTRY)}")

    info = _REGISTRY[name]
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = _MODELS_DIR / info["filename"]

    if not path.exists():
        from huggingface_hub import hf_hub_download
        logger.info("Downloading upscaler model '%s' from %s …", name, info["repo_id"])
        downloaded = hf_hub_download(
            repo_id=info["repo_id"],
            filename=info["filename"],
            local_dir=str(_MODELS_DIR),
        )
        path = Path(downloaded)

    import spandrel
    logger.info("Loading upscaler '%s'", name)
    descriptor = spandrel.ModelLoader().load_from_file(str(path))
    assert isinstance(descriptor, spandrel.ImageModelDescriptor), (
        f"Expected ImageModelDescriptor, got {type(descriptor)}"
    )

    device = _device()
    # Move inner nn.Module to GPU / CPU
    inner = descriptor.model.to(device).eval()

    entry: dict = {"inner": inner, "scale": info["scale"], "device": device}
    _cache[name] = entry
    return entry


def _to_tensor(img: Image.Image, device: torch.device) -> torch.Tensor:
    arr = np.array(img.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)


def _to_pil(t: torch.Tensor) -> Image.Image:
    arr = t.squeeze(0).permute(1, 2, 0).float().clamp(0, 1).cpu().numpy()
    return Image.fromarray((arr * 255).round().astype(np.uint8))


def _run_tiled(inner: Any, tensor: torch.Tensor, scale: int) -> torch.Tensor:
    """
    Split into _TILE×_TILE tiles, upscale each, reassemble.
    Pads to tile boundaries with reflect mode, then crops to true output size.
    """
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


# ── Public API ────────────────────────────────────────────────────────────────

def upscale(
    image_bytes: bytes,
    model_name: str = "RealESRGAN-x4",
) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    """
    Upscale an image.

    Args:
        image_bytes: Raw PNG/JPEG bytes.
        model_name:  Key from _REGISTRY.

    Returns:
        (png_bytes, (orig_w, orig_h), (upscaled_w, upscaled_h))
    """
    entry = _load(model_name)
    inner = entry["inner"]
    scale = entry["scale"]
    device = entry["device"]

    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = img.size

    tensor = _to_tensor(img, device)
    _, _, h, w = tensor.shape

    # Tile whenever either dimension exceeds the threshold
    if h > _TILE or w > _TILE:
        output = _run_tiled(inner, tensor, scale)
    else:
        with torch.no_grad():
            output = inner(tensor)

    result = _to_pil(output)
    buf = BytesIO()
    result.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), (orig_w, orig_h), result.size
