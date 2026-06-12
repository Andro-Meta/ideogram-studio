"""
Ideogram 4.0 Local Studio — FastAPI application.
Single process, single worker. Serves the compiled React SPA as static files.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import threading
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

# Keep model downloads on the app's drive instead of C:\Users\<user>\.cache —
# filling the Windows system drive can freeze/crash the machine. This MUST run
# before anything imports huggingface_hub (it fixes its cache path at import).
os.environ.setdefault(
    "HF_HOME", str(Path(__file__).resolve().parent.parent / "models" / "hf")
)

import aiosqlite
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import gallery as gallery_service
from caption import build_caption, parse_caption_json
from inference import GenerationSettings, PipelineManager
from magic_prompt_service import MagicPromptService
import style_fuse
from schemas import (
    EditSaveRequest,
    EditResponse,
    InpaintRequest,
    ImportImageRequest,
    GalleryItem,
    GalleryListResponse,
    GenerationRequest,
    FavoriteRequest,
    LogsResponse,
    MagicPromptRequest,
    MagicPromptResponse,
    ModelLoadRequest,
    ModelStatusResponse,
    LoraApplyRequest,
    LoraInfo,
    LoraListResponse,
    LoraRemoveRequest,
    LoraWeightRequest,
    SettingsResponse,
    SettingsUpdateRequest,
    StyleFuseRequest,
    StyleFuseResponse,
    SystemInfoResponse,
    UpscaleModelInfo,
    UpscaleRequest,
    UpscaleResponse,
)
import system_check
import log_setup
from settings import DIST_DIR, OUTPUTS_DIR, DB_PATH, LORAS_DIR, settings as app_settings

# Persistent rotating log — survives crashes; this is where post-mortems live.
log_setup.setup_logging()
logger = __import__("logging").getLogger("studio")

# ── Directories ───────────────────────────────────────────────────────────────
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Thread pool (one slot for inference, one for magic-prompt) ─────────────
_inference_executor = ThreadPoolExecutor(max_workers=1)


def _magic_prompt_key(backend_name: str) -> str | None:
    """The API key that matches the chosen backend — the hosted Ideogram
    backend needs the Ideogram key, everything else goes through OpenRouter."""
    if backend_name == "ideogram-4-v1":
        return app_settings.ideogram_api_key
    return app_settings.openrouter_api_key


# ── Optional content moderation (Hive) ────────────────────────────────────────
# The only filter in the stack. OFF by default; when ON and keyed, generation
# is screened and blocked on a hit. Both screens FAIL OPEN: if Hive errors, we
# log and allow, so a moderation outage never bricks a personal local tool.

def _moderate_prompt_sync(text: str) -> list[str]:
    if not (app_settings.safety_moderation_enabled and app_settings.hive_text_key):
        return []
    try:
        from ideogram4.safety import moderate_prompt
        return [cls for cls, _ in moderate_prompt(text, app_settings.hive_text_key)]
    except Exception as exc:
        logger.warning("Hive text moderation error (allowing generation): %s", exc)
        return []


def _moderate_image_sync(image) -> list[str]:
    if not (app_settings.safety_moderation_enabled and app_settings.hive_visual_key):
        return []
    try:
        from ideogram4.safety import moderate_image
        return [cls for cls, _ in moderate_image(image, app_settings.hive_visual_key)]
    except Exception as exc:
        logger.warning("Hive visual moderation error (allowing image): %s", exc)
        return []


# ── Auto-structure (option 2: structured-JSON prompting) ──────────────────────
# Ideogram 4 paints its gray "safety filter" refusal far less often on a richly
# structured JSON scene than on a sparse prompt. When enabled, expand a sparse
# prompt into a full compositional decomposition via the magic-prompt backend,
# preserving the user's explicit style. Opt-in, and fails open.

def compose_styled_prompt(text: str, style: dict | None) -> str:
    """Fold the user's Style fields into the magic-prompt input so the LLM
    commits to the chosen medium/look (e.g. film photography) instead of
    inventing one. Leads with medium so 'photograph vs illustration' is set."""
    text = (text or "").strip()
    if not style:
        return text
    bits: list[str] = []
    medium = (style.get("medium") or "").strip()
    if medium:
        bits.append(medium)
    if style.get("mode", "photo") == "photo":
        photo = (style.get("photo") or "").strip()
        if photo:
            bits.append(photo)
    else:
        art = (style.get("art_style") or "").strip()
        if art:
            bits.append(art)
    for key in ("aesthetics", "lighting"):
        val = (style.get(key) or "").strip()
        if val:
            bits.append(val)
    if not bits:
        return text
    directive = ", ".join(bits)
    return f"{text}. Render as: {directive}." if text else directive


async def _maybe_autostructure(prompt_json: str, width: int, height: int, mp) -> tuple[str, str | None]:
    if not app_settings.auto_structure_prompt or mp is None:
        return prompt_json, None
    try:
        data = json.loads(prompt_json)
    except Exception:
        return prompt_json, None

    comp = data.get("compositional_deconstruction") or {}
    elements = comp.get("elements") or []
    bg = (comp.get("background") or "").strip()
    hld = (data.get("high_level_description") or "").strip()
    # Only enrich genuinely sparse prompts — respect a user who built elements.
    is_sparse = not elements and (not bg or bg == "A neutral background.")
    if not is_sparse or not hld:
        return prompt_json, None

    try:
        # Feed the user's style into the expansion so the enriched scene
        # matches their chosen medium/look rather than inventing one.
        styled = compose_styled_prompt(hld, data.get("style_description"))
        enriched = json.loads(await mp.expand(styled, width, height))
    except Exception as exc:
        logger.warning("Auto-structure failed (using original prompt): %s", exc)
        return prompt_json, None

    enriched_comp = enriched.get("compositional_deconstruction")
    if not enriched_comp or not enriched_comp.get("elements"):
        return prompt_json, None  # nothing gained — keep the original

    # Graft the rich scene; keep the user's explicit style_description untouched.
    data["compositional_deconstruction"] = enriched_comp
    if enriched.get("high_level_description"):
        data["high_level_description"] = enriched["high_level_description"]
    new_json = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    n = len(enriched_comp.get("elements", []))
    return new_json, f"Auto-structured prompt into {n} scene elements to reduce refusals…"


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    logger.info("===== Ideogram Studio starting — log file: %s =====", log_setup.LOG_FILE)
    logger.info("Startup memory: %s", system_check.mem_snapshot())
    app.state.db = await aiosqlite.connect(str(DB_PATH))
    await gallery_service.init_db(app.state.db)

    app.state.pipeline = PipelineManager()
    if app.state.pipeline.error:
        logger.warning("Previous session note: %s", app.state.pipeline.error)

    # Build magic-prompt service (may fail gracefully if no API key set)
    try:
        app.state.magic_prompt = MagicPromptService(
            app_settings.magic_prompt_backend,
            _magic_prompt_key(app_settings.magic_prompt_backend),
            openrouter_model=app_settings.openrouter_model,
            free_only=app_settings.openrouter_free_only,
        )
    except Exception as exc:
        print(f"[WARN] Magic Prompt service init failed: {exc}")
        app.state.magic_prompt = None

    # Set HF_TOKEN for model downloads
    if app_settings.hf_token:
        os.environ["HF_TOKEN"] = app_settings.hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = app_settings.hf_token

    # Open browser after a short delay
    def _open():
        time.sleep(1.5)
        webbrowser.open("http://localhost:8000")

    threading.Thread(target=_open, daemon=True).start()

    # Optional background preload (run.bat sets PRELOAD_MODEL=true): download
    # the model on first run, be ready-to-go afterwards. Runs off the event
    # loop so the UI opens immediately and shows progress in the Status panel.
    if app_settings.preload_model:
        variant = app_settings.preload_variant

        def _preload():
            time.sleep(2)   # let the server finish coming up first
            try:
                blockers = _preflight_blockers(variant, app.state.pipeline)
                if blockers:
                    logger.warning("Preload skipped — %s can't run here: %s",
                                   variant, "; ".join(blockers))
                    return
                logger.info("Preloading %s in the background…", variant)
                app.state.pipeline.load(variant)
                logger.info("Preload of %s complete.", variant)
            except Exception:
                logger.exception("Background preload failed (the app still works on demand)")

        threading.Thread(target=_preload, daemon=True).start()

    yield

    # SHUTDOWN
    from inference import release_gpu_lease
    release_gpu_lease()   # never leave a lease behind — GLM checks pid, but be tidy
    await app.state.db.close()


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Ideogram 4.0 Local Studio", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── System / hardware API ─────────────────────────────────────────────────────

@app.get("/api/system", response_model=SystemInfoResponse)
async def system_info():
    loop = asyncio.get_running_loop()
    # Probes (torch import, disk walk) can block — keep them off the event loop.
    report = await loop.run_in_executor(None, system_check.get_system_report)
    return SystemInfoResponse(**report)


@app.post("/api/system/free-gpu")
async def free_gpu():
    """Unload other apps' models from VRAM (currently: Ollama).

    Sends keep_alive=0 per resident model — the Ollama server keeps running,
    so the GLM legal system stays functional (it routes routine work to Haiku
    while our GPU lease is held). Returns what was freed and the new state.
    """
    loop = asyncio.get_running_loop()
    stopped = await loop.run_in_executor(None, system_check.stop_ollama_models)
    _name, _total, vram_free = await loop.run_in_executor(None, system_check.get_gpu_info)
    logger.info("free-gpu: stopped=%s vram_free=%.1f GB", stopped, vram_free or -1)
    return {
        "stopped": stopped,
        "vram_free_gb": round(vram_free, 1) if vram_free is not None else None,
    }


# ── Model API ─────────────────────────────────────────────────────────────────

def _preflight_blockers(variant: str, pm: PipelineManager | None = None) -> list[str]:
    """Hardware checks that protect the machine from RAM/VRAM/disk exhaustion."""
    gpu_name, vram_total, vram_free = system_check.get_gpu_info()
    ram_total, _ram_avail = system_check.get_ram_gb()
    disk_free = system_check.get_disk_free_gb()
    _climit, commit_avail = system_check.get_commit_gb()

    # load() unloads any currently-loaded pipeline first, so VRAM held by OUR
    # process comes back — credit it before judging free space.
    if vram_free is not None and pm is not None:
        ours_mb = pm.vram_used_mb()
        if ours_mb:
            vram_free = vram_free + ours_mb / 1024

    result = system_check.assess_variant(
        variant,
        vram_total_gb=vram_total,
        ram_total_gb=ram_total,
        disk_free_gb=disk_free,
        vram_free_gb=vram_free,
        gpu_processes=system_check.get_gpu_processes(),
        commit_available_gb=commit_avail,
    )
    return result["blockers"]


@app.get("/api/model/status", response_model=ModelStatusResponse)
async def model_status(request: Request):
    pm: PipelineManager = request.app.state.pipeline
    return ModelStatusResponse(
        status=pm.status,
        variant=pm.variant,
        vram_used_mb=pm.vram_used_mb(),
        error=pm.error,
        progress_message=pm.progress_message,
        download_pct=pm.download_pct,
        supports_inpaint=pm.supports_inpaint,
    )


@app.post("/api/model/load")
async def model_load(request: Request, body: ModelLoadRequest):
    pm: PipelineManager = request.app.state.pipeline
    if pm.is_busy:
        raise HTTPException(409, "A model load is already in progress")

    loop = asyncio.get_running_loop()

    if not body.force:
        blockers = await loop.run_in_executor(None, lambda: _preflight_blockers(body.variant, pm))
        if blockers:
            raise HTTPException(422, " ".join(blockers))

    loop.run_in_executor(_inference_executor, lambda: pm.load(body.variant))
    return {"message": f"Loading {body.variant} model...", "variant": body.variant}


@app.post("/api/model/unload")
async def model_unload(request: Request):
    pm: PipelineManager = request.app.state.pipeline
    try:
        pm.unload()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"message": "Model unloaded"}


# ── Magic Prompt API ──────────────────────────────────────────────────────────

def _openrouter_error_hint(exc: Exception) -> str:
    """Turn a raw OpenRouter HTTP error into an actionable message."""
    s = str(exc)
    if "401" in s or "Unauthorized" in s:
        return ("OpenRouter rejected your API key (401 Unauthorized). It's likely a "
                "Provisioning/management key, which can't run inference. Create a regular "
                "API key at openrouter.ai/keys (starts 'sk-or-v1-') and paste it into "
                "Settings → OpenRouter API Key.")
    if "402" in s:
        return ("OpenRouter requires credits for this model (402). With 'Free models only' on "
                "this shouldn't happen — check your model selection in Settings.")
    if "429" in s:
        return ("OpenRouter rate limit reached (429). Free models allow ~50 requests/day, or "
                "1000/day after a one-time $10 credit purchase. Wait a bit and retry.")
    return s


@app.post("/api/magic-prompt", response_model=MagicPromptResponse)
async def magic_prompt_endpoint(request: Request, body: MagicPromptRequest):
    mp: MagicPromptService | None = request.app.state.magic_prompt
    if mp is None:
        raise HTTPException(503, "Magic Prompt service not configured. Add an API key in Settings.")

    try:
        styled_text = compose_styled_prompt(
            body.text, body.style.model_dump() if body.style else None
        )
        caption_json = await mp.expand(styled_text, body.width, body.height)
        # Re-validate the returned JSON through the verifier
        state = parse_caption_json(caption_json)
        rebuilt_json, warnings = build_caption(state)
        return MagicPromptResponse(caption_json=rebuilt_json, warnings=warnings)
    except Exception as exc:
        raise HTTPException(500, f"Magic Prompt failed: {_openrouter_error_hint(exc)}") from exc


@app.post("/api/style/fuse", response_model=StyleFuseResponse)
async def style_fuse_endpoint(body: StyleFuseRequest):
    """
    AI Fuse: ask a chat LLM to invent one hybrid style from two presets.
    Runs on OpenRouter when a key is set, otherwise the local Claude CLI —
    the hosted Ideogram magic-prompt API cannot do this (it never returns
    style_description), so this path is independent of Magic Prompt.
    """
    if style_fuse.fuse_backend_available(app_settings.openrouter_api_key) is None:
        raise HTTPException(
            503,
            "AI Fuse needs an OpenRouter API key (Settings) or the Claude Code CLI installed.",
        )
    try:
        fused = await asyncio.to_thread(
            style_fuse.fuse_styles,
            body.form.model_dump(), body.mood.model_dump(),
            app_settings.openrouter_api_key,
            app_settings.openrouter_model,
            app_settings.openrouter_free_only,
        )
    except Exception as exc:
        raise HTTPException(502, f"AI Fuse failed: {_openrouter_error_hint(exc)}") from exc

    return StyleFuseResponse(**fused)


# ── LoRA adapters ─────────────────────────────────────────────────────────────
# Only the diffusers pipelines (nf4d, bf16) can load adapters. The frontend
# hides the whole panel when `supported` is false, so these endpoints are a
# no-op surface for fp8/nf4.

_LORA_EXTS = (".safetensors",)


def _scan_lora_files() -> list[str]:
    LORAS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(
        p.name for p in LORAS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in _LORA_EXTS
    )


def _adapter_name_from(source: str) -> str:
    """A stable, peft-safe adapter id from a filename or repo id."""
    stem = Path(source).stem if source.endswith(_LORA_EXTS) else source.split("/")[-1]
    return re.sub(r"[^0-9a-zA-Z_]+", "_", stem).strip("_") or "lora"


@app.get("/api/loras", response_model=LoraListResponse)
async def loras_list(request: Request):
    pm: PipelineManager = request.app.state.pipeline
    return LoraListResponse(
        supported=pm.supports_lora,
        variant=pm.variant,
        available=_scan_lora_files(),
        loaded=[LoraInfo(**a) for a in pm.active_loras()],
        loras_dir=str(LORAS_DIR),
    )


@app.post("/api/loras/apply", response_model=LoraListResponse)
async def loras_apply(request: Request, body: LoraApplyRequest):
    pm: PipelineManager = request.app.state.pipeline
    if not pm.supports_lora:
        raise HTTPException(
            409,
            f"The {pm.variant or 'current'} model can't load LoRA adapters. "
            "Switch to NF4·D or BF16 and reload.",
        )

    if body.filename:
        path = (LORAS_DIR / body.filename).resolve()
        if not str(path).startswith(str(LORAS_DIR.resolve())) or not path.is_file():
            raise HTTPException(404, f"LoRA file not found: {body.filename}")
        source = str(path)
    elif body.hf_repo:
        source = body.hf_repo.strip()
    else:
        raise HTTPException(422, "Provide a filename or an hf_repo.")

    adapter = _adapter_name_from(body.filename or source)
    loop = asyncio.get_running_loop()
    try:
        # Serialize with generation on the single-worker inference executor.
        await loop.run_in_executor(
            _inference_executor, lambda: pm.load_lora(source, adapter, body.weight)
        )
    except Exception as exc:
        raise HTTPException(400, f"Could not load LoRA: {exc}") from exc

    return await loras_list(request)


@app.post("/api/loras/weight", response_model=LoraListResponse)
async def loras_weight(request: Request, body: LoraWeightRequest):
    pm: PipelineManager = request.app.state.pipeline
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            _inference_executor, lambda: pm.set_lora_weight(body.name, body.weight)
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return await loras_list(request)


@app.post("/api/loras/remove", response_model=LoraListResponse)
async def loras_remove(request: Request, body: LoraRemoveRequest):
    pm: PipelineManager = request.app.state.pipeline
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        _inference_executor, lambda: pm.remove_lora(body.name)
    )
    return await loras_list(request)


# ── Gallery API ───────────────────────────────────────────────────────────────

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I
)


@app.get("/api/gallery", response_model=GalleryListResponse)
async def gallery_list(
    request: Request,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    favorites: bool = Query(default=False),
):
    db = request.app.state.db
    items, total = await gallery_service.list_jobs(
        db, page=page, per_page=per_page, status="done", search=search,
        favorites_only=favorites,
    )
    return GalleryListResponse(
        items=[GalleryItem(**item) for item in items],
        total=total,
    )


@app.get("/api/gallery/{job_id}", response_model=GalleryItem)
async def gallery_get(request: Request, job_id: str):
    db = request.app.state.db
    item = await gallery_service.get_job(db, job_id)
    if not item:
        raise HTTPException(404, "Job not found")
    return GalleryItem(**item)


@app.post("/api/gallery/{job_id}/favorite")
async def gallery_set_favorite(request: Request, job_id: str, body: FavoriteRequest):
    db = request.app.state.db
    found = await gallery_service.set_favorite(db, job_id, body.favorite)
    if not found:
        raise HTTPException(404, "Job not found")
    return {"message": "Updated", "favorite": body.favorite}


@app.delete("/api/gallery/{job_id}")
async def gallery_delete(request: Request, job_id: str):
    db = request.app.state.db
    image_path = await gallery_service.delete_job(db, job_id)
    if image_path is None:
        raise HTTPException(404, "Job not found")
    # Delete the image file
    full_path = OUTPUTS_DIR / Path(image_path).name
    if full_path.exists():
        full_path.unlink()
    return {"message": "Deleted"}




# ── Settings API ──────────────────────────────────────────────────────────────

@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings():
    return SettingsResponse(
        model_variant=app_settings.model_variant,
        magic_prompt_backend=app_settings.magic_prompt_backend,
        openrouter_model=app_settings.openrouter_model,
        openrouter_free_only=app_settings.openrouter_free_only,
        has_ideogram_api_key=bool(app_settings.ideogram_api_key),
        has_openrouter_api_key=bool(app_settings.openrouter_api_key),
        has_hf_token=bool(app_settings.hf_token),
        auto_structure_prompt=app_settings.auto_structure_prompt,
        safety_moderation_enabled=app_settings.safety_moderation_enabled,
        has_hive_text_key=bool(app_settings.hive_text_key),
        has_hive_visual_key=bool(app_settings.hive_visual_key),
    )


@app.put("/api/settings")
async def update_settings(request: Request, body: SettingsUpdateRequest):
    env_path = DB_PATH.parent / ".env"
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    def _set(key: str, value: str | None) -> None:
        nonlocal lines
        if value is None:
            return
        # Strip newlines so a malicious value can't inject extra env lines
        safe_value = value.replace("\r", "").replace("\n", "")
        key_upper = key.upper()
        for i, line in enumerate(lines):
            if line.startswith(f"{key_upper}=") or line.startswith(f"# {key_upper}="):
                lines[i] = f"{key_upper}={safe_value}"
                return
        lines.append(f"{key_upper}={safe_value}")

    if body.model_variant:
        _set("MODEL_VARIANT", body.model_variant)
        app_settings.model_variant = body.model_variant
    if body.magic_prompt_backend:
        _set("MAGIC_PROMPT_BACKEND", body.magic_prompt_backend)
        app_settings.magic_prompt_backend = body.magic_prompt_backend
    if body.openrouter_model:
        _set("OPENROUTER_MODEL", body.openrouter_model)
        app_settings.openrouter_model = body.openrouter_model
    if body.openrouter_free_only is not None:
        _set("OPENROUTER_FREE_ONLY", "true" if body.openrouter_free_only else "false")
        app_settings.openrouter_free_only = body.openrouter_free_only
    if body.ideogram_api_key is not None:
        raw_ideogram = body.ideogram_api_key.get_secret_value()
        _set("IDEOGRAM_API_KEY", raw_ideogram)
        app_settings.ideogram_api_key = raw_ideogram
    if body.openrouter_api_key is not None:
        raw_openrouter = body.openrouter_api_key.get_secret_value()
        _set("OPENROUTER_API_KEY", raw_openrouter)
        app_settings.openrouter_api_key = raw_openrouter
    if body.hf_token is not None:
        raw_hf = body.hf_token.get_secret_value()
        _set("HF_TOKEN", raw_hf)
        app_settings.hf_token = raw_hf
        os.environ["HF_TOKEN"] = raw_hf
        os.environ["HUGGING_FACE_HUB_TOKEN"] = raw_hf
    if body.auto_structure_prompt is not None:
        _set("AUTO_STRUCTURE_PROMPT", "true" if body.auto_structure_prompt else "false")
        app_settings.auto_structure_prompt = body.auto_structure_prompt
    if body.safety_moderation_enabled is not None:
        _set("SAFETY_MODERATION_ENABLED", "true" if body.safety_moderation_enabled else "false")
        app_settings.safety_moderation_enabled = body.safety_moderation_enabled
    if body.hive_text_key is not None:
        raw = body.hive_text_key.get_secret_value()
        _set("HIVE_TEXT_KEY", raw)
        app_settings.hive_text_key = raw or None
    if body.hive_visual_key is not None:
        raw = body.hive_visual_key.get_secret_value()
        _set("HIVE_VISUAL_KEY", raw)
        app_settings.hive_visual_key = raw or None

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Rebuild magic-prompt service if backend, key, model, or free-only changed.
    # We reconstruct (not rebuild) so a new openrouter_model takes effect.
    if (body.magic_prompt_backend or body.ideogram_api_key
            or body.openrouter_api_key or body.openrouter_model
            or body.openrouter_free_only is not None):
        try:
            mp_key = _magic_prompt_key(app_settings.magic_prompt_backend)
            request.app.state.magic_prompt = MagicPromptService(
                app_settings.magic_prompt_backend, mp_key,
                openrouter_model=app_settings.openrouter_model,
                free_only=app_settings.openrouter_free_only,
            )
        except Exception as exc:
            print(f"[WARN] Could not rebuild magic-prompt: {exc}")

    return {"message": "Settings saved"}


# ── WebSocket — generation ────────────────────────────────────────────────────

_WS_ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


@app.websocket("/ws/{job_id}")
async def generation_ws(websocket: WebSocket, job_id: str):
    # M-2: reject cross-origin WebSocket connections
    origin = websocket.headers.get("origin", "")
    if origin and origin not in _WS_ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    # H-2: job_id must be a valid UUID to prevent path traversal in filenames
    if not _UUID_RE.match(job_id):
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "Invalid job_id"})
        return

    await websocket.accept()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    db = websocket.app.state.db
    pm: PipelineManager = websocket.app.state.pipeline

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
        params = json.loads(raw)
    except (asyncio.TimeoutError, json.JSONDecodeError) as exc:
        await websocket.send_json({"type": "error", "message": f"Bad request: {exc}"})
        return

    # Validate params
    try:
        gen_req = GenerationRequest(**params)
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        return

    # Auto-load model if not ready
    if pm.status != "ready":
        if not pm.is_busy:
            # About to trigger a load — run the hardware preflight first so an
            # unsuitable variant can never freeze the machine.
            variant = gen_req.model_variant
            blockers = await loop.run_in_executor(None, lambda: _preflight_blockers(variant, pm))
            if blockers:
                await websocket.send_json({"type": "error", "message": " ".join(blockers)})
                return

            cached = await loop.run_in_executor(
                None, lambda: system_check.is_variant_cached(variant)
            )
            note = (
                "Loading model (20-40s)..." if cached
                else "Downloading model weights — first time only, this can take a while..."
            )
            await websocket.send_json({"type": "status", "message": f"{variant}: {note}"})

            load_done = asyncio.Event()
            load_error: list[str] = []

            def _load():
                try:
                    pm.load(variant)
                except Exception as exc:
                    load_error.append(str(exc))
                finally:
                    loop.call_soon_threadsafe(load_done.set)

            loop.run_in_executor(_inference_executor, _load)

            # Stream download/load progress to the client while we wait
            while not load_done.is_set():
                try:
                    await asyncio.wait_for(load_done.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    if pm.progress_message:
                        await websocket.send_json(
                            {"type": "status", "message": pm.progress_message}
                        )

            if load_error:
                await websocket.send_json({"type": "error", "message": load_error[0]})
                return
        else:
            await websocket.send_json(
                {"type": "status", "message": "Waiting for model to finish loading..."}
            )
            for _ in range(14_400):   # up to 4 hours (first download can be long)
                await asyncio.sleep(1)
                if pm.status == "ready":
                    break
                if pm.status == "error":
                    await websocket.send_json(
                        {"type": "error", "message": f"Model failed to load: {pm.error}"}
                    )
                    return
                if pm.progress_message and _ % 3 == 0:
                    await websocket.send_json(
                        {"type": "status", "message": pm.progress_message}
                    )

        if pm.status != "ready":
            await websocket.send_json(
                {"type": "error", "message": pm.error or "Model is not ready."}
            )
            return

    # Auto-structure (opt-in): enrich a sparse prompt into structured JSON,
    # which Ideogram 4 refuses far less often. Done before moderation so the
    # final prompt is what gets screened and generated.
    structured_json, structure_note = await _maybe_autostructure(
        gen_req.prompt_json, gen_req.width, gen_req.height, websocket.app.state.magic_prompt
    )
    if structure_note:
        gen_req.prompt_json = structured_json
        await websocket.send_json({"type": "status", "message": structure_note})

    # Optional Hive prompt screening (opt-in; no-op unless enabled + keyed).
    flagged = await loop.run_in_executor(
        None, lambda: _moderate_prompt_sync(gen_req.prompt_json)
    )
    if flagged:
        await websocket.send_json({
            "type": "error",
            "message": f"Blocked by content moderation (Hive): {', '.join(sorted(set(flagged)))}.",
        })
        return

    logger.info(
        "Generation %s: %dx%d %s on %s (seed=%s)",
        job_id, gen_req.width, gen_req.height, gen_req.sampler_preset,
        gen_req.model_variant, gen_req.seed,
    )
    await websocket.send_json({"type": "started", "job_id": job_id})

    settings = GenerationSettings(
        height=gen_req.height,
        width=gen_req.width,
        sampler_preset=gen_req.sampler_preset,
        seed=gen_req.seed,
        raise_on_caption_issues=False,   # warnings only, don't block generation
    )

    # Create DB record using the WebSocket job_id so complete_job can find it
    import json as _json
    await gallery_service.create_job(
        db,
        job_id=job_id,
        prompt_json=gen_req.prompt_json,
        settings_json=_json.dumps({
            "height": gen_req.height, "width": gen_req.width,
            "sampler_preset": gen_req.sampler_preset, "model_variant": gen_req.model_variant,
        }),
        width=gen_req.width,
        height=gen_req.height,
        sampler_preset=gen_req.sampler_preset,
        model_variant=gen_req.model_variant,
    )

    t_start = time.monotonic()

    def _run():
        try:
            def on_step(step_i: int, total: int):
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "progress", "step": step_i + 1, "total": total}),
                    loop,
                )

            image, actual_seed = pm.generate(gen_req.prompt_json, settings, on_step)

            # Optional Hive image screening (opt-in). On a hit, discard the
            # image rather than saving it.
            img_flags = _moderate_image_sync(image)
            if img_flags:
                raise RuntimeError(
                    f"Image blocked by content moderation (Hive): "
                    f"{', '.join(sorted(set(img_flags)))}."
                )

            filename = f"{job_id}.png"
            image.save(str(OUTPUTS_DIR / filename))
            duration_ms = int((time.monotonic() - t_start) * 1000)
            asyncio.run_coroutine_threadsafe(
                queue.put({
                    "type": "done",
                    "image_url": f"/outputs/{filename}",
                    "seed": actual_seed,
                    "duration_ms": duration_ms,
                }),
                loop,
            )
        except Exception as exc:
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "message": str(exc)}),
                loop,
            )

    loop.run_in_executor(_inference_executor, _run)

    try:
        while True:
            msg = await queue.get()
            await websocket.send_json(msg)
            if msg["type"] == "done":
                # Persist to gallery
                await gallery_service.complete_job(
                    db,
                    job_id,
                    image_path=f"{job_id}.png",
                    seed=msg["seed"],
                    duration_ms=msg["duration_ms"],
                )
                break
            elif msg["type"] == "error":
                logger.error("Generation %s failed: %s", job_id, msg["message"])
                await gallery_service.fail_job(db, job_id, msg["message"])
                break
    except WebSocketDisconnect:
        pass  # Client disconnected mid-generation — generation thread continues but we stop forwarding


# ── Upscale API ───────────────────────────────────────────────────────────────

@app.get("/api/upscale/models", response_model=list[UpscaleModelInfo])
async def upscale_models_list():
    from upscaler import available_models
    return available_models()


@app.post("/api/upscale", response_model=UpscaleResponse)
async def upscale_image_endpoint(request: Request, body: UpscaleRequest):
    from upscaler import upscale

    db = request.app.state.db
    item = await gallery_service.get_job(db, body.job_id)
    if not item or not item.get("image_path"):
        raise HTTPException(404, "Job not found")

    source_path = OUTPUTS_DIR / Path(item["image_path"]).name
    if not source_path.exists():
        raise HTTPException(404, "Image file not found on disk")

    image_bytes = source_path.read_bytes()
    loop = asyncio.get_running_loop()

    try:
        png_bytes, orig_size, up_size = await loop.run_in_executor(
            _inference_executor,
            lambda: upscale(image_bytes, body.model_name),
        )
    except Exception as exc:
        raise HTTPException(500, f"Upscale failed: {exc}") from exc

    # Save alongside the source image with a descriptive suffix
    suffix = body.model_name.lower().replace("-", "_")
    out_name = f"{body.job_id}_up_{suffix}.png"
    (OUTPUTS_DIR / out_name).write_bytes(png_bytes)

    return UpscaleResponse(
        image_url=f"/outputs/{out_name}",
        original_width=orig_size[0],
        original_height=orig_size[1],
        upscaled_width=up_size[0],
        upscaled_height=up_size[1],
    )


# ── Image editing API ─────────────────────────────────────────────────────────
# The Ideogram 4 open-weights release is text-to-image only (no inpainting /
# img2img — Canvas and Magic Fill remain ideogram.ai server-side products).
# Editing happens in the browser (layered canvas editor, exact WYSIWYG); the
# server validates the flattened result and stores it as a derived gallery item.

def _decode_and_sanitize_png(image_b64: str) -> tuple[bytes, int, int]:
    """Decode base64 → PIL → re-encoded PNG. Re-encoding strips anything that
    isn't pixel data, so no client-controlled bytes hit disk verbatim."""
    import base64
    import io
    from PIL import Image

    raw = base64.b64decode(image_b64, validate=True)
    img = Image.open(io.BytesIO(raw))
    img.load()
    if img.width > 8192 or img.height > 8192:
        raise ValueError(f"image too large: {img.width}x{img.height}")
    img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), img.width, img.height


