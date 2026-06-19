from __future__ import annotations
import re
from typing import Literal
from pydantic import BaseModel, SecretStr, field_validator, model_validator

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

# ── Shared CFG (guidance) controls ────────────────────────────────────────────
# A custom CFG curve / "CFG override". When `cfg` is None the model uses the
# sampler preset's built-in guidance schedule. When set, the backend builds a
# high→low per-step curve: `cfg` for the first `cfg_override_start` fraction of
# steps, then `cfg_override` for the tail. Community-recommended for quality and
# to avoid the model's out-of-distribution refusal collapse (e.g. cfg 3.5 →
# 2.0 for the last 30%, i.e. cfg_override_start 0.7). Shared by generate + edit.

# Shared CFG bounds. Keep in sync with the frontend (CFG_MIN/CFG_MAX in
# settingsStore.ts) and the CfgControl sliders. Floor is 1.0, not 0.0: cfg=0
# would build an all-zero guidance schedule that disables guidance entirely and
# ignores the prompt.
CFG_MIN, CFG_MAX = 1.0, 10.0


def _clamp_cfg(v: float | None) -> float | None:
    return None if v is None else max(CFG_MIN, min(CFG_MAX, float(v)))


def _clamp_fraction(v: float | None) -> float | None:
    return None if v is None else max(0.0, min(1.0, float(v)))


class CfgControlsMixin(BaseModel):
    cfg: float | None = None
    cfg_override: float | None = None
    cfg_override_start: float | None = None
    # Quality / sampler controls (recommended defaults; user-overridable).
    sampler: Literal["res_multistep", "euler"] = "res_multistep"
    detail: bool = True   # ExtendIntermediateSigmas (paired with res_multistep)
    # Advanced (ComfyUI-style) overrides — None = use the preset / defaults.
    steps: int | None = None
    mu: float | None = None
    std: float | None = None
    eis_steps: int | None = None
    eis_start_sigma: float | None = None
    eis_end_sigma: float | None = None

    @field_validator("steps")
    @classmethod
    def _clamp_steps(cls, v: int | None) -> int | None:
        return None if v is None else max(4, min(60, int(v)))

    @field_validator("std")
    @classmethod
    def _clamp_std(cls, v: float | None) -> float | None:
        return None if v is None else max(0.5, min(4.0, float(v)))

    @field_validator("mu")
    @classmethod
    def _clamp_mu(cls, v: float | None) -> float | None:
        return None if v is None else max(-2.0, min(2.0, float(v)))

    @field_validator("eis_steps")
    @classmethod
    def _clamp_eis_steps(cls, v: int | None) -> int | None:
        return None if v is None else max(1, min(8, int(v)))

    @field_validator("eis_start_sigma", "eis_end_sigma")
    @classmethod
    def _clamp_eis_sigma(cls, v: float | None) -> float | None:
        return None if v is None else max(0.0, min(1.0, float(v)))

    @field_validator("cfg", "cfg_override")
    @classmethod
    def _validate_cfg(cls, v: float | None) -> float | None:
        return _clamp_cfg(v)

    @field_validator("cfg_override_start")
    @classmethod
    def _validate_cfg_start(cls, v: float | None) -> float | None:
        return _clamp_fraction(v)


# ── Resolution limits (docs/inference.md) ────────────────────────────────────
# Keep in sync with the frontend (RES_MIN/RES_MAX/MAX_ASPECT_RATIO in caption.ts).
RES_MIN, RES_MAX, RES_STEP = 256, 2048, 16
# Ideogram 4 supports aspect ratios up to 6:1 (or 1:6); beyond that it samples
# out of its trained distribution. RES_MIN * MAX_ASPECT_RATIO = 1536 ≤ RES_MAX,
# so a valid in-range pair always exists after clamping.
MAX_ASPECT_RATIO = 6.0


def _snap_to_step(v: int) -> int:
    return max(RES_MIN, min(RES_MAX, round(v / RES_STEP) * RES_STEP))


