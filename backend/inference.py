"""
Inference pipeline abstraction.

FP8Pipeline  — uses ideogram-oss/ideogram4 package (fp8 weights)
BF16Pipeline — uses huggingface/diffusers Ideogram4Pipeline (bf16 weights)

Both implement InferencePipeline so the rest of the app never knows which
variant is loaded.

guidance_schedule direction NOTE (from project.md §9.4):
  ideogram4 package:  index 0 = LAST step  (reverse order)
  diffusers pipeline: index 0 = FIRST step (forward order)
The BF16Pipeline presets are already in forward order.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import random
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from PIL import Image

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _no_random_init():
    """Skip parameter initialization while building model skeletons.

    THE FIX for the system-freeze bug: ideogram4's loader constructs the full
    transformer in float32 on the CPU and runs random weight initialization
    (kaiming/uniform/...) on tens of GB of parameters BEFORE swapping in the
    quantized layers. Writing those initial values touches every memory page,
    which exhausts physical RAM on 16-32 GB machines and freezes Windows in
    pagefile thrash.

    Every initialized value is immediately overwritten by checkpoint weights
    (the loader raises on missing keys), so the init work is 100% wasted.
    No-oping torch.nn.init.* during construction leaves the skeleton's pages
    untouched: memory stays virtual until real weights land, and the load fits
    comfortably in normal amounts of RAM.
    """
    import torch.nn.init as nn_init

    names = [
        "uniform_", "normal_", "trunc_normal_", "constant_", "ones_", "zeros_",
        "kaiming_uniform_", "kaiming_normal_", "xavier_uniform_",
        "xavier_normal_", "orthogonal_", "dirac_", "sparse_", "eye_",
    ]
    saved = {n: getattr(nn_init, n) for n in names if hasattr(nn_init, n)}

    def _noop(tensor, *args, **kwargs):
        return tensor

    try:
        for n in saved:
            setattr(nn_init, n, _noop)
        yield
    finally:
        for n, fn in saved.items():
            setattr(nn_init, n, fn)


class LoadWatchdog:
    """Monitors free RAM (and Windows commit charge) during a model load.

    If memory gets critically low it logs the situation, writes an abort
    marker (surfaced in the GUI on next start), flushes the log, and hard-
    exits the process. Killing the server instantly frees its memory — far
    better than letting Windows freeze solid in pagefile thrash.
    """

    WARN_GB = 3.0
    ABORT_GB = 1.25
    INTERVAL_S = 0.5

    def __init__(self, variant: str, phase_ref: Callable[[], str]) -> None:
        self._variant = variant
        self._phase_ref = phase_ref
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_warn = 0.0

    def __enter__(self) -> "LoadWatchdog":
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        import system_check
        from log_setup import ABORT_MARKER, flush_all

        while not self._stop.wait(self.INTERVAL_S):
            try:
                _total, avail = system_check.get_ram_gb()
                _climit, cavail = system_check.get_commit_gb()
            except Exception:
                continue
            lows = [v for v in (avail, cavail) if v is not None]
            if not lows:
                continue
            lowest = min(lows)

            if lowest < self.ABORT_GB:
                snapshot = system_check.mem_snapshot()
                phase = self._phase_ref() or "unknown phase"
                logger.critical(
                    "EMERGENCY ABORT: memory critically low while loading %s "
                    "(%s) during '%s'. Killing the server NOW to free memory "
                    "before the operating system freezes.",
                    self._variant, snapshot, phase,
                )
                try:
                    ABORT_MARKER.parent.mkdir(parents=True, exist_ok=True)
                    ABORT_MARKER.write_text(json.dumps({
                        "time": datetime.now(timezone.utc).isoformat(),
                        "variant": self._variant,
                        "phase": phase,
                        "memory": snapshot,
                    }, indent=2), encoding="utf-8")
                except Exception:
                    pass
                flush_all()
                os._exit(3)

            if lowest < self.WARN_GB and time.monotonic() - self._last_warn > 10:
                self._last_warn = time.monotonic()
                logger.warning(
                    "Memory running low while loading %s: %s",
                    self._variant, system_check.mem_snapshot(),
                )


# ── GPU lease (cross-app coordination) ───────────────────────────────────────
# While our model is resident on the GPU we hold a lease file that other local
# AI apps (the GLM legal system's local_llm.py) check before loading their own
# models. They route routine work to Claude Haiku instead of Ollama while the
# lease is held, so nobody fights over the 24 GB of VRAM. The lease includes
# our pid; a reader treats a dead-pid lease as stale, so a crash can't wedge
# the other app.

GPU_LEASE_FILE = Path(
    os.environ.get("GPU_LEASE_FILE", str(Path.home() / ".gpu-lease.json"))
)


def acquire_gpu_lease() -> None:
    try:
        GPU_LEASE_FILE.write_text(json.dumps({
            "holder": "ideogram-studio",
            "pid": os.getpid(),
            "acquired": datetime.now(timezone.utc).isoformat(),
        }, indent=2), encoding="utf-8")
        logger.info("GPU lease acquired (%s)", GPU_LEASE_FILE)
    except Exception as exc:
        logger.warning("Could not write GPU lease file: %s", exc)


def release_gpu_lease() -> None:
    try:
        lease = json.loads(GPU_LEASE_FILE.read_text(encoding="utf-8"))
        if lease.get("holder") == "ideogram-studio":
            GPU_LEASE_FILE.unlink()
            logger.info("GPU lease released")
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Could not release GPU lease file: %s", exc)


@dataclass
class GenerationSettings:
    height: int
    width: int
    sampler_preset: str        # "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"
    seed: int | None = None
    raise_on_caption_issues: bool = True
    # Custom CFG curve (a "CFG override" in ComfyUI terms). When `cfg` is None
    # the preset's frozen guidance_schedule is used unchanged. When set, a
    # high→low per-step curve is built: `cfg` for the first `cfg_override_start`
    # fraction of steps, then `cfg_override` for the remaining tail.
    #
    # This is the single lever the Banodoco/ComfyUI community uses for BOTH
    # quality (the official CFG of 7.0 is too high — it splotches/burns photos)
    # AND for avoiding the model's out-of-distribution "safety collapse". A
    # typical setting is cfg≈3.5 dropping to ≈2.0 for the last 30% of steps
    # (cfg_override_start=0.7). Replaces the older boolean "soft guidance".
    cfg: float | None = None
    cfg_override: float | None = None       # tail CFG; defaults to `cfg` if None
    cfg_override_start: float | None = None  # fraction 0–1; defaults to 0.7


def _build_guidance_schedule(
    num_steps: int, *, forward: bool, cfg: float, cfg_override: float, override_start: float,
) -> list[float]:
    """Build a high→low per-step CFG curve: `cfg` for the first `override_start`
    fraction of steps, `cfg_override` for the remaining tail. `forward` True =
    diffusers order (index 0 = first step); False = ideogram4-package order
    (index 0 = last step). override_start=1.0 → constant `cfg` (no drop).
    Always returns exactly `num_steps` values."""
    start = min(max(override_start, 0.0), 1.0)
    n_high = max(1, min(num_steps, round(num_steps * start)))
    n_low = num_steps - n_high
    fwd = [float(cfg)] * n_high + [float(cfg_override)] * n_low   # first high, last low
    return fwd if forward else fwd[::-1]


def _resolve_guidance_schedule(
    preset_schedule, num_steps: int, settings: "GenerationSettings", *, forward: bool,
) -> list[float]:
    """Return the user's custom CFG curve when they set one, else the preset's
    frozen schedule. Centralises the preset-vs-custom decision so generate() and
    inpaint() in every pipeline behave identically."""
    if settings.cfg is None:
        return list(preset_schedule)
    start = settings.cfg_override_start if settings.cfg_override_start is not None else 0.7
    override = settings.cfg_override if settings.cfg_override is not None else settings.cfg
    return _build_guidance_schedule(
        num_steps, forward=forward,
        cfg=settings.cfg, cfg_override=override, override_start=start,
    )


def is_safety_collapse(
    image: "Image.Image", *,
    sat_thresh: float = 0.06, var_thresh: float = 120.0, edge_thresh: float = 6.0,
    lum_lo: float = 80.0, lum_hi: float = 190.0,
) -> bool:
    """Best-effort detection of Ideogram 4's gray "safety filter" card.

    The card is a near-uniform, near-grayscale, MID-gray, low-detail frame (the
    model collapsing out-of-distribution — not real moderation). This is
    intentionally CONSERVATIVE: it requires the frame to be near-grayscale AND
    nearly flat AND nearly edge-free AND sitting in a mid-gray luminance band, so
    a legitimate textured or colourful image is never flagged. The luminance band
    excludes the most likely false positives — legitimately flat images that are
    DARK (night scenes) or BRIGHT (snow, fog, blown highlights) — which pass the
    saturation/variance/edge tests but are not the gray card. It can still flag a
    deliberately solid mid-gray image — hence the feature that uses it (auto
    seed-retry) is OFF by default. Returns False on any error (fail-open: never
    blocks a result because detection failed).

    Thresholds are tunable against real captured gray-card outputs.
    """
    try:
        import numpy as np
        sm = image.convert("RGB").resize((64, 64))
        arr = np.asarray(sm, dtype=np.float32)
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        mx = np.maximum(np.maximum(r, g), b)
        mn = np.minimum(np.minimum(r, g), b)
        saturation = float(np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0).mean())
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        mean_lum = float(lum.mean())
        variance = float(lum.var())
        edge = float(np.abs(np.diff(lum, axis=1)).mean() + np.abs(np.diff(lum, axis=0)).mean())
        return (
            lum_lo <= mean_lum <= lum_hi
            and saturation < sat_thresh
            and variance < var_thresh
            and edge < edge_thresh
        )
    except Exception:
        return False


class InferencePipeline(ABC):
    # Whether this pipeline can load LoRA adapters. Only the diffusers-based
    # pipelines (bf16, nf4d) carry PeftAdapterMixin on their transformer; the
    # custom ideogram4 package paths (fp8, nf4) have no adapter hooks at all.
    supports_lora: bool = False
    # Whether this pipeline can do masked inpainting (region fill). Same split:
    # only the diffusers pipelines expose the latent callback + VAE we need.
    supports_inpaint: bool = False

    @abstractmethod
    def load(self) -> None:
        """Load weights into VRAM. Blocking. ~20-40s on first call."""

    @abstractmethod
    def generate(
        self,
        prompt_json: str,
        settings: GenerationSettings,
        step_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[Image.Image, int]:
        """
        Run inference. Returns (image, actual_seed).
        step_callback(step_index, total_steps) called each step where supported.
        """

    @abstractmethod
    def unload(self) -> None:
        """Release GPU memory."""

    # ── LoRA adapters (overridden by LoRA-capable pipelines) ───────────────

    def load_lora(self, source: str, adapter_name: str, weight: float) -> None:
        raise RuntimeError("This model variant does not support LoRA adapters.")

    def remove_lora(self, adapter_name: str) -> None:
        raise RuntimeError("This model variant does not support LoRA adapters.")

    def set_lora_weight(self, adapter_name: str, weight: float) -> None:
        raise RuntimeError("This model variant does not support LoRA adapters.")

    def active_loras(self) -> list[dict]:
        """[{name, weight, source}] for currently applied adapters."""
        return []

    def inpaint(
        self,
        image: "Image.Image",
        mask: "Image.Image",
        prompt_json: str,
        settings: GenerationSettings,
        strength: float = 0.75,
        step_callback: Callable[[int, int], None] | None = None,
        budget: int | None = None,
    ) -> tuple["Image.Image", int]:
        raise RuntimeError(
            "This model variant can't do AI region fill. Switch to NF4·D or BF16 and reload."
        )

    @staticmethod
    def _resolve_seed(seed: int | None) -> int:
        return seed if seed is not None else random.randint(0, 2 ** 32 - 1)


# ── fp8 pipeline ─────────────────────────────────────────────────────────────

class FP8Pipeline(InferencePipeline):
    """
    Uses the official ideogram-oss/ideogram4 package.
    fp8 weights from ideogram-ai/ideogram-4-fp8 (gated). Per the official
    guidance, fp8 is sized for A100/H100-class GPUs (~30 GB+ VRAM) — use nf4
    on 24 GB consumer cards.

    Step-by-step callbacks are NOT available with this pipeline — the progress
    indicator on the frontend will show an indeterminate spinner for fp8.
    """

    REPO = "ideogram-ai/ideogram-4-fp8"
    DTYPE_HINT = "fp8"
    GUIDANCE_FORWARD = False   # ideogram4 package order: index 0 = LAST step

    # PRESETS in reverse loop order (index 0 = LAST step) — matches ideogram4 package.
    #
    # `mu` here is the schedule's BASE mean (known_mean), not the final mean. The
    # pipeline applies a resolution shift internally:
    #   mean = mu + 0.5 * log(H*W / (512*512))   (ideogram4/scheduler.get_schedule_for_resolution)
    # so larger / extreme-aspect renders get the right schedule automatically. We
    # pass the fixed preset base value on purpose — do NOT pre-adjust mu for
    # resolution here. (Verified against the installed package source.)
    PRESETS: dict = {
        "V4_QUALITY_48": {
            "num_steps": 48,
            "guidance_schedule": (3.0,) * 3 + (7.0,) * 45,
            "mu": 0.0,
            "std": 1.5,
        },
        "V4_DEFAULT_20": {
            "num_steps": 20,
            "guidance_schedule": (3.0,) * 2 + (7.0,) * 18,
            "mu": 0.0,
            "std": 1.75,
        },
        "V4_TURBO_12": {
            "num_steps": 12,
            "guidance_schedule": (3.0,) * 1 + (7.0,) * 11,
            "mu": 0.5,
            "std": 1.75,
        },
    }

    def __init__(self) -> None:
        self._pipe = None

    def load(self) -> None:
        import torch
        from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig

        if hf_token := os.environ.get("HF_TOKEN"):
            os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", hf_token)

        config = Ideogram4PipelineConfig(weights_repo=self.REPO)
        # _no_random_init: see its docstring — prevents the CPU-RAM explosion
        # in ideogram4's skeleton construction that can freeze the machine.
        with _no_random_init():
            self._pipe = Ideogram4Pipeline.from_pretrained(
                config=config,
                device="cuda",
                dtype=torch.bfloat16,
            )

    def generate(
        self,
        prompt_json: str,
        settings: GenerationSettings,
        step_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[Image.Image, int]:
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded. Call load() first.")

        preset = self.PRESETS[settings.sampler_preset]
        actual_seed = self._resolve_seed(settings.seed)
        schedule = _resolve_guidance_schedule(
            preset["guidance_schedule"], preset["num_steps"], settings,
            forward=self.GUIDANCE_FORWARD,
        )

        images: list[Image.Image] = self._pipe(
            prompts=prompt_json,
            height=settings.height,
            width=settings.width,
            num_steps=preset["num_steps"],
            guidance_schedule=schedule,
            mu=preset["mu"],
            std=preset["std"],
            seed=actual_seed,
            raise_on_caption_issues=settings.raise_on_caption_issues,
        )
        return images[0], actual_seed

    def unload(self) -> None:
        if self._pipe is not None:
            import torch
            del self._pipe
            self._pipe = None
            torch.cuda.empty_cache()


# ── nf4 pipeline ──────────────────────────────────────────────────────────────

class NF4Pipeline(FP8Pipeline):
    """
    NF4-quantized variant of the ideogram4 package pipeline.
    Weights from ideogram-ai/ideogram-4-nf4 — the official variant for single
    24 GB consumer GPUs (RTX 3090/4090). Uses bitsandbytes 4-bit NormalFloat.
    """

    REPO = "ideogram-ai/ideogram-4-nf4"
    DTYPE_HINT = "nf4"

    def load(self) -> None:
        import torch
        from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig

        if hf_token := os.environ.get("HF_TOKEN"):
            os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", hf_token)

        config = Ideogram4PipelineConfig(weights_repo=self.REPO)
        with _no_random_init():
            self._pipe = Ideogram4Pipeline.from_pretrained(
                config=config,
                device="cuda",
                dtype=torch.bfloat16,
            )


# ── bf16 pipeline ─────────────────────────────────────────────────────────────

class BF16Pipeline(InferencePipeline):
    """
    Uses huggingface/diffusers Ideogram4Pipeline with bf16 community weights.
    Supports step-by-step progress callbacks via callback_on_step_end.
    ~22 GB VRAM required.

    guidance_schedule is in FORWARD order (index 0 = first step) as required
    by diffusers Ideogram4Pipeline — opposite of the ideogram4 package presets.

    Supports LoRA: the diffusers transformer carries PeftAdapterMixin, so
    community adapters (e.g. from Civitai) load via load_lora_adapter. We
    keep adapters UNFUSED — fuse_lora is unsupported on 4-bit-quantized
    bases (nf4d) and unnecessary for inference.
    """

    supports_lora = True
    supports_inpaint = True

    REPO = "CalamitousFelicitousness/Ideogram-4-bf16-Diffusers"
    GUIDANCE_FORWARD = True    # diffusers order: index 0 = FIRST step

    # Forward-order presets for diffusers (verified against diffusers default:
    #   guidance_schedule=(7.0,)*45 + (3.0,)*3  — 45 high-guidance first, 3 polish last)
    PRESETS: dict = {
        "V4_QUALITY_48": {
            "num_inference_steps": 48,
            "guidance_schedule": list((7.0,) * 45 + (3.0,) * 3),
            "mu": 0.0,
            "std": 1.5,
        },
        "V4_DEFAULT_20": {
            "num_inference_steps": 20,
            "guidance_schedule": list((7.0,) * 18 + (3.0,) * 2),
            "mu": 0.0,
            "std": 1.75,
        },
        "V4_TURBO_12": {
            "num_inference_steps": 12,
            "guidance_schedule": list((7.0,) * 11 + (3.0,) * 1),
            "mu": 0.5,
            "std": 1.75,
        },
    }

    def __init__(self) -> None:
        self._pipe = None
        # adapter_name -> {"weight": float, "source": str}
        self._loras: dict[str, dict] = {}

    def load(self) -> None:
        import torch
        from diffusers import Ideogram4Pipeline as DiffusersPipeline

        kwargs: dict = {"torch_dtype": torch.bfloat16}
        if hf_token := os.environ.get("HF_TOKEN"):
            kwargs["token"] = hf_token

        pipe = DiffusersPipeline.from_pretrained(self.REPO, **kwargs)
        try:
            pipe.to("cuda")
        except ValueError as exc:
            # bnb-quantized components are placed on the GPU by their
            # quantization config and refuse a blanket .to() — that's fine.
            if "quantiz" not in str(exc).lower() and "bitsandbytes" not in str(exc).lower():
                raise
            logger.info("Pipeline declined .to('cuda') (quantized components already placed): %s", exc)
        self._pipe = pipe

    def generate(
        self,
        prompt_json: str,
        settings: GenerationSettings,
        step_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[Image.Image, int]:
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded. Call load() first.")

        import torch

        preset = self.PRESETS[settings.sampler_preset]
        actual_seed = self._resolve_seed(settings.seed)
        generator = torch.Generator("cuda").manual_seed(actual_seed)
        schedule = _resolve_guidance_schedule(
            preset["guidance_schedule"], preset["num_inference_steps"], settings,
            forward=self.GUIDANCE_FORWARD,
        )

        def _on_step(pipe, step_i: int, timestep: int, kwargs: dict) -> dict:
            if step_callback:
                step_callback(step_i, preset["num_inference_steps"])
            return {}

        # Default to the ComfyUI Ideogram4 workflow's sampler: res_multistep +
        # ExtendIntermediateSigmas, used TOGETHER (res_multistep alone makes sparse
        # prompts collapse to the "image blocked" card — EIS steadies the start).
        # EIS adds a step, so the sigma schedule AND the guidance curve are both
        # extended in lockstep to keep the per-step guidance length matched.
        import reference_edit as _ref
        from diffusers.pipelines.ideogram4 import pipeline_ideogram4 as _pi
        dev = self._pipe._execution_device
        _schedule_mu = _pi._resolution_aware_mu(height=settings.height, width=settings.width, base_mu=preset["mu"])
        _base_sigmas = _pi._logit_normal_sigmas(preset["num_inference_steps"], _schedule_mu, std=preset["std"], device=dev)
        ext_sigmas, ext_guidance = _ref.extend_sigmas_and_guidance(
            _base_sigmas, list(schedule), steps=2, start_at_sigma=1.0, end_at_sigma=0.98, spacing="linear"
        )
        num_eff = len(ext_sigmas)

        orig_scheduler = self._pipe.scheduler
        self._pipe.scheduler = _ref.ResMultistepFlowScheduler.from_config(orig_scheduler.config)
        try:
            with _ref.extended_sigma_schedule(ext_sigmas):
                result = self._pipe(
                    prompt=prompt_json,
                    height=settings.height,
                    width=settings.width,
                    num_inference_steps=num_eff,
                    guidance_scale=None,                            # mutually exclusive with guidance_schedule
                    guidance_schedule=ext_guidance,
                    mu=preset["mu"],
                    std=preset["std"],
                    prompt_upsampling=False,                        # we handle this via MagicPromptService
                    generator=generator,
                    output_type="pil",
                    return_dict=True,
                    callback_on_step_end=_on_step,
                    callback_on_step_end_tensor_inputs=["latents"],
                )
        finally:
            self._pipe.scheduler = orig_scheduler
        return result.images[0], actual_seed

    def reference_edit(
        self,
        image: Image.Image,
        mask: Image.Image | None,
        prompt_json: str,
        settings: GenerationSettings,
        lora_path: str,
        adapter_name: str = "ig4_inpaint",
        step_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[Image.Image, int]:
        """Reference-guided in-place edit via the BitPoet inpaint LoRA.

        Regenerates the image conditioned on the ORIGINAL as a reference latent
        (so it stays faithful except where the prompt/bbox asks for a change),
        then composites the result inside `mask` so everything outside the
        selection stays byte-exact. The LoRA is loaded for this call only and
        removed after, so normal generation is unaffected."""
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded.")
        if not self.supports_lora:
            raise RuntimeError("Reference edit needs a diffusers (LoRA-capable) model — switch to NF4·D or BF16.")
        import torch
        from PIL import ImageFilter
        import reference_edit as _ref
        import inpaint as _inp

        unit = self._pipe.vae_scale_factor * self._pipe.patch_size
        gen_w, gen_h = _inp.edit_resolution(image.width, image.height, unit)

        preset = self.PRESETS[settings.sampler_preset]
        num_steps = preset["num_inference_steps"]
        actual_seed = self._resolve_seed(settings.seed)
        generator = torch.Generator("cuda").manual_seed(actual_seed)
        # The BitPoet inpaint LoRA's reference workflow runs a CONSTANT low CFG
        # (~3.0), mu 0.5, std 1.75 — NOT the base 7→3 curve. High guidance pushes
        # the output off the reference (exposure drift, a visible composite seam,
        # and a weaker edit), so honour the LoRA's settings here.
        ref_cfg = float(settings.cfg) if settings.cfg is not None else 3.0
        ref_mu, ref_std = 0.5, 1.75

        # Build the EIS-extended sigma schedule the workflow uses (1 extra step at
        # the high-noise start). We precompute it so the stock pipeline runs with
        # a matching guidance length (constant CFG), no hand-rolled denoise loop.
        from diffusers.pipelines.ideogram4 import pipeline_ideogram4 as _pi
        dev = self._pipe._execution_device
        _schedule_mu = _pi._resolution_aware_mu(height=gen_h, width=gen_w, base_mu=ref_mu)
        _base_sigmas = _pi._logit_normal_sigmas(num_steps, _schedule_mu, std=ref_std, device=dev)
        ext_sigmas = _ref.extend_intermediate_sigmas(
            _base_sigmas, steps=2, start_at_sigma=1.0, end_at_sigma=0.98, spacing="linear"
        )
        num_eff = len(ext_sigmas)
        schedule = [ref_cfg] * num_eff

        loaded_here = adapter_name not in self._loras
        if loaded_here:
            self._pipe.transformer.load_lora_adapter(lora_path, adapter_name=adapter_name)
            self._loras[adapter_name] = {"weight": 1.0, "source": lora_path}
            self._apply_adapters()

        def _on_step(pipe, step_i: int, t, kwargs: dict) -> dict:
            if step_callback:
                step_callback(step_i, num_eff)
            return {}

        # Swap in the res_multistep solver (the LoRA workflow's sampler) for this
        # edit — sharper/more faithful than the base Euler at the same steps.
        orig_scheduler = self._pipe.scheduler
        self._pipe.scheduler = _ref.ResMultistepFlowScheduler.from_config(orig_scheduler.config)

        try:
            with _ref.reference_conditioning(self._pipe, image, gen_w, gen_h), \
                 _ref.extended_sigma_schedule(ext_sigmas):
                result = self._pipe(
                    prompt=prompt_json, height=gen_h, width=gen_w,
                    num_inference_steps=num_eff,
                    guidance_scale=None, guidance_schedule=schedule,
                    mu=ref_mu, std=ref_std, prompt_upsampling=False,
                    generator=generator, output_type="pil", return_dict=True,
                    callback_on_step_end=_on_step,
                    callback_on_step_end_tensor_inputs=["latents"],
                )
            out = result.images[0].resize((image.width, image.height), Image.LANCZOS)
            if mask is not None:
                # Feather generously: the reference edit re-exposes the whole frame
                # slightly, so a hard mask edge shows a seam. A soft, size-relative
                # blend hides it while keeping the far surroundings the original.
                feather = max(12, min(image.width, image.height) // 48)
                m = mask.convert("L").resize((image.width, image.height), Image.LANCZOS)
                m = m.filter(ImageFilter.GaussianBlur(feather))
                out = Image.composite(out.convert("RGB"), image.convert("RGB"), m)
            return out, actual_seed
        finally:
            self._pipe.scheduler = orig_scheduler
            if loaded_here:
                self._loras.pop(adapter_name, None)
                try:
                    self._pipe.transformer.delete_adapters([adapter_name])
                except Exception:
                    pass  # best-effort cleanup — adapter may already be gone; _apply_adapters below re-syncs
                self._apply_adapters()

    def unload(self) -> None:
        if self._pipe is not None:
            import torch
            del self._pipe
            self._pipe = None
            self._loras.clear()
            torch.cuda.empty_cache()

    # ── LoRA adapters ──────────────────────────────────────────────────────

    def load_lora(self, source: str, adapter_name: str, weight: float) -> None:
        """Load a LoRA adapter (.safetensors path or HF repo id) and apply it.

        Multiple adapters can be stacked; set_adapters re-applies the full
        weighted set each time so weights stay consistent.
        """
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded.")
        if adapter_name in self._loras:
            raise ValueError(f"A LoRA named {adapter_name!r} is already loaded.")
        # prefix="transformer" is the default; the file may or may not carry it.
        self._pipe.transformer.load_lora_adapter(source, adapter_name=adapter_name)
        self._loras[adapter_name] = {"weight": float(weight), "source": source}
        self._apply_adapters()
        logger.info("LoRA loaded: %s (weight=%.2f) from %s", adapter_name, weight, source)

    def remove_lora(self, adapter_name: str) -> None:
        if self._pipe is None or adapter_name not in self._loras:
            return
        self._loras.pop(adapter_name, None)
        self._pipe.transformer.delete_adapters([adapter_name])
        self._apply_adapters()
        logger.info("LoRA removed: %s", adapter_name)

    def set_lora_weight(self, adapter_name: str, weight: float) -> None:
        if adapter_name not in self._loras:
            raise ValueError(f"No LoRA named {adapter_name!r} is loaded.")
        self._loras[adapter_name]["weight"] = float(weight)
        self._apply_adapters()

    def _apply_adapters(self) -> None:
        names = list(self._loras.keys())
        if names:
            weights = [self._loras[n]["weight"] for n in names]
            self._pipe.transformer.set_adapters(names, weights)
        else:
            # No adapters left — fully detach so inference is clean base weights.
            self._pipe.transformer.disable_lora()

    def active_loras(self) -> list[dict]:
        return [
            {"name": n, "weight": d["weight"], "source": d["source"]}
            for n, d in self._loras.items()
        ]

    # ── Inpainting (masked region fill) ────────────────────────────────────

    def inpaint(
        self,
        image: Image.Image,
        mask: Image.Image,
        prompt_json: str,
        settings: GenerationSettings,
        strength: float = 0.75,
        step_callback: Callable[[int, int], None] | None = None,
        budget: int | None = None,
    ) -> tuple[Image.Image, int]:
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded.")
        import inpaint as _inpaint

        preset = self.PRESETS[settings.sampler_preset]
        actual_seed = self._resolve_seed(settings.seed)
        schedule = _resolve_guidance_schedule(
            preset["guidance_schedule"], preset["num_inference_steps"], settings,
            forward=self.GUIDANCE_FORWARD,
        )
        # inpaint_image decides crop-and-stitch (localized mask) vs full-image
        # (whole-image remix / extend, whose mask bbox spans the canvas).
        # `budget` is the working-resolution pixel target: a small inpaint crop
        # stays light (~1 MP default → detailed fill), but Extend passes the full
        # padded canvas so the new border is generated at native res, not a soft
        # ~1 MP downscale that the upscale-back blurs.
        extra = {"budget": budget} if budget is not None else {}
        out = _inpaint.inpaint_image(
            self._pipe, image, mask, prompt_json,
            num_steps=preset["num_inference_steps"],
            guidance_schedule=schedule,
            mu=preset["mu"], std=preset["std"],
            seed=actual_seed, strength=strength, step_callback=step_callback,
            **extra,
        )
        return out, actual_seed


# ── nf4 diffusers pipeline ────────────────────────────────────────────────────

class NF4DiffusersPipeline(BF16Pipeline):
    """
    Official ideogram-ai/ideogram-4-nf4-diffusers — the same 4-bit weights as
    nf4 but in diffusers layout (16.1 GB, fits 24 GB GPUs).

    Why it exists alongside nf4: the diffusers pipeline supports
    callback_on_step_end, so the GUI gets real step-by-step progress instead
    of an indeterminate spinner. Inherits everything from BF16Pipeline except
    the weights repo.
    """

    REPO = "ideogram-ai/ideogram-4-nf4-diffusers"


# ── GGUF Q4_K pipeline (sub-24 GB GPUs) ───────────────────────────────────────

class GGUFQ4KPipeline(BF16Pipeline):
    """
    GGUF Q4_K-quantized Ideogram 4 for GPUs below the 24 GB floor (the DiT
    transformer is ~6–7 GB in VRAM, vs ~16 GB for nf4).

    SCAFFOLD — designed here, verify + finish on the GPU box. See
    docs/BUILD_SPEC_2026-06-16.md §6.1. The novel part (loading a single .gguf
    transformer via diffusers' GGUFQuantizationConfig) is implemented; the exact
    GGUF filename and the transformer class symbol must be confirmed against the
    installed diffusers version on first run (clear errors are raised if not).

    It assembles a real diffusers Ideogram4Pipeline (GGUF transformer + the
    VAE / text-encoder / scheduler from the official nf4d diffusers repo), so it
    inherits generate() and inpaint() from BF16Pipeline unchanged. LoRA is
    disabled on a GGUF base — PEFT can't patch ggml tensors — until verified.
    """

    # GGML tensors aren't PEFT-patchable. Inpaint uses only the diffusers latent
    # callback (no adapters), so it can stay on once verified on hardware.
    supports_lora = False
    supports_inpaint = True

    # The single-file Q4_K GGUF transformer. CONFIRM the exact filename on the
    # hub before first run — repos vary (e.g. "ideogram-4-Q4_K.gguf" or
    # "ideogram-4-transformer-Q4_K.gguf"). transformerlab's repo holds only the
    # Q4_K file, so PipelineManager._download (snapshot_download) stays cheap.
    GGUF_REPO = "transformerlab/ideogram-4-gguf-q4_k"
    GGUF_FILENAME = "ideogram-4-Q4_K.gguf"
    # Non-transformer components (VAE, text encoder, tokenizer, scheduler) come
    # from the official diffusers layout.
    BASE_REPO = "ideogram-ai/ideogram-4-nf4-diffusers"
    # What PipelineManager._download fetches (small — just the gguf file). The
    # base components download lazily during load() (diffusers caches them).
    REPO = GGUF_REPO

    def load(self) -> None:
        import torch
        from huggingface_hub import hf_hub_download, list_repo_files

        try:
            from diffusers import Ideogram4Pipeline as DiffusersPipeline
            from diffusers import GGUFQuantizationConfig
        except Exception as exc:  # noqa: BLE001 — surface an actionable message
            raise RuntimeError(
                "This diffusers build doesn't expose GGUFQuantizationConfig / "
                "Ideogram4Pipeline. Upgrade diffusers "
                "(pip install -U \"git+https://github.com/huggingface/diffusers.git\"), "
                "or use the ComfyUI-GGUF loader path instead. "
                f"Original import error: {exc!r}"
            )

        token = os.environ.get("HF_TOKEN")
        # Resolve the actual .gguf file in the repo rather than trusting one
        # hardcoded name (repos vary). Listing is cheap and happens before any
        # large download, so a wrong/missing file fails fast with a clear error.
        try:
            repo_files = [f for f in list_repo_files(self.GGUF_REPO, token=token)
                          if f.lower().endswith(".gguf")]
        except Exception:
            repo_files = []
        gguf_name = self.GGUF_FILENAME  # fallback if listing fails
        if repo_files:
            q4 = [f for f in repo_files if "q4_k" in f.lower()] or \
                 [f for f in repo_files if "q4" in f.lower()]
            gguf_name = (q4 or repo_files)[0]
        gguf_path = hf_hub_download(self.GGUF_REPO, gguf_name, token=token)

        # Locate the Ideogram 4 transformer class — the symbol moved between
        # diffusers versions, so try the known locations.
        transformer_cls = None
        try:
            from diffusers import Ideogram4Transformer2DModel as transformer_cls  # type: ignore
        except Exception:
            try:
                from diffusers.models.transformers.transformer_ideogram4 import (  # type: ignore
                    Ideogram4Transformer2DModel as transformer_cls,
                )
            except Exception:
                transformer_cls = None
        if transformer_cls is None:
            raise RuntimeError(
                "Couldn't locate the Ideogram 4 transformer class in diffusers "
                "(Ideogram4Transformer2DModel). Confirm the installed diffusers "
                "version exposes it, then update GGUFQ4KPipeline.load()."
            )

        with _no_random_init():
            transformer = transformer_cls.from_single_file(
                gguf_path,
                quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
                config=self.BASE_REPO,
                subfolder="transformer",
                token=token,
            )

        # NOTE (optimization, GPU box): from_pretrained(BASE_REPO, transformer=…)
        # still downloads BASE_REPO's own transformer shards we don't use. To keep
        # disk to the gguf + (vae/text-encoder/scheduler) only, load those
        # subfolders individually and construct DiffusersPipeline(...) directly.
        kwargs: dict = {"torch_dtype": torch.bfloat16, "transformer": transformer}
        if token:
            kwargs["token"] = token
        pipe = DiffusersPipeline.from_pretrained(self.BASE_REPO, **kwargs)
        try:
            pipe.to("cuda")
        except ValueError as exc:
            if "quantiz" not in str(exc).lower() and "bitsandbytes" not in str(exc).lower():
                raise
            logger.info("GGUF pipeline declined .to('cuda') (quantized components placed): %s", exc)
        self._pipe = pipe


# ── Pipeline manager ─────────────────────────────────────────────────────────

class PipelineManager:
    """
    Singleton-style manager stored on app.state.
    Thread-safe for reads; load/unload should be called from a background thread.

    Loading happens in two phases so the GUI can show real progress and so a
    failed/oversized download never takes the machine down:
      1. "downloading" — snapshot_download() streams weights to disk only
         (resumable, no RAM spike), with percent progress.
      2. "loading"     — weights are read from the local cache into the GPU.
    """

    REPOS = {
        "fp8": FP8Pipeline.REPO,
        "nf4": NF4Pipeline.REPO,
        "nf4d": NF4DiffusersPipeline.REPO,
        "bf16": BF16Pipeline.REPO,
        # GGUF Q4_K — sub-24 GB GPUs. Scaffold; verify on hardware (§6.1).
        "gguf-q4k": GGUFQ4KPipeline.REPO,
    }

    def __init__(self) -> None:
        self._pipeline: InferencePipeline | None = None
        self._variant: str | None = None
        # "unloaded" | "downloading" | "loading" | "ready" | "error"
        self.status: str = "unloaded"
        self.error: str | None = None
        self.progress_message: str | None = None
        self.download_pct: float | None = None
        self._load_lock = threading.Lock()
        self._surface_previous_abort()

    def _surface_previous_abort(self) -> None:
        """If the last load was emergency-aborted, explain it in the GUI."""
        try:
            from log_setup import ABORT_MARKER

            if not ABORT_MARKER.exists():
                return
            info = json.loads(ABORT_MARKER.read_text(encoding="utf-8"))
            ABORT_MARKER.rename(ABORT_MARKER.with_suffix(".seen.json"))
            self.status = "error"
            self.error = (
                f"The previous {info.get('variant', '?')} model load was aborted on "
                f"{info.get('time', '?')} because system memory ran critically low "
                f"({info.get('memory', 'n/a')}) during '{info.get('phase', '?')}'. "
                "The server shut itself down to prevent your computer from freezing. "
                "Close memory-heavy apps before loading, and see logs/app.log for the full story."
            )
            logger.warning("Surfaced previous emergency abort: %s", info)
        except Exception:
            pass

    @property
    def variant(self) -> str | None:
        return self._variant

    @property
    def is_busy(self) -> bool:
        return self.status in ("downloading", "loading")

    # ── download phase ────────────────────────────────────────────────────

    def _expected_repo_size_gb(self, repo: str, fallback_gb: float) -> float:
        """Ask the Hub for the true repo size; fall back to a static estimate."""
        try:
            from huggingface_hub import HfApi

            info = HfApi().model_info(
                repo, files_metadata=True, token=os.environ.get("HF_TOKEN")
            )
            total = sum((s.size or 0) for s in (info.siblings or []))
            if total > 0:
                return total / (1024 ** 3)
        except Exception:
            pass
        return fallback_gb

    def _download(self, variant: str) -> None:
        """Download weights to the local cache (disk-only, resumable)."""
        from huggingface_hub import snapshot_download
        import system_check

        repo = self.REPOS[variant]
        if system_check.is_variant_cached(variant):
            return  # already on disk

        expected_gb = self._expected_repo_size_gb(
            repo, system_check.VARIANT_REQS[variant]["download_gb"]
        )

        stop = threading.Event()

        def _monitor() -> None:
            while not stop.wait(2.0):
                try:
                    done_gb = system_check.variant_cache_size_gb(variant)
                    pct = min(99.0, (done_gb / expected_gb) * 100.0) if expected_gb else None
                    self.download_pct = round(pct, 1) if pct is not None else None
                    self.progress_message = (
                        f"Downloading {variant} weights — {done_gb:.1f} / {expected_gb:.1f} GB"
                    )
                except Exception:
                    pass

        monitor = threading.Thread(target=_monitor, daemon=True)
        monitor.start()
        try:
            # max_workers=4: gentler on RAM/disk than the default 8 threads
            snapshot_download(
                repo_id=repo, token=os.environ.get("HF_TOKEN"), max_workers=4
            )
        finally:
            stop.set()
            monitor.join(timeout=5)
            self.download_pct = None

    @staticmethod
    def _friendly_load_error(exc: Exception, repo: str) -> str:
        text = f"{type(exc).__name__}: {exc}"
        lowered = str(exc).lower()
        if "401" in lowered or "403" in lowered or "gated" in lowered or "unauthorized" in lowered:
            return (
                f"Access to {repo} was denied. Add a valid Hugging Face token in Settings and "
                f"accept the model license at https://huggingface.co/{repo}, then try again."
            )
        if "out of memory" in lowered or "cuda" in lowered and "memory" in lowered:
            return (
                f"The GPU ran out of memory while loading {repo}. "
                "Switch to the nf4 variant (Settings → Model), which is built for 24 GB GPUs."
            )
        if "defaultcpuallocator" in lowered or "not enough memory" in lowered or "paging file" in lowered:
            return (
                "The system ran out of memory (RAM + pagefile) while loading the model. "
                "Close memory-heavy applications, then increase the Windows pagefile: "
                "Settings > System > About > Advanced system settings > Performance Settings "
                "> Advanced > Virtual memory — set a custom size of 40000 MB or more on a "
                "drive with free space, reboot, and try again. See logs/app.log for details."
            )
        if "no space left" in lowered or "disk" in lowered and "full" in lowered:
            return "The disk filled up during download. Free up space and try again — downloads resume where they left off."
        return text

    # ── public API ────────────────────────────────────────────────────────

    def load(self, variant: str) -> None:
        """Blocking — call from a thread pool, not the event loop."""
        if not self._load_lock.acquire(blocking=False):
            raise RuntimeError("A model load is already in progress")

        import system_check

        t0 = time.monotonic()
        try:
            self.error = None

            if variant not in self.REPOS:
                raise ValueError(f"Unknown variant: {variant!r}")

            logger.info("=== MODEL LOAD START: %s (%s) | %s ===",
                        variant, self.REPOS[variant], system_check.mem_snapshot())

            with LoadWatchdog(variant, lambda: self.progress_message or self.status):
                self.status = "downloading"
                self.progress_message = f"Preparing {variant} download…"
                self._download(variant)
                logger.info("Download phase done after %.1fs | %s",
                            time.monotonic() - t0, system_check.mem_snapshot())

                # Take the GPU for ourselves: lease it (GLM's local_llm sees
                # this and routes routine work to Haiku), then evict any
                # Ollama models still resident in VRAM. Ollama's server stays
                # up — only the weights are unloaded.
                acquire_gpu_lease()
                stopped = system_check.stop_ollama_models()
                if stopped:
                    logger.info("Freed VRAM from Ollama models: %s", ", ".join(stopped))
                    self.progress_message = f"Freed GPU memory from Ollama ({', '.join(stopped)})…"

                self.status = "loading"
                self.progress_message = f"Loading {variant} weights into GPU memory…"

                if self._pipeline is not None:
                    logger.info("Unloading previous pipeline (%s)", self._variant)
                    self._pipeline.unload()
                    self._pipeline = None
                    self._variant = None

                if variant == "fp8":
                    pipeline: InferencePipeline = FP8Pipeline()
                elif variant == "nf4":
                    pipeline = NF4Pipeline()
                elif variant == "nf4d":
                    pipeline = NF4DiffusersPipeline()
                elif variant == "gguf-q4k":
                    pipeline = GGUFQ4KPipeline()
                else:
                    pipeline = BF16Pipeline()

                logger.info("Building pipeline (this is the memory-heavy phase) | %s",
                            system_check.mem_snapshot())
                pipeline.load()
                logger.info("Pipeline built | %s", system_check.mem_snapshot())

            self._pipeline = pipeline
            self._variant = variant
            self.status = "ready"
            logger.info("=== MODEL LOAD OK: %s in %.1fs | %s ===",
                        variant, time.monotonic() - t0, system_check.mem_snapshot())
        except Exception as exc:
            logger.exception("=== MODEL LOAD FAILED: %s after %.1fs | %s ===",
                             variant, time.monotonic() - t0, system_check.mem_snapshot())
            self.status = "error"
            self.error = self._friendly_load_error(exc, self.REPOS.get(variant, variant))
            release_gpu_lease()   # failed load holds no VRAM — let others have the GPU
        finally:
            self.progress_message = None
            self.download_pct = None
            self._load_lock.release()

    def unload(self) -> None:
        """Release the loaded pipeline. No-op if nothing is loaded."""
        if self.is_busy:
            raise RuntimeError("Cannot unload while a model load is in progress")
        if self._pipeline is not None:
            self._pipeline.unload()
            self._pipeline = None
        self._variant = None
        self.status = "unloaded"
        self.error = None
        release_gpu_lease()

    def generate(
        self,
        prompt_json: str,
        settings: GenerationSettings,
        step_callback: Callable[[int, int], None] | None = None,
    ) -> tuple[Image.Image, int]:
        if self._pipeline is None or self.status != "ready":
            raise RuntimeError("No pipeline loaded. Load a model first.")
        return self._pipeline.generate(prompt_json, settings, step_callback)

    def vram_used_mb(self) -> int | None:
        try:
            import torch
            if torch.cuda.is_available():
                return torch.cuda.memory_allocated() // (1024 * 1024)
        except Exception:
            pass  # torch not available or CUDA not accessible — return None gracefully
        return None

    # ── LoRA passthrough ──────────────────────────────────────────────────
    # Callers MUST run these on the single-worker inference executor so they
    # serialize with generate() — mutating the transformer mid-generation
    # would corrupt a run.

    @property
    def supports_lora(self) -> bool:
        return bool(self._pipeline is not None and self._pipeline.supports_lora)

    @property
    def supports_inpaint(self) -> bool:
        return bool(self._pipeline is not None and self._pipeline.supports_inpaint)

    def inpaint(self, image, mask, prompt_json, settings, strength=0.75, step_callback=None, budget=None):
        if self._pipeline is None or self.status != "ready":
            raise RuntimeError("No pipeline loaded. Load a model first.")
        return self._pipeline.inpaint(image, mask, prompt_json, settings, strength, step_callback, budget)

    def reference_edit(self, image, mask, prompt_json, settings, lora_path, step_callback=None):
        if self._pipeline is None or self.status != "ready":
            raise RuntimeError("No pipeline loaded. Load a model first.")
        if not hasattr(self._pipeline, "reference_edit"):
            raise RuntimeError(f"The {self._variant} variant can't do reference edits — switch to NF4·D or BF16.")
        return self._pipeline.reference_edit(image, mask, prompt_json, settings, lora_path, step_callback=step_callback)

    def _require_lora_pipeline(self) -> InferencePipeline:
        if self._pipeline is None or self.status != "ready":
            raise RuntimeError("Load a model before using LoRA adapters.")
        if not self._pipeline.supports_lora:
            raise RuntimeError(
                f"The {self._variant} variant cannot load LoRA adapters. "
                "Switch to NF4·D or BF16 (diffusers) and reload."
            )
        return self._pipeline

    def load_lora(self, source: str, adapter_name: str, weight: float) -> None:
        self._require_lora_pipeline().load_lora(source, adapter_name, weight)

    def remove_lora(self, adapter_name: str) -> None:
        self._require_lora_pipeline().remove_lora(adapter_name)

    def set_lora_weight(self, adapter_name: str, weight: float) -> None:
        self._require_lora_pipeline().set_lora_weight(adapter_name, weight)

    def active_loras(self) -> list[dict]:
        if self._pipeline is None or not self._pipeline.supports_lora:
            return []
        return self._pipeline.active_loras()