@app.post("/api/import", response_model=EditResponse)
async def import_image_endpoint(request: Request, body: ImportImageRequest):
    """Bring a user-supplied image into the gallery (e.g. to edit it)."""
    import uuid as _uuid

    db = request.app.state.db
    loop = asyncio.get_running_loop()
    try:
        png_bytes, w, h = await loop.run_in_executor(
            None, lambda: _decode_and_sanitize_png(body.image_b64)
        )
    except Exception as exc:
        logger.exception("Image import failed")
        raise HTTPException(400, f"Invalid image data: {exc}") from exc

    new_id = str(_uuid.uuid4())
    out_name = f"{new_id}.png"
    (OUTPUTS_DIR / out_name).write_bytes(png_bytes)
    label = f"Imported — {body.filename}" if body.filename else "Imported image"
    await gallery_service.insert_imported(
        db, new_id=new_id, image_path=out_name, width=w, height=h, label=label
    )
    logger.info("Imported image -> %s (%dx%d, %s)", new_id, w, h, label)
    return EditResponse(
        job_id=new_id, image_url=f"/outputs/{out_name}", width=w, height=h
    )


def _decode_b64_to_pil(image_b64: str, mode: str = "RGB"):
    """base64 → PIL in the requested mode. For a mask, an alpha channel (if
    present) is used as the selection, else the luminance."""
    import base64, io
    from PIL import Image
    img = Image.open(io.BytesIO(base64.b64decode(image_b64, validate=True)))
    img.load()
    if img.width > 8192 or img.height > 8192:
        raise ValueError(f"image too large: {img.width}x{img.height}")
    if mode == "L" and img.mode in ("RGBA", "LA"):
        return img.getchannel("A")
    return img.convert(mode)


