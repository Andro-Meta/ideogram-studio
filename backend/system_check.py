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
    "nf4d": "ideogram-ai/ideogram-4-nf4-diffusers",
    "bf16": "CalamitousFelicitousness/Ideogram-4-bf16-Diffusers",
}

# Requirements verified against the real repos (HfApi files_metadata) and the
# installed ideogram4 loader source.
#
# download_gb — true repo snapshot sizes from the HF API:
#   nf4 16.1 GB | fp8 27.5 GB | bf16 53.6 GB
# vram_gb — every variant ships TWO transformers (conditional + unconditional)
#   plus a Qwen3-VL-8B text encoder, all resident on the GPU:
#   nf4: 5.2+5.2+5.5+0.2 ≈ 16.1 GB weights + activations → 20 GB floor
#   fp8: 9.3+9.3+8.8+0.2 ≈ 27.5 GB weights → >30 GB, no consumer card fits
# ram_gb — from_pretrained holds BOTH transformer state dicts in CPU RAM at
#   once before building. The fp8/bf16 paths additionally run model.to(dtype)
#   on the full float32 skeleton (≈37 GB for 9.3B params), which materializes
#   real pages regardless of our init suppression — unfixable from our side,
#   hence fp8's ~48 GB demand. The nf4 path (Params4bit.from_prequantized)
#   moves quantized weights straight to GPU and only needs the state dicts.
VARIANT_REQS: dict[str, dict[str, Any]] = {
    "nf4": {
        "download_gb": 16.1,
        "vram_gb": 20.0,
        "ram_gb": 16.0,
        "label": "4-bit quantized — official pick for 24 GB GPUs (RTX 3090/4090)",
    },
    "nf4d": {
        "download_gb": 16.1,
        "vram_gb": 20.0,
        # diffusers loads checkpoint shards one at a time (low_cpu_mem_usage)
        # instead of materializing whole state dicts — gentler than nf4.
        "ram_gb": 12.0,
        "label": "Official NF4 in diffusers layout — live step-by-step progress",
    },
    "fp8": {
        "download_gb": 27.5,
        "vram_gb": 30.0,
        "ram_gb": 48.0,
        "label": "8-bit float — needs A100/H100-class GPUs and ~48 GB system RAM",
    },
    "bf16": {
        "download_gb": 53.6,
        "vram_gb": 40.0,
        "ram_gb": 48.0,
        "label": "Community bf16 diffusers weights — experimental, datacenter-scale",
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


def get_commit_gb() -> tuple[float | None, float | None]:
    """Windows commit charge: (limit_gb, available_gb). (None, None) elsewhere.

    The commit limit is RAM + pagefile. Loading a model can exhaust it even
    when physical RAM looks fine — torch then fails with 'DefaultCPUAllocator:
    not enough memory', or the machine freezes if physical RAM thrashes first.
    """
    if sys.platform != "win32":
        return None, None
    try:
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
        return stat.ullTotalPageFile / gib, stat.ullAvailPageFile / gib
    except Exception:
        return None, None


def mem_snapshot() -> str:
    """One-line memory summary for log lines during model loads."""
    parts: list[str] = []
    total, avail = get_ram_gb()
    if total is not None and avail is not None:
        parts.append(f"RAM free {avail:.1f}/{total:.1f} GB")
    climit, cavail = get_commit_gb()
    if climit is not None and cavail is not None:
        parts.append(f"commit free {cavail:.1f}/{climit:.1f} GB")
    if "torch" in sys.modules:  # don't trigger a heavy import just for a log line
        try:
            import torch

            if torch.cuda.is_available():
                free_b, total_b = torch.cuda.mem_get_info(0)
                gib = 1024 ** 3
                parts.append(f"VRAM free {free_b / gib:.1f}/{total_b / gib:.1f} GB")
        except Exception:
            pass
    return " | ".join(parts) if parts else "memory info unavailable"


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
    """Decimal GB currently on disk for this variant (incl. partial downloads).

    Uses lstat so snapshot symlinks don't double-count their blob targets, and
    decimal GB (1e9) to match the sizes the HF API reports — VARIANT_REQS
    download_gb values and the download progress monitor both rely on that.
    """
    repo_dir = _hf_cache_repo_dir(variant)
    if not repo_dir.exists():
        return 0.0
    import stat as stat_mod

    total = 0
    for p in repo_dir.rglob("*"):
        try:
            st = p.lstat()
            if not stat_mod.S_ISDIR(st.st_mode):
                total += st.st_size
        except OSError:
            continue
    return total / 1e9


def is_variant_cached(variant: str) -> bool:
    """Snapshot exists, no partial downloads, and size is near the true total.

    huggingface_hub writes in-flight files as ``*.incomplete`` inside blobs/ —
    any such file means the snapshot is NOT safe to load from yet, no matter
    what the size heuristic says.
    """
    repo_dir = _hf_cache_repo_dir(variant)
    if not (repo_dir / "snapshots").exists():
        return False
    blobs_dir = repo_dir / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    return variant_cache_size_gb(variant) >= VARIANT_REQS[variant]["download_gb"] * 0.95


def get_gpu_processes() -> list[str]:
    """Names of OTHER processes currently holding GPU memory (best effort).

    Uses nvidia-smi because torch only sees its own allocations. Our own PID is
    excluded. Returns [] when nvidia-smi is unavailable or nothing else runs.
    """
    import subprocess

    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,process_name",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        return []

    me = os.getpid()
    names: list[str] = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",", 1)]
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        if int(parts[0]) == me:
            continue
        name = Path(parts[1]).name or parts[1]
        if name not in names:
            names.append(name)
    return names


