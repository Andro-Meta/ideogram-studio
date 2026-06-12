"""
AI style fusion — turns two style presets into one LLM-invented hybrid.

The hosted Ideogram magic-prompt API can't do this: it returns only
compositional captions and never emits style_description (verified
empirically), so fusion talks to a chat LLM directly:

  1. OpenRouter (anthropic/claude-sonnet-4.6) when OPENROUTER_API_KEY is set.
  2. The local ``claude`` CLI (Claude Code subscription auth) otherwise.

Both produce the same strict JSON shape, so AI Fuse works with no API key
at all on machines that have Claude Code installed.
"""
from __future__ import annotations

import json
import shutil
import subprocess

FUSE_SYSTEM_PROMPT = """\
You are a visual style designer for a text-to-image model. Given two named \
art styles, invent ONE coherent hybrid style that fuses them: take the \
physical technique and medium primarily from STYLE A (the form), and the \
atmosphere, themes, and lighting primarily from STYLE B (the mood). The \
result must read as a single unified style an artist could actually \
execute — never a split-screen, collage, or "half one, half the other".

Respond with ONLY a minified JSON object — no markdown fences, no \
commentary — with exactly these keys:
- "mode": "photo" or "illustration", matching STYLE A's medium
- "aesthetics": comma-separated look/feel/theme descriptors (8-20 words)
- "lighting": lighting description (5-15 words)
- "medium": the physical medium (2-8 words)
- exactly one of "photo" (camera/lens/film language, when mode is "photo") \
or "art_style" (movement/technique language, when mode is "illustration"), \
4-15 words

Every field should show the fusion — do not copy either input verbatim."""


def _style_block(name: str, p: dict) -> str:
    return json.dumps({
        "name": p.get("label", name),
        "mode": p.get("mode", ""),
        "medium": p.get("medium", ""),
        "technique": p.get("photo") if p.get("mode") == "photo" else p.get("art_style"),
        "aesthetics": p.get("aesthetics", ""),
        "lighting": p.get("lighting", ""),
    }, ensure_ascii=False)


def build_fuse_user_prompt(form: dict, mood: dict) -> str:
    return (
        f"STYLE A (form/technique): {_style_block('Style A', form)}\n"
        f"STYLE B (mood/atmosphere): {_style_block('Style B', mood)}"
    )


def fuse_backend_available(openrouter_key: str | None) -> str | None:
    """Which fusion backend can run right now: 'openrouter', 'claude-cli', or None."""
    if openrouter_key:
        return "openrouter"
    if shutil.which("claude"):
        return "claude-cli"
    return None


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _parse_fused(raw: str) -> dict:
    """Validate the LLM reply into clean style fields. Raises ValueError."""
    data = json.loads(_strip_fences(raw))
    if not isinstance(data, dict):
        raise ValueError("fusion reply is not a JSON object")

    mode = data.get("mode")
    if mode not in ("photo", "illustration"):
        # Derive from which technique key the model chose
        mode = "photo" if data.get("photo") else "illustration"

    fused = {
        "mode": mode,
        "aesthetics": str(data.get("aesthetics", "")).strip(),
        "lighting": str(data.get("lighting", "")).strip(),
        "medium": str(data.get("medium", "")).strip(),
        "photo": str(data.get("photo", "") or "").strip() if mode == "photo" else "",
        "art_style": str(data.get("art_style", "") or "").strip() if mode == "illustration" else "",
    }
    if not (fused["aesthetics"] and fused["medium"]):
        raise ValueError("fusion reply missing aesthetics/medium")
    return fused


def _fuse_via_openrouter(form: dict, mood: dict, api_key: str, model: str) -> str:
    from ideogram4.magic_prompt import openrouter_chat
    from magic_prompt_service import openrouter_models_param
    messages = [
        {"role": "system", "content": FUSE_SYSTEM_PROMPT},
        {"role": "user", "content": build_fuse_user_prompt(form, mood)},
    ]
    fallbacks = openrouter_models_param(model)
    return openrouter_chat(
        model, messages, api_key,
        temperature=1.0, max_tokens=1024, timeout=60.0,
        extra_body={"models": fallbacks} if fallbacks else None,
    )


def _fuse_via_claude_cli(form: dict, mood: dict) -> str:
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("claude CLI not found on PATH")
    prompt = f"{FUSE_SYSTEM_PROMPT}\n\n{build_fuse_user_prompt(form, mood)}"
    # Prompt goes via stdin: the npm claude.CMD shim mangles argv args that
    # contain newlines or quotes (everything after the first \n is lost).
    proc = subprocess.run(
        [exe, "-p", "--model", "haiku"],
        input=prompt,
        capture_output=True, text=True, timeout=90,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude CLI failed (rc={proc.returncode}): {proc.stderr[:200]}")
    return proc.stdout


def fuse_styles(
    form: dict, mood: dict, openrouter_key: str | None,
    model: str = "google/gemini-2.5-flash-lite",
) -> dict:
    """
    Synchronous fusion (call via asyncio.to_thread). Returns clean style
    fields {mode, aesthetics, lighting, medium, photo, art_style}.
    Raises RuntimeError/ValueError on failure.
    """
    backend = fuse_backend_available(openrouter_key)
    if backend == "openrouter":
        raw = _fuse_via_openrouter(form, mood, openrouter_key, model)  # type: ignore[arg-type]
    elif backend == "claude-cli":
        raw = _fuse_via_claude_cli(form, mood)
    else:
        raise RuntimeError("no fusion backend available")
    return _parse_fused(raw)
