"""Boogu-Image-0.1-Edit backend — native instruction image editing.

Boogu is a separate 10B model with its own repo + pinned deps (torch 2.7/cu126),
so we don't import it: we shell out to its `inference.py` in its own venv. Opt-in
(like PiD) — `installed()` is False until the user runs setup_boogu.bat. Heavy:
the subprocess loads the 10B model onto the GPU, so for a 24 GB card either unload
the Ideogram pipeline first or run with CPU offload on.

ponytail: subprocess over reimplementing the pipeline; flags live in one dict so a
spec drift is a one-line fix, not a rewrite.
"""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

from settings import BASE_DIR

logger = logging.getLogger("ideogram.boogu")

# Clone location + its venv python + the Edit weights (all from the Boogu setup).
BOOGU_DIR = Path(os.environ.get("BOOGU_DIR", str(BASE_DIR / "Boogu-Image")))
_venv_py = "Scripts/python.exe" if os.name == "nt" else "bin/python"
BOOGU_PYTHON = Path(os.environ.get("BOOGU_PYTHON", str(BOOGU_DIR / "venv" / _venv_py)))
EDIT_WEIGHTS = BOOGU_DIR / "models" / "Boogu-Image-0.1-Edit"


def installed() -> bool:
    return (BOOGU_DIR / "inference.py").is_file() and EDIT_WEIGHTS.is_dir() and BOOGU_PYTHON.exists()


def build_cmd(in_path: Path, out_path: Path, instruction: str, *, steps: int,
              text_guidance: float, image_guidance: float, seed: int,
              height: int, width: int, offload: bool, fp8: bool) -> list[str]:
    cmd = [
        str(BOOGU_PYTHON), "inference.py",
        "--pretrained_pipeline_name_or_path", str(EDIT_WEIGHTS),
        "--instruction", instruction,
        "--input_image_paths", str(in_path),
        "--output_image_path", str(out_path),
        "--device", "cuda:0", "--rewriter_device", "cuda:0",
        "--enable_sequential_cpu_offload_flag", str(bool(offload)),
        "--enable_model_cpu_offload_flag", "False",
        "--enable_group_offload_flag", "False",
        "--height", str(height), "--width", str(width),
        "--num_inference_steps", str(steps),
        "--text_guidance_scale", str(text_guidance),
        "--image_guidance_scale", str(image_guidance),
        "--seed", str(seed), "--dtype", "bf16", "--scheduler", "euler",
    ]
    if fp8:
        cmd += ["--use_fp8_weights", "True"]
    return cmd


def run_edit(in_path: Path, out_path: Path, instruction: str, *, steps: int = 50,
             text_guidance: float = 7.5, image_guidance: float = 1.5, seed: int = 42,
             height: int = 1024, width: int = 1024, offload: bool = True,
             fp8: bool = False, timeout: int = 1200) -> Path:
    if not installed():
        raise RuntimeError(
            "Boogu-Image-Edit is not installed. Run setup_boogu.bat (clones the repo, "
            "makes its venv, downloads the Edit weights)."
        )
    cmd = build_cmd(in_path, out_path, instruction, steps=steps, text_guidance=text_guidance,
                    image_guidance=image_guidance, seed=seed, height=height, width=width,
                    offload=offload, fp8=fp8)
    logger.info("Boogu edit: %s", " ".join(cmd[2:8]))
    r = subprocess.run(cmd, cwd=str(BOOGU_DIR), capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0 or not out_path.exists():
        tail = (r.stderr or r.stdout or "")[-1000:]
        raise RuntimeError(f"Boogu edit failed (exit {r.returncode}): {tail}")
    return out_path


if __name__ == "__main__":  # ponytail: smallest check — flags assemble as spec'd
    c = build_cmd(Path("in.png"), Path("out.png"), "make it blue", steps=40,
                  text_guidance=7.5, image_guidance=1.5, seed=1, height=1024, width=1024,
                  offload=True, fp8=True)
    assert "--instruction" in c and c[c.index("--instruction") + 1] == "make it blue"
    assert c[c.index("--input_image_paths") + 1] == "in.png"
    assert c[c.index("--num_inference_steps") + 1] == "40"
    assert "--use_fp8_weights" in c
    assert "--enable_sequential_cpu_offload_flag" in c
    print("ok")
