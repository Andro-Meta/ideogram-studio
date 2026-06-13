"""
Optional: NVIDIA PiD (Pixel Diffusion) prompt-aware upscaler.

OPT-IN — not installed by default. PiD is NVIDIA's pixel-diffusion super-res
decoder (https://github.com/nv-tlabs/PiD). For Ideogram (which uses the Flux.2
VAE latent space) it conditions a 2× upscale on the prompt, synthesizing
coherent detail — unlike AuraSR's blind GAN super-resolution. The Banodoco
#ideogram community pairs Ideogram → PiD for exactly this.

It is HEAVY: ~10 GB of host RAM just to load (the Gemma-2-2b-it text encoder +
the PiD model), so this whole path is:
  • offered only when the optional repo + weights are present, and
  • gated behind a hard free-RAM check so it can NEVER crash the host —
    if there isn't enough RAM it returns a clear error instead of running.

Setup: see docs/PID.md (clone nv-tlabs/PiD, install its deps, download the
flux2 *2k* checkpoint + VAE + accept the Gemma license). We use the lighter
**2k** checkpoint (2048 output) — the 2kto4k/4K variant needs far more RAM.

License note: PiD is NSCLv1 (non-commercial), consistent with Ideogram's own
non-commercial open weights.
"""
from __future__ import annotations

import glob
import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# A run needs ~10 GB; require a margin so we never push the host into a crash.
MIN_FREE_GB = 14.0

_CKPT_REL = "checkpoints/PiD_res2k_sr4x_official_flux2_distill_4step/model_ema_bf16.pth"
_VAE_REL = "checkpoints/flux2_ae.safetensors"


def _pid_home() -> Path | None:
    """The cloned nv-tlabs/PiD repo dir (must contain pid/_src/configs and a
    `checkpoints/` dir or junction). $PID_HOME wins; else a couple of defaults."""
    candidates: list[Path] = []
    if env := os.environ.get("PID_HOME"):
        candidates.append(Path(env))
    base = Path(__file__).resolve().parent.parent
    candidates += [base / "models" / "pid_repo", base / "discord_research" / "PiD"]
    for c in candidates:
        try:
            if (c / "pid" / "_src" / "configs" / "pid").exists():
                return c
        except Exception:
            continue
    return None


def availability() -> tuple[bool, str]:
    """(available, reason-if-not). Used to decide whether to offer PiD at all."""
    home = _pid_home()
    if home is None:
        return False, "PiD not installed (optional — see docs/PID.md)"
    if not (home / _CKPT_REL).exists():
        return False, "PiD flux2 2k checkpoint not downloaded"
    if not (home / _VAE_REL).exists():
        return False, "PiD flux2 VAE not downloaded"
    try:
        import importlib.util
        if importlib.util.find_spec("pid") is None:
            return False, "PiD package not installed (pip install -e the repo)"
    except Exception:
        return False, "PiD package not importable"
    return True, ""


def free_ram_gb() -> float:
    import psutil
    return psutil.virtual_memory().available / 1e9


def pid_upscale(
    image_path: str, prompt: str, *, scale: int = 2, sigma: float = 0.4, timeout: int = 900,
) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    """Prompt-aware PiD upscale. Returns (png_bytes, orig_size, up_size) to match
    the AuraSR upscaler. Raises RuntimeError (never crashes) on any problem —
    including insufficient RAM, which is checked up front."""
    ok, why = availability()
    if not ok:
        raise RuntimeError(why)

    free = free_ram_gb()
    if free < MIN_FREE_GB:
        raise RuntimeError(
            f"Not enough free RAM for PiD: {free:.1f} GB free, ~{MIN_FREE_GB:.0f} GB needed. "
            "Close other apps (browser, etc.) and try again."
        )

    home = _pid_home()
    outdir = tempfile.mkdtemp(prefix="pid_")
    try:
        cmd = [
            sys.executable, "-m", "pid._src.inference.from_clean",
            "--backbone", "flux2", "--pid_ckpt_type", "2k",
            "--input_path", str(image_path),
            "--prompt", (prompt or "high quality, sharp, detailed").strip()[:600],
            "--degrade_sigmas", str(sigma),
            "--cfg_scale", "1", "--pid_inference_steps", "4",
            "--scale", str(scale), "--output_dir", outdir,
        ]
        env = {**os.environ, "PYTHONUTF8": "1"}
        proc = subprocess.run(
            cmd, cwd=str(home), env=env, capture_output=True, text=True, timeout=timeout,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "")[-500:]
            if "MemoryError" in tail or "out of memory" in tail.lower():
                raise RuntimeError("PiD ran out of memory — close apps / free VRAM and retry.")
            raise RuntimeError(f"PiD failed: {tail}")

        outs = sorted(glob.glob(os.path.join(outdir, "flux2_PiD*", "sigma_*", "*.jpg")))
        if not outs:
            raise RuntimeError("PiD produced no output image")

        from PIL import Image
        with Image.open(image_path) as src:
            ow, oh = src.size
        out = Image.open(outs[0]).convert("RGB")
        uw, uh = out.size
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue(), (ow, oh), (uw, uh)
    finally:
        shutil.rmtree(outdir, ignore_errors=True)
