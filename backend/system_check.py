"""
Hardware pre-flight checks for model downloads and loading.

Why this exists: downloading/loading a 9.3B-parameter model (plus its 8B
Qwen3-VL text encoder) can exhaust system RAM or fill a disk, which on Windows
can freeze or crash the entire machine. Every model load is gated by these
checks, and the GUI uses /api/system to recommend the right variant.

Requirement numbers follow the official ideogram-oss/ideogram4 guidance:
  - nf4: fits a single 24 GB GPU (RTX 3090 / 4090) — the consumer-GPU variant
  - fp8: higher fidelity, sized for A100/H100-class hardware (~32 GB+)
  - bf16: community-converted diffusers weights, experimental
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Any

from settings import MODELS_DIR

REPOS: dict[str, str] = {
    "fp8": "ideogram-ai/ideogram-4-fp8",
    "nf4": "ideogram-ai/ideogram-4-nf4",
    "bf16": "CalamitousFelicitousness/Ideogram-4-bf16-Diffusers",
}

# Conservative estimates (GB). download_gb = full repo snapshot on disk.
VARIANT_REQS: dict[str, dict[str, Any]] = {
    "nf4": {
        "download_gb": 14.0,
        "vram_gb": 20.0,
        "ram_gb": 12.0,
        "label": "4-bit quantized — official pick for 24 GB GPUs (RTX 3090/4090)",
    },
    "fp8": {
        "download_gb": 27.0,
        "vram_gb": 30.0,
        "ram_gb": 24.0,
        "label": "8-bit float — sized for A100/H100-class GPUs (~32 GB+)",
    },
    "bf16": {
        "download_gb": 38.0,
        "vram_gb": 30.0,
        "ram_gb": 32.0,
        "label": "Community bf16 diffusers weights — experimental, very heavy",
    },
}

DISK_SAFETY_MARGIN_GB = 8.0   # never let a download eat the last few GB of a drive


# ── Probes ────────────────────────────────────────────────────────────────────

def get_ram_gb() -> tuple[float | None, float | None]:
    """(total_gb, available_gb). Works on Windows (ctypes) and Linux (/proc)."""
    try:
        if sys.platform == "win32":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            gib = 1024 ** 3
            return stat.ullTotalPhys / gib, stat.ullAvailPhys / gib

        meminfo: dict[str, int] = {}
        with open("/proc/meminfo") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 2:
                    meminfo[parts[0].rstrip(":")] = int(parts[1])  # kB
        total = meminfo.get("MemTotal")
        avail = meminfo.get("MemAvailable")
        kib = 1024 ** 2
        return (
            total / kib if total is not None else None,
            avail / kib if avail is not None else None,
        )
    except Exception:
        return None, None


def get_gpu_info() -> tuple[str | None, float | None, float | None]:
    """(name, vram_total_gb, vram_free_gb) for CUDA device 0, or Nones."""
    try:
        import torch

        if not torch.cuda.is_available():
            return None, None, None
        props = torch.cuda.get_device_properties(0)
        free_b, total_b = torch.cuda.mem_get_info(0)
        gib = 1024 ** 3
        return props.name, total_b / gib, free_b / gib
    except Exception:
        return None, None, None


def get_disk_free_gb(path: Path | None = None) -> float | None:
    try:
        target = path or MODELS_DIR
        # Walk up until an existing ancestor (MODELS_DIR may not exist yet)
        while not target.exists() and target.parent != target:
            target = target.parent
        return shutil.disk_usage(str(target)).free / (1024 ** 3)
    except Exception:
        return None


def _hf_cache_repo_dir(variant: str) -> Path:
    repo = REPOS[variant]
    hub_dir = Path(os.environ.get("HF_HOME", str(MODELS_DIR / "hf"))) / "hub"
    return hub_dir / f"models--{repo.replace('/', '--')}"


def variant_cache_size_gb(variant: str) -> float:
    """Bytes currently on disk for this variant (including partial downloads)."""
    repo_dir = _hf_cache_repo_dir(variant)
    if not repo_dir.exists():
        return 0.0
    total = 0
    for p in repo_dir.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            continue
    return total / (1024 ** 3)


def is_variant_cached(variant: str) -> bool:
    """Heuristic: snapshot exists and on-disk size is near the expected total."""
    repo_dir = _hf_cache_repo_dir(variant)
    if not (repo_dir / "snapshots").exists():
        return False
    return variant_cache_size_gb(variant) >= VARIANT_REQS[variant]["download_gb"] * 0.85


# ── Assessment ────────────────────────────────────────────────────────────────

def assess_variant(
    variant: str,
    *,
    vram_total_gb: float | None,
    ram_total_gb: float | None,
    disk_free_gb: float | None,
) -> dict[str, Any]:
    """Returns {variant, cached, blockers, warnings, requirements}."""
    req = VARIANT_REQS[variant]
    cached = is_variant_cached(variant)
    blockers: list[str] = []
    warnings: list[str] = []

    if not cached and disk_free_gb is not None:
        needed = req["download_gb"] + DISK_SAFETY_MARGIN_GB
        if disk_free_gb < needed:
            blockers.append(
                f"Not enough disk space for the {variant} download: needs ~{req['download_gb']:.0f} GB "
                f"(+{DISK_SAFETY_MARGIN_GB:.0f} GB safety margin) but only {disk_free_gb:.1f} GB free "
                f"on the drive holding {MODELS_DIR}."
            )

    if vram_total_gb is not None and vram_total_gb + 0.5 < req["vram_gb"]:
        blockers.append(
            f"The {variant} variant needs roughly {req['vram_gb']:.0f} GB of VRAM but your GPU has "
            f"{vram_total_gb:.1f} GB. "
            + ("Use nf4 instead — it is the official variant for 24 GB GPUs." if variant != "nf4" else "")
        )
    elif vram_total_gb is None:
        warnings.append("No CUDA GPU detected — generation will not work without one.")

    if ram_total_gb is not None and ram_total_gb + 0.5 < req["ram_gb"]:
        blockers.append(
            f"Loading the {variant} weights needs roughly {req['ram_gb']:.0f} GB of system RAM during "
            f"startup but this machine has {ram_total_gb:.1f} GB. Exceeding physical RAM is what "
            f"freezes/crashes Windows during model loads."
        )

    return {
        "variant": variant,
        "cached": cached,
        "blockers": blockers,
        "warnings": warnings,
        "requirements": {
            "download_gb": req["download_gb"],
            "vram_gb": req["vram_gb"],
            "ram_gb": req["ram_gb"],
            "label": req["label"],
        },
    }


def get_system_report() -> dict[str, Any]:
    """Full report used by GET /api/system. Blocking — call from a thread."""
    gpu_name, vram_total, vram_free = get_gpu_info()
    ram_total, ram_avail = get_ram_gb()
    disk_free = get_disk_free_gb()

    variants = []
    for v in ("nf4", "fp8", "bf16"):
        variants.append(
            assess_variant(
                v,
                vram_total_gb=vram_total,
                ram_total_gb=ram_total,
                disk_free_gb=disk_free,
            )
        )

    # Recommendation: nf4 unless the machine is clearly datacenter-class.
    recommended = "nf4"
    if (
        vram_total is not None and vram_total >= VARIANT_REQS["fp8"]["vram_gb"]
        and ram_total is not None and ram_total >= VARIANT_REQS["fp8"]["ram_gb"]
    ):
        recommended = "fp8"
    for item in variants:
        item["recommended"] = item["variant"] == recommended

    return {
        "gpu_name": gpu_name,
        "vram_total_gb": round(vram_total, 1) if vram_total is not None else None,
        "vram_free_gb": round(vram_free, 1) if vram_free is not None else None,
        "ram_total_gb": round(ram_total, 1) if ram_total is not None else None,
        "ram_available_gb": round(ram_avail, 1) if ram_avail is not None else None,
        "disk_free_gb": round(disk_free, 1) if disk_free is not None else None,
        "models_dir": str(MODELS_DIR),
        "recommended_variant": recommended,
        "variants": variants,
    }
