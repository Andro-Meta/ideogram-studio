#!/usr/bin/env python3
"""
eval_inpaint_lora.py — A/B harness for the Ideogram 4 inpaint LoRA.

Compares our training-free RePaint inpaint (the studio's default) against the
same edit with a learned inpaint adapter applied
(`BitPoet/Ideogram4-Inpaint-LoRA`), at the SAME seed, so the only variable is the
adapter. Saves both results plus a side-by-side strip.

GPU-gated — needs a LoRA-capable pipeline loaded (nf4d or bf16) on the 24 GB box.
This is a standalone script (not wired into the server); run it directly.

Usage
-----
  python eval_inpaint_lora.py \
      --image  edit_base.png \
      --mask   edit_mask.png \
      --prompt caption.json \
      --out-dir ../outputs/inpaint_eval

`--mask`: white/opaque = the region to regenerate (same convention as the app).
`--prompt`: a caption JSON file/string, or plain text.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load_hf_token() -> None:
    """Push the .env HF token into the environment the pipelines read."""
    try:
        from settings import settings as app_settings  # loads .env, sets HF_HOME
        if app_settings.hf_token and not os.environ.get("HF_TOKEN"):
            os.environ["HF_TOKEN"] = app_settings.hf_token
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] couldn't load .env settings: {exc}", file=sys.stderr)


def _read_prompt(value: str) -> str:
    p = Path(value)
    return p.read_text(encoding="utf-8") if p.exists() else value


def _progress(tag: str):
    def cb(step: int, total: int) -> None:
        print(f"\r  [{tag}] step {step}/{total}", end="", flush=True)
    return cb


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="A/B test the Ideogram 4 inpaint LoRA.")
    ap.add_argument("--image", required=True, help="Base image (PNG/JPEG).")
    ap.add_argument("--mask", required=True, help="Mask PNG — white = regenerate.")
    ap.add_argument("--prompt", required=True, help="Caption JSON / text, or a file path.")
    ap.add_argument("--lora", default="BitPoet/Ideogram4-Inpaint-LoRA",
                    help="HF repo id (or local .safetensors path) of the inpaint LoRA.")
    ap.add_argument("--weight", type=float, default=1.0)
    ap.add_argument("--strength", type=float, default=0.75,
                    help="How much the masked region may change (0.1–1.0).")
    ap.add_argument("--seed", type=int, default=None,
                    help="Lock the seed; default rolls one and reuses it for both runs.")
    ap.add_argument("--sampler", default="V4_DEFAULT_20",
                    choices=["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"])
    ap.add_argument("--variant", default="nf4d", choices=["nf4d", "bf16"],
                    help="LoRA-capable pipeline to load.")
    ap.add_argument("--out-dir", default="../outputs/inpaint_eval")
    args = ap.parse_args(argv)

    _load_hf_token()

    from PIL import Image
    import inference

    image = Image.open(args.image).convert("RGB")
    mask = Image.open(args.mask).convert("L")
    prompt_json = _read_prompt(args.prompt)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pm = inference.PipelineManager()
    print(f"Loading {args.variant} … (first run downloads weights)")
    pm.load(args.variant)
    if pm.status != "ready":
        raise SystemExit(f"Model failed to load: {pm.error}")
    if not pm.supports_inpaint():
        raise SystemExit(f"The {args.variant} pipeline can't inpaint.")
    if not pm.supports_lora():
        raise SystemExit(f"The {args.variant} pipeline can't load LoRA — pick nf4d or bf16.")

    settings = inference.GenerationSettings(
        height=image.height, width=image.width,
        sampler_preset=args.sampler, seed=args.seed,
        raise_on_caption_issues=False,
    )

    try:
        # ── A: baseline RePaint inpaint (no adapter) ──────────────────────────
        print("\n[A] baseline inpaint (RePaint, no LoRA)")
        t0 = time.monotonic()
        img_a, used_seed = pm.inpaint(image, mask, prompt_json, settings,
                                      strength=args.strength, step_callback=_progress("A"))
        print(f"\n    seed={used_seed}  {time.monotonic() - t0:.1f}s")

        # ── B: same seed, with the inpaint LoRA applied ───────────────────────
        settings.seed = used_seed  # lock to A's seed so the comparison is fair
        print(f"[B] inpaint with LoRA {args.lora} @ {args.weight}")
        pm.load_lora(args.lora, "inpaint_eval", args.weight)
        try:
            t0 = time.monotonic()
            img_b, _ = pm.inpaint(image, mask, prompt_json, settings,
                                  strength=args.strength, step_callback=_progress("B"))
            print(f"\n    {time.monotonic() - t0:.1f}s")
        finally:
            pm.remove_lora("inpaint_eval")

        # ── Save A, B, and a side-by-side strip ───────────────────────────────
        stamp = time.strftime("%Y%m%d-%H%M%S")
        a_path = out_dir / f"inpaint_{stamp}_A_baseline_seed{used_seed}.png"
        b_path = out_dir / f"inpaint_{stamp}_B_lora_seed{used_seed}.png"
        cmp_path = out_dir / f"inpaint_{stamp}_compare_seed{used_seed}.png"
        img_a.save(a_path)
        img_b.save(b_path)

        gap = 16
        strip = Image.new("RGB", (img_a.width + img_b.width + gap, max(img_a.height, img_b.height)), "white")
        strip.paste(img_a, (0, 0))
        strip.paste(img_b, (img_a.width + gap, 0))
        strip.save(cmp_path)

        print("\nDone:")
        print(f"  A (baseline): {a_path.resolve()}")
        print(f"  B (LoRA):     {b_path.resolve()}")
        print(f"  side-by-side: {cmp_path.resolve()}")
        print(f"  seed: {used_seed}  strength: {args.strength}  weight: {args.weight}")
    finally:
        pm.unload()


if __name__ == "__main__":
    main()
