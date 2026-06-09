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

import os
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable

from PIL import Image


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
    Supports fp8 weights from ideogram-ai/ideogram-4-fp8 (gated, ~13 GB VRAM).

    Step-by-step callbacks are NOT available with this pipeline — the progress
    indicator on the frontend will show an indeterminate spinner for fp8.
    """

    REPO = "ideogram-ai/ideogram-4-fp8"

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
    """

    def __init__(self) -> None:
        self._pipeline: InferencePipeline | None = None
        self._variant: str | None = None
        self.status: str = "unloaded"   # "unloaded" | "loading" | "ready" | "error"
        self.error: str | None = None

    @property
    def variant(self) -> str | None:
        return self._variant

    def load(self, variant: str) -> None:
        """Blocking — call from a thread pool, not the event loop."""
        self.status = "loading"
        self.error = None
        try:
            if self._pipeline is not None:
                self._pipeline.unload()

            if variant == "fp8":
                pipeline: InferencePipeline = FP8Pipeline()
            elif variant == "bf16":
                pipeline = BF16Pipeline()
            else:
                raise ValueError(f"Unknown variant: {variant!r}")

            pipeline.load()
            self._pipeline = pipeline
            self._variant = variant
            self.status = "ready"
        except Exception as exc:
            self.status = "error"
            self.error = str(exc)
            raise

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
