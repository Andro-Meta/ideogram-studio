"""
Artifact-suppression / quality constraints (backend mirror).

Ideogram 4 has NO negative-prompt field — the model uses an unconditional
*model*, not a text negative (see docs/AUDIT_2026-06-14.md, technique T11). The
community-proven substitute is to state the desired quality as a POSITIVE
constraint that names the artifact to avoid ("sharp focus, no motion blur").

This is the backend mirror of frontend/src/lib/constraintPresets.ts. The web UI
injects the clause client-side at caption-build time; this module exists so the
headless CLI (and any future server-side caption path) can apply the exact same
clause. Keep the snippets in sync with the frontend file.
"""
from __future__ import annotations
import json

CONSTRAINT_CATEGORIES: dict[str, str] = {
    "sharpness":   "sharp focus, crisp fine detail, no motion blur",
    "noise":       "clean signal, no grain, no sensor noise",
    "compression": "high fidelity, no compression artifacts, no jpeg blocking",
    "color":       "accurate natural color, no chromatic aberration, no color banding",
    "anatomy":     "correct anatomy, well-formed hands, natural proportions",
}

DEFAULT_CONSTRAINT_IDS = ["sharpness", "noise", "compression", "color"]


def build_constraint_clause(ids: list[str] | None = None, custom: str = "") -> str:
    """Comma-separated positive-constraint clause from category ids + free text."""
    ids = DEFAULT_CONSTRAINT_IDS if ids is None else ids
    parts = [CONSTRAINT_CATEGORIES[i] for i in ids if i in CONSTRAINT_CATEGORIES]
    extra = (custom or "").strip()
    if extra:
        parts.append(extra)
    return ", ".join(parts)


def apply_constraints_to_caption(caption_json: str, clause: str) -> str:
    """Inject `clause` into a minified Ideogram caption JSON string.

    The clause is appended to `high_level_description` under a clear "Rendering
    quality:" lead-in (matching the frontend builder). Idempotent-ish: a second
    apply with the same clause is a no-op. Returns the input unchanged if it
    isn't valid caption JSON or the clause is empty.
    """
    clause = (clause or "").strip()
    if not clause:
        return caption_json
    try:
        data = json.loads(caption_json)
    except (ValueError, TypeError):
        return caption_json
    if not isinstance(data, dict):
        return caption_json

    lead = "Rendering quality: "
    suffix = f"{lead}{clause}."
    hld = str(data.get("high_level_description", "")).strip()
    if suffix in hld:
        return caption_json  # already applied
    data["high_level_description"] = f"{hld}. {suffix}" if hld else suffix

    # Re-serialize in the model's minified form (matches caption.py).
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)