# ── Assessment ────────────────────────────────────────────────────────────────

def assess_variant(
    variant: str,
    *,
    vram_total_gb: float | None,
    ram_total_gb: float | None,
    disk_free_gb: float | None,
    vram_free_gb: float | None = None,
    gpu_processes: list[str] | None = None,
    commit_available_gb: float | None = None,
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
    elif vram_free_gb is not None and vram_free_gb + 0.5 < req["vram_gb"]:
        # The card is big enough, but something else is occupying it right now.
        others = [p for p in (gpu_processes or [])]
        culprits = f" Apps using the GPU now: {', '.join(others)}." if others else ""
        hint = (
            " Ollama keeps models in VRAM after use — run 'ollama stop <model>' "
            "or quit Ollama from the system tray."
            if any("ollama" in p.lower() for p in others) else ""
        )
        blockers.append(
            f"The {variant} variant needs ~{req['vram_gb']:.0f} GB of VRAM but only "
            f"{vram_free_gb:.1f} GB of your {vram_total_gb:.1f} GB is free right now."
            f"{culprits}{hint} Close those apps and try again."
        )

    if ram_total_gb is not None and ram_total_gb + 0.5 < req["ram_gb"]:
        blockers.append(
            f"Loading the {variant} weights needs roughly {req['ram_gb']:.0f} GB of system RAM during "
            f"startup but this machine has {ram_total_gb:.1f} GB. Exceeding physical RAM is what "
            f"freezes/crashes Windows during model loads."
        )

    # Commit charge (RAM+pagefile) is a soft signal: Windows can grow the
    # pagefile, so warn rather than block.
    if (
        not blockers
        and commit_available_gb is not None
        and commit_available_gb < req["ram_gb"] + 8.0
    ):
        warnings.append(
            f"Windows commit charge headroom is low ({commit_available_gb:.1f} GB available). "
            "Close memory-heavy apps before loading; the in-load watchdog will abort "
            "safely if memory runs critically low."
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
    gpu_procs = get_gpu_processes()
    commit_limit, commit_avail = get_commit_gb()

    variants = []
    for v in ("nf4", "nf4d", "fp8", "bf16"):
        variants.append(
            assess_variant(
                v,
                vram_total_gb=vram_total,
                ram_total_gb=ram_total,
                disk_free_gb=disk_free,
                vram_free_gb=vram_free,
                gpu_processes=gpu_procs,
                commit_available_gb=commit_avail,
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
        "gpu_processes": gpu_procs,
        "ram_total_gb": round(ram_total, 1) if ram_total is not None else None,
        "ram_available_gb": round(ram_avail, 1) if ram_avail is not None else None,
        "commit_limit_gb": round(commit_limit, 1) if commit_limit is not None else None,
        "commit_available_gb": round(commit_avail, 1) if commit_avail is not None else None,
        "disk_free_gb": round(disk_free, 1) if disk_free is not None else None,
        "models_dir": str(MODELS_DIR),
        "recommended_variant": recommended,
        "variants": variants,
    }
