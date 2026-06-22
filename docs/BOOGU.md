# Boogu Edit (experimental)

Native instruction image editing via **Boogu-Image-0.1-Edit** — a separate 10B,
Apache-2.0 model (https://github.com/boogu-project/Boogu-Image). Unlike Ideogram 4
(text-to-image only, so our edits are composited hacks), Boogu is *trained* on
edits: add/remove objects, attribute changes, background swap, in-image text — and
it handles scale/depth/occlusion that the hacks fake.

## Install (one time, ~20 GB)

```
setup_boogu.bat
```

Clones the repo into `Boogu-Image/`, builds its own venv (pinned torch 2.7/cu126),
and downloads the Edit weights to `Boogu-Image/models/Boogu-Image-0.1-Edit`.

Override locations with env vars before starting the backend:
- `BOOGU_DIR` — repo clone path (default `./Boogu-Image`)
- `BOOGU_PYTHON` — its venv python (default `BOOGU_DIR/venv/Scripts/python.exe`)

## Use

Open the **Boogu** tab → drop a source image → type an instruction → Edit.

## VRAM (10B on a 24 GB 4090)

The model runs in its own subprocess and loads onto the GPU. With the Ideogram
pipeline also loaded you'll OOM, so either:
- keep **CPU offload** on (the tab's default — slower, fits), or
- unload the Ideogram model first.

`fp8` toggle uses less VRAM. Runs are minutes, not seconds.

## How it's wired

Backend shells out to Boogu's `inference.py` (`backend/boogu_edit.py`) — we don't
reimplement the pipeline. Endpoint `POST /api/edit/boogu`; install state at
`GET /api/boogu/status`. Flags map to the CLI from `INFERENCE_GUIDE.md`; if Boogu
changes a flag name, fix it in `boogu_edit.build_cmd`.
