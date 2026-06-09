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
from schemas import (
    GalleryItem,
    GalleryListResponse,
    GenerationRequest,
    MagicPromptRequest,
    MagicPromptResponse,
    ModelLoadRequest,
    ModelStatusResponse,
    SettingsResponse,
    SettingsUpdateRequest,
    SystemInfoResponse,
    UpscaleModelInfo,
    UpscaleRequest,
    UpscaleResponse,
)
import system_check
from settings import DIST_DIR, OUTPUTS_DIR, DB_PATH, settings as app_settings

# ── Directories ───────────────────────────────────────────────────────────────
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Thread pool (one slot for inference, one for magic-prompt) ─────────────
_inference_executor = ThreadPoolExecutor(max_workers=1)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    app.state.db = await aiosqlite.connect(str(DB_PATH))
    await gallery_service.init_db(app.state.db)

    app.state.pipeline = PipelineManager()

    # Build magic-prompt service (may fail gracefully if no API key set)
    try:
        mp_key = app_settings.ideogram_api_key or app_settings.openrouter_api_key
        app.state.magic_prompt = MagicPromptService(
            app_settings.magic_prompt_backend, mp_key
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

    yield

    # SHUTDOWN
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


# ── Model API ─────────────────────────────────────────────────────────────────

def _preflight_blockers(variant: str) -> list[str]:
    """Hardware checks that protect the machine from RAM/disk exhaustion."""
    gpu_name, vram_total, _vram_free = system_check.get_gpu_info()
    ram_total, _ram_avail = system_check.get_ram_gb()
    disk_free = system_check.get_disk_free_gb()
    result = system_check.assess_variant(
        variant,
        vram_total_gb=vram_total,
        ram_total_gb=ram_total,
        disk_free_gb=disk_free,
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
    )


@app.post("/api/model/load")
async def model_load(request: Request, body: ModelLoadRequest):
    pm: PipelineManager = request.app.state.pipeline
    if pm.is_busy:
        raise HTTPException(409, "A model load is already in progress")

    loop = asyncio.get_running_loop()

    if not body.force:
        blockers = await loop.run_in_executor(None, lambda: _preflight_blockers(body.variant))
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

@app.post("/api/magic-prompt", response_model=MagicPromptResponse)
async def magic_prompt_endpoint(request: Request, body: MagicPromptRequest):
    mp: MagicPromptService | None = request.app.state.magic_prompt
    if mp is None:
        raise HTTPException(503, "Magic Prompt service not configured. Add an API key in Settings.")

    try:
        caption_json = await mp.expand(body.text, body.width, body.height)
        # Re-validate the returned JSON through the verifier
        state = parse_caption_json(caption_json)
        rebuilt_json, warnings = build_caption(state)
        return MagicPromptResponse(caption_json=rebuilt_json, warnings=warnings)
    except Exception as exc:
        raise HTTPException(500, f"Magic Prompt failed: {exc}") from exc


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
):
    db = request.app.state.db
    items, total = await gallery_service.list_jobs(
        db, page=page, per_page=per_page, status="done", search=search
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
        has_ideogram_api_key=bool(app_settings.ideogram_api_key),
        has_openrouter_api_key=bool(app_settings.openrouter_api_key),
        has_hf_token=bool(app_settings.hf_token),
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

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Rebuild magic-prompt service if backend or key changed
    if body.magic_prompt_backend or body.ideogram_api_key or body.openrouter_api_key:
        try:
            mp_key = app_settings.ideogram_api_key or app_settings.openrouter_api_key
            mp: MagicPromptService | None = request.app.state.magic_prompt
            if mp:
                mp.rebuild(app_settings.magic_prompt_backend, mp_key)
            else:
                request.app.state.magic_prompt = MagicPromptService(
                    app_settings.magic_prompt_backend, mp_key
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
            blockers = await loop.run_in_executor(None, lambda: _preflight_blockers(variant))
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


# ── Static file mounts — MUST be last ─────────────────────────────────────────
# Both mounts use StaticFiles so no user-controlled path ever reaches FileResponse.
# /outputs: generated images; /: compiled React SPA with SPA-routing fallback.
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

if DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="spa")
else:
    @app.get("/{full_path:path}")
    async def _no_frontend(_full_path: str):
        return JSONResponse({"detail": "Frontend not built. Run install.bat first."}, status_code=503)
