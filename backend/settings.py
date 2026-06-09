from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"
DIST_DIR = BASE_DIR / "frontend" / "dist"
DB_PATH = BASE_DIR / "app.db"


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Model
    model_variant: str = "fp8"          # "fp8" | "nf4" | "bf16"
    hf_token: str | None = None

    # Magic Prompt
    magic_prompt_backend: str = "ideogram-4-v1"
    ideogram_api_key: str | None = None
    openrouter_api_key: str | None = None


settings = AppSettings()
