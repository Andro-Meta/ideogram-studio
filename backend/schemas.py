from __future__ import annotations
import re
from typing import Literal
from pydantic import BaseModel, SecretStr, field_validator

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I
)


# ── Caption / Prompt ─────────────────────────────────────────────────────────

class BBoxModel(BaseModel):
    ymin: int
    xmin: int
    ymax: int
    xmax: int

    @field_validator("ymin", "xmin", "ymax", "xmax")
    @classmethod
    def clamp(cls, v: int) -> int:
        return max(0, min(1000, v))


class ElementModel(BaseModel):
    id: str                           # client UUID, stripped before sending to pipeline
    type: Literal["obj", "text"]
    bbox: BBoxModel | None = None
    text: str | None = None           # "text" type only
    desc: str = ""
    color_palette: list[str] = []


class StyleDescriptionModel(BaseModel):
    mode: Literal["photo", "illustration"] = "photo"
    aesthetics: str = ""
    lighting: str = ""
    medium: str = ""
    photo: str | None = None          # photo mode only
    art_style: str | None = None      # illustration mode only
    color_palette: list[str] = []


class PromptStateModel(BaseModel):
    high_level_description: str = ""
    style_description: StyleDescriptionModel = StyleDescriptionModel()
    background: str = ""
    elements: list[ElementModel] = []


# ── Generation ───────────────────────────────────────────────────────────────

class GenerationRequest(BaseModel):
    prompt_json: str
    height: int
    width: int
    sampler_preset: Literal["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"] = "V4_DEFAULT_20"
    seed: int | None = None
    model_variant: Literal["fp8", "nf4", "nf4d", "bf16"] = "nf4"

    @field_validator("height", "width")
    @classmethod
    def must_be_multiple_of_16(cls, v: int) -> int:
        if v % 16 != 0:
            raise ValueError(f"Must be a multiple of 16, got {v}")
        return max(256, min(2048, v))


# ── Magic Prompt ─────────────────────────────────────────────────────────────

class MagicPromptRequest(BaseModel):
    text: str
    width: int = 1024
    height: int = 1024


class MagicPromptResponse(BaseModel):
    caption_json: str
    warnings: list[str] = []


# ── Gallery ──────────────────────────────────────────────────────────────────

class GalleryItem(BaseModel):
    id: str
    status: str
    prompt_json: str | None
    prompt_text: str | None
    image_path: str | None
    seed: int | None
    width: int | None
    height: int | None
    sampler_preset: str | None
    model_variant: str | None
    duration_ms: int | None
    created_at: str
    error_message: str | None
    favorite: bool = False


class FavoriteRequest(BaseModel):
    favorite: bool


class GalleryListResponse(BaseModel):
    items: list[GalleryItem]
    total: int


# ── Upscaling ────────────────────────────────────────────────────────────────

class UpscaleRequest(BaseModel):
    job_id: str
    model_name: str = "AuraSR-v2"

    @field_validator("job_id")
    @classmethod
    def job_id_must_be_uuid(cls, v: str) -> str:
        if not _UUID_RE.match(v):
            raise ValueError("job_id must be a valid UUID")
        return v


class UpscaleResponse(BaseModel):
    image_url: str
    original_width: int
    original_height: int
    upscaled_width: int
    upscaled_height: int


class UpscaleModelInfo(BaseModel):
    name: str
    scale: int
    label: str
    description: str


# ── Model Status ─────────────────────────────────────────────────────────────

class ModelStatusResponse(BaseModel):
    status: Literal["unloaded", "downloading", "loading", "ready", "error"]
    variant: str | None
    vram_used_mb: int | None
    error: str | None = None
    progress_message: str | None = None
    download_pct: float | None = None


class ModelLoadRequest(BaseModel):
    variant: Literal["fp8", "nf4", "nf4d", "bf16"]
    force: bool = False


# ── System / hardware report ─────────────────────────────────────────────────

class VariantRequirements(BaseModel):
    download_gb: float
    vram_gb: float
    ram_gb: float
    label: str


class VariantAssessment(BaseModel):
    variant: str
    cached: bool
    blockers: list[str]
    warnings: list[str]
    requirements: VariantRequirements
    recommended: bool


class SystemInfoResponse(BaseModel):
    gpu_name: str | None
    vram_total_gb: float | None
    vram_free_gb: float | None
    gpu_processes: list[str] = []
    ram_total_gb: float | None
    ram_available_gb: float | None
    commit_limit_gb: float | None = None
    commit_available_gb: float | None = None
    disk_free_gb: float | None
    models_dir: str
    recommended_variant: str
    variants: list[VariantAssessment]


# ── Image editing ────────────────────────────────────────────────────────────

class EditSaveRequest(BaseModel):
    """A client-flattened edit result. The browser canvas is the single source
    of truth for pixels (exact WYSIWYG); the server only validates and stores."""
    source_job_id: str
    image_b64: str                     # base64-encoded PNG, no data: prefix

    @field_validator("source_job_id")
    @classmethod
    def job_id_must_be_uuid(cls, v: str) -> str:
        if not _UUID_RE.match(v):
            raise ValueError("source_job_id must be a valid UUID")
        return v

    @field_validator("image_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        # 96 MB of base64 ≈ 72 MB binary — far above any 2048×2048 PNG, low
        # enough to stop abuse of a localhost endpoint.
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v


class EditResponse(BaseModel):
    job_id: str
    image_url: str
    width: int
    height: int


# ── Logs ─────────────────────────────────────────────────────────────────────

class LogsResponse(BaseModel):
    lines: list[str]
    path: str


# ── Settings ─────────────────────────────────────────────────────────────────

class SettingsResponse(BaseModel):
    model_variant: str
    magic_prompt_backend: str
    has_ideogram_api_key: bool
    has_openrouter_api_key: bool
    has_hf_token: bool


class SettingsUpdateRequest(BaseModel):
    model_variant: str | None = None
    magic_prompt_backend: str | None = None
    ideogram_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    hf_token: SecretStr | None = None
