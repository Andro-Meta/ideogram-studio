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

import logging
import os
import random
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable

from PIL import Image

logger = logging.getLogger(__name__)


@dataclass
class GenerationSettings:
    height: int
    width: int
    sampler_preset: str        # "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48"
    seed: int | None = None
    raise_on_caption_issues: bool = True


class InferencePipeline(ABC):
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

    # PRESETS in reverse loop order (index 0 = LAST step) — matches ideogram4 package
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

        images: list[Image.Image] = self._pipe(
            prompts=prompt_json,
            height=settings.height,
            width=settings.width,
            num_steps=preset["num_steps"],
            guidance_schedule=preset["guidance_schedule"],
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
    """

    REPO = "CalamitousFelicitousness/Ideogram-4-bf16-Diffusers"

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

    def load(self) -> None:
        import torch
        from diffusers import Ideogram4Pipeline as DiffusersPipeline

        kwargs: dict = {"torch_dtype": torch.bfloat16}
        if hf_token := os.environ.get("HF_TOKEN"):
            kwargs["token"] = hf_token

        self._pipe = DiffusersPipeline.from_pretrained(self.REPO, **kwargs).to("cuda")

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

        def _on_step(pipe, step_i: int, timestep: int, kwargs: dict) -> dict:
            if step_callback:
                step_callback(step_i, preset["num_inference_steps"])
            return {}

        result = self._pipe(
            prompt=prompt_json,
            height=settings.height,
            width=settings.width,
            num_inference_steps=preset["num_inference_steps"],
            guidance_scale=None,                            # mutually exclusive with guidance_schedule
            guidance_schedule=preset["guidance_schedule"],
            mu=preset["mu"],
            std=preset["std"],
            prompt_upsampling=False,                        # we handle this via MagicPromptService
            generator=generator,
            output_type="pil",
            return_dict=True,
            callback_on_step_end=_on_step,
            callback_on_step_end_tensor_inputs=["latents"],
        )
        return result.images[0], actual_seed

    def unload(self) -> None:
        if self._pipe is not None:
            import torch
            del self._pipe
            self._pipe = None
            torch.cuda.empty_cache()


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
        "bf16": BF16Pipeline.REPO,
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
            snapshot_download(repo_id=repo, token=os.environ.get("HF_TOKEN"))
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
        if "no space left" in lowered or "disk" in lowered and "full" in lowered:
            return "The disk filled up during download. Free up space and try again — downloads resume where they left off."
        return text

    # ── public API ────────────────────────────────────────────────────────

    def load(self, variant: str) -> None:
        """Blocking — call from a thread pool, not the event loop."""
        if not self._load_lock.acquire(blocking=False):
            raise RuntimeError("A model load is already in progress")
        try:
            self.error = None

            if variant not in self.REPOS:
                raise ValueError(f"Unknown variant: {variant!r}")

            self.status = "downloading"
            self.progress_message = f"Preparing {variant} download…"
            self._download(variant)

            self.status = "loading"
            self.progress_message = f"Loading {variant} weights into GPU memory…"

            if self._pipeline is not None:
                self._pipeline.unload()
                self._pipeline = None
                self._variant = None

            if variant == "fp8":
                pipeline: InferencePipeline = FP8Pipeline()
            elif variant == "nf4":
                pipeline = NF4Pipeline()
            else:
                pipeline = BF16Pipeline()

            pipeline.load()
            self._pipeline = pipeline
            self._variant = variant
            self.status = "ready"
        except Exception as exc:
            logger.exception("Model load failed")
            self.status = "error"
            self.error = self._friendly_load_error(exc, self.REPOS.get(variant, variant))
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