@app.post("/api/edit/inpaint", response_model=EditResponse)
async def inpaint_endpoint(request: Request, body: InpaintRequest):
    """AI region fill — regenerate the masked area from a prompt, keep the rest."""
    import uuid as _uuid

    pm: PipelineManager = request.app.state.pipeline
    if pm.status != "ready":
        raise HTTPException(409, "Load a model first (the editor needs the model in memory).")
    if not pm.supports_inpaint:
        raise HTTPException(
            409,
            f"AI region fill needs a diffusers model. The {pm.variant or 'current'} variant "
            "can't inpaint — switch to NF4·D or BF16 and reload.",
        )

    loop = asyncio.get_running_loop()
    try:
        image = await loop.run_in_executor(None, lambda: _decode_b64_to_pil(body.image_b64, "RGB"))
        mask = await loop.run_in_executor(None, lambda: _decode_b64_to_pil(body.mask_b64, "L"))
    except Exception as exc:
        raise HTTPException(400, f"Invalid image data: {exc}") from exc

    settings = GenerationSettings(
        height=image.height, width=image.width,
        sampler_preset=body.sampler_preset, seed=body.seed,
        raise_on_caption_issues=False,
    )

    # Structure the prompt into a JSON caption, exactly like the text-to-image
    # path. Ideogram 4 paints its gray "safety filter" card far more often on a
    # bare plain-text prompt than on a structured caption — so a raw inpaint
    # prompt is the most refusal-prone input in the whole app. This brings AI
    # Fill to parity. (Can't eliminate refusals — they're baked into the
    # weights — but it minimises them, the same lever we use for generation.)
    fill_prompt = body.prompt
    mp: MagicPromptService | None = request.app.state.magic_prompt
    if mp is not None:
        try:
            fill_prompt = await mp.expand(body.prompt, image.width, image.height)
        except Exception as exc:
            logger.warning("Inpaint prompt structuring failed (using raw text): %s", exc)

    def _run():
        return pm.inpaint(image, mask, fill_prompt, settings)

    try:
        out_img, _seed = await loop.run_in_executor(_inference_executor, _run)
    except Exception as exc:
        logger.exception("Inpaint failed")
        raise HTTPException(500, f"AI region fill failed: {exc}") from exc

    db = request.app.state.db
    new_id = str(_uuid.uuid4())
    out_name = f"{new_id}.png"
    out_img.convert("RGB").save(str(OUTPUTS_DIR / out_name), format="PNG")
    w, h = out_img.size

    source = await gallery_service.get_job(db, body.source_job_id) if body.source_job_id else None
    if source and source.get("image_path"):
        await gallery_service.insert_derived(db, source=source, new_id=new_id, image_path=out_name, width=w, height=h)
    else:
        await gallery_service.insert_imported(db, new_id=new_id, image_path=out_name, width=w, height=h, label="AI region fill")
    logger.info("Inpaint -> %s (%dx%d)", new_id, w, h)
    return EditResponse(job_id=new_id, image_url=f"/outputs/{out_name}", width=w, height=h)


