"""
Ideogram 4.0 Local Studio — FastAPI application.
Single process, single worker. Serves the compiled React SPA as static files.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import threading
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

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
    ModelStatusResponse,
    SettingsResponse,
    SettingsUpdateRequest,
)
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


# ── Model API ─────────────────────────────────────────────────────────────────

@app.get("/api/model/status", response_model=ModelStatusResponse)
async def model_status(request: Request):
    pm: PipelineManager = request.app.state.pipeline
    return ModelStatusResponse(
        status=pm.status,
        variant=pm.variant,
        vram_used_mb=pm.vram_used_mb(),
        error=pm.error,
    )


@app.post("/api/model/load")
async def model_load(request: Request, body: dict):
    variant = body.get("variant", app_settings.model_variant)
    if variant not in ("fp8", "bf16"):
        raise HTTPException(400, "variant must be 'fp8' or 'bf16'")

    pm: PipelineManager = request.app.state.pipeline
    if pm.status == "loading":
        raise HTTPException(409, "Model is already loading")

    loop = asyncio.get_running_loop()
    loop.run_in_executor(_inference_executor, lambda: pm.load(variant))
    return {"message": f"Loading {variant} model...", "variant": variant}


@app.post("/api/model/unload")
async def model_unload(request: Request):
    pm: PipelineManager = request.app.state.pipeline
    if pm._pipeline:
        pm._pipeline.unload()
        pm._pipeline = None
        pm._variant = None
        pm.status = "unloaded"
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

@app.get("/api/gallery", response_model=GalleryListResponse)
async def gallery_list(
    request: Request,
    page: int = 1,
    per_page: int = 20,
):
    db = request.app.state.db
    items, total = await gallery_service.list_jobs(
        db, page=page, per_page=per_page, status="done"
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


# ── Outputs (image files) ─────────────────────────────────────────────────────

@app.get("/outputs/{filename}")
async def serve_output(filename: str):
    path = OUTPUTS_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(path), media_type="image/png")


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
        key_upper = key.upper()
        for i, line in enumerate(lines):
            if line.startswith(f"{key_upper}=") or line.startswith(f"# {key_upper}="):
                lines[i] = f"{key_upper}={value}"
                return
        lines.append(f"{key_upper}={value}")

    if body.model_variant:
        _set("MODEL_VARIANT", body.model_variant)
        app_settings.model_variant = body.model_variant
    if body.magic_prompt_backend:
        _set("MAGIC_PROMPT_BACKEND", body.magic_prompt_backend)
        app_settings.magic_prompt_backend = body.magic_prompt_backend
    if body.ideogram_api_key is not None:
        _set("IDEOGRAM_API_KEY", body.ideogram_api_key)
        app_settings.ideogram_api_key = body.ideogram_api_key
    if body.openrouter_api_key is not None:
        _set("OPENROUTER_API_KEY", body.openrouter_api_key)
        app_settings.openrouter_api_key = body.openrouter_api_key
    if body.hf_token is not None:
        _set("HF_TOKEN", body.hf_token)
        app_settings.hf_token = body.hf_token
        os.environ["HF_TOKEN"] = body.hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = body.hf_token

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

@app.websocket("/ws/{job_id}")
async def generation_ws(websocket: WebSocket, job_id: str):
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
        if pm.status == "loading":
            await websocket.send_json({"type": "status", "message": "Waiting for model to finish loading..."})
            # Poll until ready or error
            for _ in range(300):    # up to 5 minutes
                await asyncio.sleep(1)
                if pm.status == "ready":
                    break
                if pm.status == "error":
                    await websocket.send_json({"type": "error", "message": f"Model failed to load: {pm.error}"})
                    return
        else:
            # Load now
            variant = gen_req.model_variant
            await websocket.send_json({"type": "status", "message": f"Loading {variant} model (this may take 20-40s)..."})

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
            await load_done.wait()

            if load_error:
                await websocket.send_json({"type": "error", "message": load_error[0]})
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
        pass


# ── SPA catch-all — MUST be last ──────────────────────────────────────────────

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    candidate = DIST_DIR / full_path
    if candidate.is_file():
        return FileResponse(str(candidate))
    index = DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"detail": "Frontend not built. Run install.bat first."}, status_code=503)
