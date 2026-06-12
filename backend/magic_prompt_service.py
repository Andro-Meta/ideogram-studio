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


class OpenRouterMagicPromptV1:
    """
    Magic prompt v1 on any OpenRouter model (default: Gemini Flash Lite).

    Same pattern as the package's Claude classes — ships the v1 system
    prompt via openrouter_chat — but with a configurable model slug, so a
    fast cheap model can run it. Note the v1 prompt design puts style
    inside the caption prose; no backend returns style_description.
    """

    def __init__(self, api_key: str | None, model: str, *,
                 timeout: float = 120.0, strip_bboxes: bool = False):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.strip_bboxes = strip_bboxes

    def expand(self, prompt: str, aspect_ratio: str = "1:1") -> str:
        from ideogram4.magic_prompt import (
            build_messages, openrouter_chat, strip_aspect_ratio_and_bboxes,
        )
        messages = build_messages("v1.txt", prompt, aspect_ratio)
        caption = openrouter_chat(
            self.model, messages, self.api_key,
            temperature=1.0, timeout=self.timeout,
        )
        return strip_aspect_ratio_and_bboxes(caption, strip_bboxes=self.strip_bboxes)


def _make_backend(backend_name: str, api_key: str | None, openrouter_model: str):
    """Import and instantiate the correct magic-prompt backend."""
    backend_name = _BACKEND_ALIASES.get(backend_name, backend_name)

    # Ideogram4MagicPromptV1 is NOT exported from ideogram4.__init__
    # — must import from the submodule directly.
    if backend_name == "ideogram-4-v1":
        from ideogram4.magic_prompt import Ideogram4MagicPromptV1
        return Ideogram4MagicPromptV1(api_key=api_key, strip_bboxes=False)

    if backend_name == "openrouter-v1":
        return OpenRouterMagicPromptV1(api_key, openrouter_model, strip_bboxes=False)

    from ideogram4 import MAGIC_PROMPTS
    cls = MAGIC_PROMPTS.get(backend_name)
    if cls is None:
        raise ValueError(f"Unknown magic-prompt backend: {backend_name!r}")
    return cls(api_key=api_key, strip_bboxes=False)


class MagicPromptService:
    def __init__(self, backend_name: str, api_key: str | None = None,
                 openrouter_model: str = "google/gemini-2.5-flash-lite"):
        self._openrouter_model = openrouter_model
        self._backend = _make_backend(backend_name, api_key, openrouter_model)

    async def expand(self, text: str, width: int, height: int) -> str:
        """
        Convert plain text to a minified JSON caption string.
        Runs synchronous backend in a thread pool.
        """
        from ideogram4.magic_prompt import aspect_ratio_from_size
        aspect_ratio = aspect_ratio_from_size(width, height)

        loop = asyncio.get_running_loop()
        result: str = await loop.run_in_executor(
            _executor,
            lambda: self._backend.expand(text, aspect_ratio=aspect_ratio),
        )
        return result

    def rebuild(self, backend_name: str, api_key: str | None) -> None:
        """Hot-swap the backend without restarting (e.g. after settings change)."""
        self._backend = _make_backend(backend_name, api_key, self._openrouter_model)