@app.post("/api/edit/save", response_model=EditResponse)
async def edit_save_endpoint(request: Request, body: EditSaveRequest):
    import uuid as _uuid

    db = request.app.state.db
    item = await gallery_service.get_job(db, body.source_job_id)
    if not item or not item.get("image_path"):
        raise HTTPException(404, "Source job not found")

    loop = asyncio.get_running_loop()
    try:
        png_bytes, w, h = await loop.run_in_executor(
            None, lambda: _decode_and_sanitize_png(body.image_b64)
        )
    except Exception as exc:
        logger.exception("Edit save failed for %s", body.source_job_id)
        raise HTTPException(400, f"Invalid image data: {exc}") from exc

    new_id = str(_uuid.uuid4())
    out_name = f"{new_id}.png"
    (OUTPUTS_DIR / out_name).write_bytes(png_bytes)
    await gallery_service.insert_derived(
        db, source=item, new_id=new_id, image_path=out_name, width=w, height=h
    )
    logger.info("Saved edit of %s -> %s (%dx%d)", body.source_job_id, new_id, w, h)
    return EditResponse(
        job_id=new_id, image_url=f"/outputs/{out_name}", width=w, height=h
    )


# ── Logs API ──────────────────────────────────────────────────────────────────

@app.get("/api/logs", response_model=LogsResponse)
async def get_logs(lines: int = Query(default=200, ge=10, le=1000)):
    loop = asyncio.get_running_loop()
    tail = await loop.run_in_executor(None, lambda: log_setup.tail_log(lines))
    return LogsResponse(lines=tail, path=str(log_setup.LOG_FILE))


# ── Static file mounts — MUST be last ─────────────────────────────────────────
# Both mounts use StaticFiles so no user-controlled path ever reaches FileResponse.
# /outputs: generated images; /: compiled React SPA with SPA-routing fallback.
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


class SPAStaticFiles(StaticFiles):
    """StaticFiles that serves index.html for unknown paths, so client-side
    routes (/gallery, /settings, …) survive refresh and deep links."""

    async def get_response(self, path: str, scope):
        from starlette.exceptions import HTTPException as StarletteHTTPException

        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


if DIST_DIR.exists():
    app.mount("/", SPAStaticFiles(directory=str(DIST_DIR), html=True), name="spa")
else:
    @app.get("/{full_path:path}")
    async def _no_frontend(_full_path: str):
        return JSONResponse({"detail": "Frontend not built. Run install.bat first."}, status_code=503)
