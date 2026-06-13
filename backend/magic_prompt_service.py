"""
Magic Prompt service — thin async wrapper around ideogram4.magic_prompt.

The expand() call is synchronous and potentially slow (~1-5s), so it is
always dispatched to a thread pool via asyncio.run_in_executor.
"""
from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor

_executor = ThreadPoolExecutor(max_workers=2)


# Older Settings builds saved these values; map them to the package's keys.
_BACKEND_ALIASES = {
    "claude-sonnet": "claude-sonnet-v1",
    "claude-opus": "claude-opus-v1",
}

FREE_DEFAULT_MODEL = "google/gemma-4-31b-it:free"

# Reliable, free, good-at-JSON models to fall back across when a free provider
# is busy (free endpoints return "Provider returned error" under load).
FREE_FALLBACK_MODELS = [
    "google/gemma-4-31b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openai/gpt-oss-120b:free",
]

# Backends that call PAID models regardless of openrouter_model.
PAID_BACKENDS = {"claude-sonnet-v1", "claude-opus-v1"}

# Free, image-capable models for image → prompt (describe). Capped at 3 for
# the OpenRouter fallback array; gemma is most descriptive, nemotron-vl most
# reliable under load.
FREE_VISION_MODELS = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
]

_DESCRIBE_INSTRUCTION = (
    "Look at this image and write a single, vivid text-to-image prompt that "
    "would recreate it. One paragraph, no preamble or quotes. Cover the main "
    "subject(s), the setting/background, the medium and art style (e.g. "
    "photograph, oil painting, 3D render), the lighting, the colour palette, "
    "and the overall mood. Be concrete and specific; do not mention that it is "
    "an image or describe it in the third person."
)


def describe_image(image_b64: str, api_key: str | None, *, attempts: int = 3) -> str:
    """Image (base64 PNG/JPEG, no data: prefix) → a text-to-image prompt, via a
    free OpenRouter vision model with auto-fallback.

    Free endpoints are flaky: they time out or return "Provider returned error"
    under load. Each call already lets OpenRouter fall back across all three free
    vision models server-side; on top of that we retry the whole call a few times
    so a single transient hiccup doesn't kill "Generate from image". Raises only
    if every attempt fails."""
    from ideogram4.magic_prompt import openrouter_chat
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": _DESCRIBE_INSTRUCTION},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
        ],
    }]
    errors: list[str] = []
    for i in range(max(1, attempts)):
        try:
            out = openrouter_chat(
                FREE_VISION_MODELS[0], messages, api_key,
                temperature=0.7, max_tokens=420, timeout=45.0,
                extra_body={"models": FREE_VISION_MODELS},
            ).strip()
            if out:
                return out
            errors.append(f"attempt {i + 1}: empty response")
        except Exception as exc:  # noqa: BLE001 — surface a combined message below
            errors.append(f"attempt {i + 1}: {type(exc).__name__}: {exc}")
    raise RuntimeError(
        "The free vision model kept failing (it's busy or timing out). "
        "Try again in a moment. Details: " + " | ".join(errors[-attempts:])
    )


def coerce_free_model(model: str, free_only: bool) -> str:
    """Under free-only, never let a paid model id through — fall back to the
    free default. A no-op when free_only is off or the model is already free."""
    if free_only and not (model or "").endswith(":free"):
        return FREE_DEFAULT_MODEL
    return model


def openrouter_models_param(model: str) -> list[str] | None:
    """For a ":free" model, return [model, ...other frees] so OpenRouter
    auto-falls-back when the primary free provider is overloaded. Paid models
    don't need this (returns None)."""
    if not model.endswith(":free"):
        return None
    # OpenRouter caps the fallback array at 3 entries.
    return ([model] + [m for m in FREE_FALLBACK_MODELS if m != model])[:3]


