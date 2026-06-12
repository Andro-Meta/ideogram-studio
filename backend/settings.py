import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"
DIST_DIR = BASE_DIR / "frontend" / "dist"
DB_PATH = BASE_DIR / "app.db"
MODELS_DIR = BASE_DIR / "models"
# User drops downloaded LoRA adapters (.safetensors) here; the app scans it.
LORAS_DIR = BASE_DIR / "loras"

# Keep multi-gigabyte model downloads on the same drive as the app instead of
# the default C:\Users\<user>\.cache. Filling the Windows system drive can
# freeze or crash the whole machine. setdefault() respects a user-set HF_HOME.
# NOTE: must be set before huggingface_hub is imported anywhere (main.py also
# sets this at the very top of the module for that reason).
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Model — nf4 is the variant Ideogram recommends for single consumer GPUs
    # (RTX 3090/4090, 24 GB). fp8 targets A100/H100-class hardware.
    model_variant: str = "nf4"          # "fp8" | "nf4" | "bf16"
    hf_token: str | None = None

    # Magic Prompt
    magic_prompt_backend: str = "ideogram-4-v1"
    ideogram_api_key: str | None = None
    openrouter_api_key: str | None = None
    # Model used for OpenRouter-backed features (openrouter-v1 magic prompt,
    # AI style fuse). Default is a FREE model ($0); when a ":free" model is
    # chosen the app sends a fallback chain so a busy free provider auto-falls
    # back instead of failing. Swap to a paid model (e.g.
    # google/gemini-2.5-flash-lite) for maximum reliability/no daily caps.
    openrouter_model: str = "google/gemma-4-31b-it:free"
    # Hard safeguard: when on (default), the app refuses to send any PAID model
    # to OpenRouter — paid model ids are coerced to the free default and the
    # paid Claude backends are routed to free OpenRouter. So purchased credits
    # are never spent. Turn off only if you deliberately want to use paid models.
    openrouter_free_only: bool = True

    # Auto-structure: before each generation, expand a sparse prompt into a
    # full structured-JSON scene via the magic-prompt backend. Ideogram 4
    # produces its gray "safety filter" refusal far less often on richly
    # structured JSON than on sparse prompts (a documented community finding),
    # so this both improves quality and cuts false refusals. Opt-in.
    auto_structure_prompt: bool = False

    # Optional content moderation via Hive (https://thehive.ai). This is the
    # ONLY filter in the stack — there is no local/weight toggle. When OFF
    # (default), prompts and images are never screened. When ON *and* a key
    # is set, each generation is screened and blocked on a positive hit.
    safety_moderation_enabled: bool = False
    hive_text_key: str | None = None
    hive_visual_key: str | None = None

    @field_validator("model_variant", "magic_prompt_backend", "openrouter_model", mode="before")
    @classmethod
    def _blank_falls_back_to_default(cls, v, info):
        """.env lines like 'MODEL_VARIANT=' yield empty strings — treat as unset."""
        if isinstance(v, str) and not v.strip():
            return cls.model_fields[info.field_name].default
        return v

    @field_validator("model_variant")
    @classmethod
    def _valid_variant(cls, v: str) -> str:
        if v not in ("fp8", "nf4", "nf4d", "bf16"):
            return "nf4"
        return v

    @field_validator(
        "hf_token", "ideogram_api_key", "openrouter_api_key",
        "hive_text_key", "hive_visual_key", mode="before",
    )
    @classmethod
    def _blank_secret_is_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v


settings = AppSettings()