class GenerationRequest(CfgControlsMixin):
    prompt_json: str
    height: int
    width: int
    sampler_preset: Literal["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"] = "V4_DEFAULT_20"
    seed: int | None = None
    model_variant: Literal["fp8", "nf4", "nf4d", "bf16", "gguf-q4k"] = "nf4"

    @field_validator("height", "width")
    @classmethod
    def must_be_multiple_of_16(cls, v: int) -> int:
        if v % 16 != 0:
            raise ValueError(f"Must be a multiple of 16, got {v}")
        return max(RES_MIN, min(RES_MAX, v))

    @model_validator(mode="after")
    def enforce_aspect_ratio(self) -> "GenerationRequest":
        """Defense-in-depth: keep width:height within ±6:1 even if a client
        bypasses the UI. Consistent with the silent 256–2048 clamp above, the
        LONGER side is pulled in (snapped to 16) rather than raising — the short
        side is authoritative, so requested detail in the dominant axis is kept.
        """
        if self.height <= 0 or self.width <= 0:
            return self
        if max(self.width / self.height, self.height / self.width) <= MAX_ASPECT_RATIO:
            return self
        if self.width >= self.height:
            self.width = min(self.width, _snap_to_step(int(self.height * MAX_ASPECT_RATIO)))
        else:
            self.height = min(self.height, _snap_to_step(int(self.width * MAX_ASPECT_RATIO)))
        return self


# ── Magic Prompt ─────────────────────────────────────────────────────────────

class MagicPromptRequest(BaseModel):
    text: str
    width: int = 1024
    height: int = 1024
    # The user's current Style fields. Fed into the expansion so Magic Prompt
    # respects the chosen medium/look instead of inventing its own.
    style: StyleDescriptionModel | None = None


class MagicPromptResponse(BaseModel):
    caption_json: str
    warnings: list[str] = []


# ── Describe (image → prompt) ────────────────────────────────────────────────