class OpenRouterMagicPromptV1:
    """
    Magic prompt v1 on any OpenRouter model (default: Gemini Flash Lite).

    Same pattern as the package's Claude classes — ships the v1 system
    prompt via openrouter_chat — but with a configurable model slug, so a
    fast cheap model can run it. Note the v1 prompt design puts style
    inside the caption prose; no backend returns style_description.
    """

    def __init__(self, api_key: str | None, model: str, *,
                 timeout: float = 120.0, strip_bboxes: bool = False,
                 free_only: bool = True):
        self.api_key = api_key
        # Coerce to free at construction so a paid id can never reach OpenRouter.
        self.model = coerce_free_model(model, free_only)
        self.timeout = timeout
        self.strip_bboxes = strip_bboxes

    def expand(self, prompt: str, aspect_ratio: str = "1:1") -> str:
        from ideogram4.magic_prompt import (
            build_messages, openrouter_chat, strip_aspect_ratio_and_bboxes,
        )
        messages = build_messages("v1.txt", prompt, aspect_ratio)
        fallbacks = openrouter_models_param(self.model)
        caption = openrouter_chat(
            self.model, messages, self.api_key,
            temperature=1.0, timeout=self.timeout,
            extra_body={"models": fallbacks} if fallbacks else None,
        )
        return strip_aspect_ratio_and_bboxes(caption, strip_bboxes=self.strip_bboxes)


def _make_backend(backend_name: str, api_key: str | None, openrouter_model: str,
                  free_only: bool = True):
    """Import and instantiate the correct magic-prompt backend."""
    backend_name = _BACKEND_ALIASES.get(backend_name, backend_name)

    # Free-only safeguard: a paid Claude backend would spend credits, so route
    # it to the free OpenRouter backend instead. Nothing paid gets constructed.
    if free_only and backend_name in PAID_BACKENDS:
        return OpenRouterMagicPromptV1(api_key, FREE_DEFAULT_MODEL,
                                       strip_bboxes=False, free_only=True)

    # Ideogram4MagicPromptV1 is NOT exported from ideogram4.__init__
    # — must import from the submodule directly.
    if backend_name == "ideogram-4-v1":
        from ideogram4.magic_prompt import Ideogram4MagicPromptV1
        return Ideogram4MagicPromptV1(api_key=api_key, strip_bboxes=False)

    if backend_name == "openrouter-v1":
        return OpenRouterMagicPromptV1(api_key, openrouter_model,
                                       strip_bboxes=False, free_only=free_only)

    from ideogram4 import MAGIC_PROMPTS
    cls = MAGIC_PROMPTS.get(backend_name)
    if cls is None:
        raise ValueError(f"Unknown magic-prompt backend: {backend_name!r}")
    return cls(api_key=api_key, strip_bboxes=False)


class MagicPromptService:
    def __init__(self, backend_name: str, api_key: str | None = None,
                 openrouter_model: str = FREE_DEFAULT_MODEL,
                 free_only: bool = True):
        self._openrouter_model = openrouter_model
        self._free_only = free_only
        self._backend = _make_backend(backend_name, api_key, openrouter_model, free_only)

    async def expand(self, text: str, width: int, height: int, *, attempts: int = 2) -> str:
        """
        Convert plain text to a minified JSON caption string.
        Runs synchronous backend in a thread pool.

        Both the hosted Ideogram API and the free OpenRouter models occasionally
        return a transient 429/5xx or time out; retry a couple of times before
        giving up so one hiccup doesn't fail the whole request.
        """
        from ideogram4.magic_prompt import aspect_ratio_from_size
        aspect_ratio = aspect_ratio_from_size(width, height)

        loop = asyncio.get_running_loop()
        last_exc: Exception | None = None
        for _ in range(max(1, attempts)):
            try:
                return await loop.run_in_executor(
                    _executor,
                    lambda: self._backend.expand(text, aspect_ratio=aspect_ratio),
                )
            except Exception as exc:  # noqa: BLE001 — retried; re-raised below
                last_exc = exc
        raise last_exc if last_exc else RuntimeError("magic-prompt expand failed")

    def rebuild(self, backend_name: str, api_key: str | None) -> None:
        """Hot-swap the backend without restarting (e.g. after settings change)."""
        self._backend = _make_backend(
            backend_name, api_key, self._openrouter_model, self._free_only)
