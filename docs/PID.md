# Optional: NVIDIA PiD prompt-aware upscaler

[PiD (Pixel Diffusion)](https://github.com/nv-tlabs/PiD) is NVIDIA's pixel-space
super-resolution decoder. Because Ideogram 4 uses the **Flux.2 VAE** latent
space, PiD can take an Ideogram generation and produce a **2× upscale that
re-synthesizes detail conditioned on your prompt** — unlike AuraSR's blind GAN
super-resolution. The Banodoco `#ideogram` community pairs Ideogram → PiD for
exactly this.

This is **opt-in and off by default.** When it isn't installed, the studio
simply doesn't offer it (AuraSR stays the default upscaler).

## ⚠️ Memory: this is heavy

PiD loads the **Gemma-2-2b-it** text encoder (~5 GB) plus its own diffusion
model — **~10 GB of host RAM just to start.** The studio enforces a hard
**≥ 14 GB free-RAM guard**: if there isn't enough RAM it returns a clear error
("close apps and retry") **instead of running** — so it can never crash the host.

- **64 GB+ RAM:** comfortable.
- **32 GB RAM:** a tight squeeze — close your browser and other apps first; the
  guard will refuse if it's not safe. (We ship only the lighter **2k** checkpoint
  → 2048 output; the 2kto4k/4K checkpoint needs far more RAM and is intentionally
  not used.)

PiD is **NSCLv1 (non-commercial)** — consistent with Ideogram's own
non-commercial open weights.

## Install

```bat
:: one command — clones nv-tlabs/PiD, installs its deps, downloads ~8 GB of weights
setup_pid.bat
```

Prerequisites:
- `git` on PATH.
- An `HF_TOKEN` in `.env` (the same one you use for the model weights).
- **Accept the Gemma license once:** https://huggingface.co/google/gemma-2-2b-it

Then restart the studio (`run.bat`). A **"2× PiD (NVIDIA, prompt-aware)"** entry
appears in the Upscale picker on any generation.

## How it works here

- `backend/pid_upscale.py` — availability detection + the RAM guard + a subprocess
  call to PiD's `from_clean` (image → Flux.2-VAE encode → prompt-conditioned
  pixel-diffusion decode at 2×, 4 distilled steps).
- The `/api/upscale` endpoint frees the generation model's VRAM first (PiD needs
  the GPU; the model reloads lazily on the next generate), then runs PiD.
- The caption is reconstructed from the generation's stored prompt JSON.

It looks for the PiD repo at `$PID_HOME`, else `models/pid_repo`, else
`discord_research/PiD`. Weights live under `<repo>/checkpoints/` (gitignored).