class DescribeImageRequest(BaseModel):
    image_b64: str                     # base64 image, no data: prefix

    @field_validator("image_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v


class DescribeImageResponse(BaseModel):
    prompt: str


# ── AI Style Fuse ────────────────────────────────────────────────────────────

class FuseStyleIn(BaseModel):
    """One side of a fusion: a style preset's label + caption fields."""
    label: str
    mode: Literal["photo", "illustration"]
    aesthetics: str = ""
    lighting: str = ""
    medium: str = ""
    photo: str = ""
    art_style: str = ""


class StyleFuseRequest(BaseModel):
    form: FuseStyleIn   # contributes technique/medium
    mood: FuseStyleIn   # contributes atmosphere/feel


class StyleFuseResponse(BaseModel):
    mode: Literal["photo", "illustration"]
    aesthetics: str
    lighting: str
    medium: str
    photo: str = ""
    art_style: str = ""


# ── Enhance element descriptions (keep layout) ───────────────────────────────

class EnhanceElementIn(BaseModel):
    type: Literal["obj", "text"] = "obj"
    text: str | None = None
    desc: str = ""


class EnhanceElementsRequest(BaseModel):
    high_level_description: str = ""
    elements: list[EnhanceElementIn]

    @field_validator("elements")
    @classmethod
    def not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("no elements to enhance")
        if len(v) > 30:
            raise ValueError("too many elements (max 30)")
        return v


class EnhanceElementsResponse(BaseModel):
    descs: list[str]   # one enriched description per element, in order


# ── Split into layers ────────────────────────────────────────────────────────

class LayerElementIn(BaseModel):
    type: Literal["obj", "text"] = "obj"
    text: str | None = None
    desc: str = ""
    bbox: list[int] | None = None   # [ymin, xmin, ymax, xmax], 0–1000


class LayersRequest(BaseModel):
    image_b64: str                  # the image to split (base64 PNG, no prefix)
    elements: list[LayerElementIn] = []
    source_job_id: str | None = None

    @field_validator("image_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v


class LayerInfo(BaseModel):
    name: str
    kind: str          # "background" | "foreground" | "obj" | "text"
    image_url: str


class LayersResponse(BaseModel):
    layers: list[LayerInfo]
    zip_url: str


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

    @field_validator("model_name")
    @classmethod
    def model_name_safe(cls, v: str) -> str:
        # Used to build an output filename — block anything but a plain label so
        # it can never become a path traversal (no "/", "\\", or separators).
        if not re.match(r"^[A-Za-z0-9._-]+$", v):
            raise ValueError("model_name may only contain letters, digits, '.', '_', '-'")
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
    supports_inpaint: bool = False   # AI region fill (diffusers pipelines only)


class ModelLoadRequest(BaseModel):
    variant: Literal["fp8", "nf4", "nf4d", "bf16", "gguf-q4k"]
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


class InpaintRequest(CfgControlsMixin):
    """AI region fill: regenerate the masked area of an image from a prompt."""
    image_b64: str                     # current canvas, base64 PNG (no prefix)
    mask_b64: str                      # base64 PNG; white/opaque = regenerate
    prompt: str
    sampler_preset: Literal["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"] = "V4_DEFAULT_20"
    seed: int | None = None
    source_job_id: str | None = None   # for gallery lineage (optional)
    # How much the selection may change (img2img strength). Low = gentle edit
    # that keeps the original structure; 1 = full regeneration.
    strength: float = 0.75
    # Ground the edit caption in the actual source image (describe it, so the
    # fill matches the real lighting/palette/style). Default on — this is what
    # makes a region blend with the larger image (report §6.2/§6.6).
    ground: bool = True
    # Run the edit instruction through Magic Prompt (LLM rewrite). Default OFF,
    # per Ideogram's own guidance for Magic Fill ("recommended not to use Magic
    # Prompt, as it might alter your optimized prompt"). When off, a grounded
    # JSON caption is built deterministically (the json_prompt path).
    magic_prompt: bool = False

    @field_validator("strength")
    @classmethod
    def _clamp_strength(cls, v: float) -> float:
        return max(0.1, min(1.0, v))

    @field_validator("image_b64", "mask_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v

    @field_validator("prompt")
    @classmethod
    def prompt_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("prompt is required")
        return v.strip()


class ExtendRequest(CfgControlsMixin):
    """Outpaint / reframe: grow the canvas and fill the new area by continuing
    the scene. The new area is specified by per-side pixel pads (so the canvas
    can grow asymmetrically — e.g. only the bottom). `target_ratio` is the
    legacy centred fallback used when all pads are 0."""
    image_b64: str
    target_ratio: Literal["16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "1:1"] = "16:9"
    # Per-side amounts (px) to add. The original keeps its pixels; only these
    # margins are generated. All-zero → fall back to centred `target_ratio`.
    pad_top: int = 0
    pad_right: int = 0
    pad_bottom: int = 0
    pad_left: int = 0
    prompt: str = ""                   # optional; blank = "continue the scene"
    seed: int | None = None
    source_job_id: str | None = None
    sampler_preset: Literal["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"] = "V4_DEFAULT_20"
    # How freely the new border is generated (outpaint wants this high).
    strength: float = 0.95
    # Ground the continuation in the source image so the new area matches it.
    ground: bool = True

    @field_validator("strength")
    @classmethod
    def _clamp_strength(cls, v: float) -> float:
        return max(0.1, min(1.0, v))

    @field_validator("pad_top", "pad_right", "pad_bottom", "pad_left")
    @classmethod
    def _clamp_pad(cls, v: int) -> int:
        # Cap a single side's growth so the canvas can't explode (attention is
        # O(tokens²)); 0..4096 px is plenty for any reframe.
        return max(0, min(4096, int(v)))

    @field_validator("image_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v


class EditResponse(BaseModel):
    job_id: str
    image_url: str
    width: int
    height: int
    # Populated by the diffusion edit paths (inpaint / remix / extend) so the UI
    # can show the real seed + timing instead of fabricated values. None for
    # non-diffusion edits (save flatten, import).
    seed: int | None = None
    duration_ms: int | None = None
    # Whether the edit caption was actually grounded in the source image
    # (describe_image ran). False = grounding was requested but skipped (no
    # OpenRouter key) or failed; None = not requested. Lets the UI tell the user
    # instead of silently claiming grounding that didn't happen.
    grounded: bool | None = None


class PreviewCaptionRequest(BaseModel):
    """Build (without generating) the exact JSON caption an edit would send, so
    the UI can show — and let the user hand-edit — it before running. Mirrors the
    edit endpoints' caption path (optionally describe-grounded + Magic Prompt)."""
    image_b64: str                     # source image, base64 PNG (no prefix) — for grounding
    prompt: str
    width: int = 1024
    height: int = 1024
    preserve: bool = True              # blend with surroundings (region edits)
    element_bbox: list[int] | None = None   # [ymin,xmin,ymax,xmax] 0–1000, anchors the subject
    ground: bool = True                # describe the source image to ground the caption
    magic_prompt: bool = False         # run the instruction through Magic Prompt

    @field_validator("image_b64")
    @classmethod
    def _img_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v


class PreviewCaptionResponse(BaseModel):
    caption: str                       # the minified JSON caption that would be sent
    grounded: bool | None = None       # whether describe-grounding actually ran


class ImportImageRequest(BaseModel):
    """A user-supplied image to bring into the gallery for editing."""
    image_b64: str                     # base64-encoded image, no data: prefix
    filename: str | None = None        # display label only — never used as a path

    @field_validator("image_b64")
    @classmethod
    def image_must_be_reasonable(cls, v: str) -> str:
        if len(v) > 96_000_000:
            raise ValueError("image too large")
        return v

    @field_validator("filename")
    @classmethod
    def filename_is_label_only(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.replace("\\", "/").split("/")[-1][:120]


# ── Logs ─────────────────────────────────────────────────────────────────────

class LogsResponse(BaseModel):
    lines: list[str]
    path: str


# ── Settings ─────────────────────────────────────────────────────────────────

class SettingsResponse(BaseModel):
    model_variant: str
    magic_prompt_backend: str
    openrouter_model: str = "google/gemma-4-31b-it:free"
    openrouter_free_only: bool = True
    has_ideogram_api_key: bool
    has_openrouter_api_key: bool
    has_hf_token: bool
    auto_structure_prompt: bool = False
    auto_retry_on_collapse: bool = False
    safety_moderation_enabled: bool = False
    has_hive_text_key: bool = False
    has_hive_visual_key: bool = False


class SettingsUpdateRequest(BaseModel):
    model_variant: str | None = None
    magic_prompt_backend: str | None = None
    openrouter_model: str | None = None
    openrouter_free_only: bool | None = None
    ideogram_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    hf_token: SecretStr | None = None
    auto_structure_prompt: bool | None = None
    auto_retry_on_collapse: bool | None = None
    safety_moderation_enabled: bool | None = None
    hive_text_key: SecretStr | None = None
    hive_visual_key: SecretStr | None = None


# ── LoRA adapters ────────────────────────────────────────────────────────────

class LoraInfo(BaseModel):
    name: str
    weight: float
    source: str
    triggers: list[str] = []   # activation words pulled from the LoRA's metadata


class LoraListResponse(BaseModel):
    supported: bool          # current pipeline can load LoRA (nf4d / bf16)
    variant: str | None      # the loaded variant, for the UI's explanation
    available: list[str]     # *.safetensors filenames found in loras/
    loaded: list[LoraInfo]   # currently applied adapters
    loras_dir: str


class LoraApplyRequest(BaseModel):
    filename: str | None = None   # a file inside loras/ (no path separators)
    hf_repo: str | None = None    # or a Hugging Face repo id
    weight: float = 1.0

    @field_validator("weight")
    @classmethod
    def _clamp_weight(cls, v: float) -> float:
        return max(0.0, min(2.0, v))

    @field_validator("filename")
    @classmethod
    def _safe_filename(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if "/" in v or "\\" in v or ".." in v:
            raise ValueError("filename must not contain path separators")
        return v


class LoraWeightRequest(BaseModel):
    name: str
    weight: float

    @field_validator("weight")
    @classmethod
    def _clamp_weight(cls, v: float) -> float:
        return max(0.0, min(2.0, v))


class LoraRemoveRequest(BaseModel):
    name: str
