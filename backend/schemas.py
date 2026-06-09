from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, field_validator


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
    model_variant: Literal["fp8", "nf4", "bf16"] = "fp8"

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


class GalleryListResponse(BaseModel):
    items: list[GalleryItem]
    total: int


# ── Upscaling ────────────────────────────────────────────────────────────────

class UpscaleRequest(BaseModel):
    job_id: str
    model_name: str = "AuraSR-v2"


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
    status: Literal["unloaded", "loading", "ready", "error"]
    variant: str | None
    vram_used_mb: int | None
    error: str | None = None


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
    ideogram_api_key: str | None = None
    openrouter_api_key: str | None = None
    hf_token: str | None = None
