"""
Enhance element descriptions while preserving the layout.

A community-requested workflow (Banodoco #ideogram): lay out the composition
with simple element descriptions + bounding boxes, then have an LLM expand each
description into vivid detail *without touching the boxes*. We guarantee the
boxes survive structurally — the model returns ONLY a list of enriched
descriptions (one per element, in order); the caller splices them back into the
existing elements, so bbox / type / text can't be altered.

Same dual backend as style_fuse: OpenRouter free model, else the local claude CLI.
"""
from __future__ import annotations

import json
import shutil
import subprocess

from style_fuse import _strip_fences  # reuse the code-fence stripper

ENHANCE_SYSTEM_PROMPT = """\
You enrich element descriptions for the Ideogram text-to-image model. You are \
given an overall scene and a numbered list of elements; each has a type \
("obj" or "text"), optional rendered text, and a short current description.

For EACH element, rewrite its description into 30-60 words of vivid, concrete \
visual detail — materials, colour, texture, lighting, pose, condition — that \
stays consistent with the overall scene and the element's type and text. Keep \
the same subject; do not invent a different object. Be specific and physical, \
not flowery.

Respond with ONLY a minified JSON array of strings — no markdown, no commentary \
— exactly one enriched description per input element, in the SAME ORDER and the \
SAME COUNT. Output descriptions only: never bounding boxes, types, or text."""


def build_user_prompt(high_level: str, elements: list[dict]) -> str:
    lines = [f"OVERALL SCENE: {high_level or '(unspecified)'}", "", "ELEMENTS:"]
    for i, el in enumerate(elements):
        t = el.get("type", "obj")
        text = el.get("text") or ""
        desc = el.get("desc") or ""
        label = f'{i + 1}. [{t}]'
        if t == "text" and text:
            label += f' renders the text "{text}"'
        lines.append(f"{label}: {desc or '(no description yet)'}")
    lines.append("")
    lines.append(f"Return a JSON array of exactly {len(elements)} enriched descriptions.")
    return "\n".join(lines)


def _parse_descs(raw: str, n: int) -> list[str]:
    data = json.loads(_strip_fences(raw))
    if not isinstance(data, list):
        raise ValueError("enhance reply is not a JSON array")
    descs = [str(d).strip() for d in data]
    if len(descs) != n:
        raise ValueError(f"expected {n} descriptions, got {len(descs)}")
    if any(not d for d in descs):
        raise ValueError("enhance reply contained an empty description")
    return descs


def enhance_backend_available(openrouter_key: str | None) -> str | None:
    if openrouter_key:
        return "openrouter"
    if shutil.which("claude"):
        return "claude-cli"
    return None


def _via_openrouter(user_prompt: str, api_key: str, model: str) -> str:
    from ideogram4.magic_prompt import openrouter_chat
    from magic_prompt_service import openrouter_models_param
    messages = [
        {"role": "system", "content": ENHANCE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    fallbacks = openrouter_models_param(model)
    return openrouter_chat(
        model, messages, api_key,
        temperature=0.8, max_tokens=2048, timeout=90.0,
        extra_body={"models": fallbacks} if fallbacks else None,
    )


def _via_claude_cli(user_prompt: str) -> str:
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("claude CLI not found on PATH")
    prompt = f"{ENHANCE_SYSTEM_PROMPT}\n\n{user_prompt}"
    proc = subprocess.run(
        [exe, "-p", "--model", "haiku"],
        input=prompt, capture_output=True, text=True, timeout=120, encoding="utf-8",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude CLI failed (rc={proc.returncode}): {proc.stderr[:200]}")
    return proc.stdout


def enhance_elements(
    high_level: str, elements: list[dict], openrouter_key: str | None,
    model: str = "google/gemma-4-31b-it:free", free_only: bool = True,
) -> list[str]:
    """Return an enriched description for each element, in order. Raises on failure."""
    if not elements:
        return []
    from magic_prompt_service import coerce_free_model
    model = coerce_free_model(model, free_only)

    user_prompt = build_user_prompt(high_level, elements)
    backend = enhance_backend_available(openrouter_key)
    if backend == "openrouter":
        raw = _via_openrouter(user_prompt, openrouter_key, model)  # type: ignore[arg-type]
    elif backend == "claude-cli":
        raw = _via_claude_cli(user_prompt)
    else:
        raise RuntimeError("no enhance backend available")
    return _parse_descs(raw, len(elements))
