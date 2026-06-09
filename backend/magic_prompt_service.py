"""
Magic Prompt service — thin async wrapper around ideogram4.magic_prompt.

The expand() call is synchronous and potentially slow (~1-5s), so it is
always dispatched to a thread pool via asyncio.run_in_executor.
"""
from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor

_executor = ThreadPoolExecutor(max_workers=2)


def _make_backend(backend_name: str, api_key: str | None):
    """Import and instantiate the correct magic-prompt backend."""
    # Ideogram4MagicPromptV1 is NOT exported from ideogram4.__init__
    # — must import from the submodule directly.
    if backend_name == "ideogram-4-v1":
        from ideogram4.magic_prompt import Ideogram4MagicPromptV1
        return Ideogram4MagicPromptV1(api_key=api_key, strip_bboxes=False)

    from ideogram4 import MAGIC_PROMPTS
    cls = MAGIC_PROMPTS.get(backend_name)
    if cls is None:
        raise ValueError(f"Unknown magic-prompt backend: {backend_name!r}")
    return cls(api_key=api_key, strip_bboxes=False)


class MagicPromptService:
    def __init__(self, backend_name: str, api_key: str | None = None):
        self._backend = _make_backend(backend_name, api_key)

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
        self._backend = _make_backend(backend_name, api_key)
