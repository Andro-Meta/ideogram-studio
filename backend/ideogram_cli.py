#!/usr/bin/env python3
"""
ideogram_cli.py — a headless command-line companion to the Ideogram 4.0 Studio.

Ported in spirit from jonasnordlund/intuition's CLI (Generate / Remix / Magic
Prompt / Describe), but implemented as a *client of your local studio server* so
it reuses the exact same pipeline, settings, and gallery — nothing is
re-implemented and no second model load is needed.

Most commands talk to a running server (start it with run.bat, default
http://localhost:8000). The `caption` command is fully offline (no server, no
GPU): it builds + validates the structured JSON caption locally.

Examples
--------
  # Build a caption from a prompt-state JSON file, with quality constraints:
  python ideogram_cli.py caption scene_state.json --constraints sharpness,noise

  # Expand a plain prompt into a structured caption (server's Magic Prompt):
  python ideogram_cli.py magic-prompt "a fox reading a map, vintage poster"

  # Reverse-prompt an image (server's free vision model):
  python ideogram_cli.py describe photo.jpg

  # Generate from a caption (or plain text) and save the PNG:
  python ideogram_cli.py generate --caption caption.json --out out.png \
      --width 1024 --height 1024 --sampler V4_DEFAULT_20 --cfg 3.5

Only stdlib is required for `caption` / `magic-prompt` / `describe` (urllib).
`generate` additionally needs the `websockets` package (already pulled in by the
server's uvicorn[standard]).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DEFAULT_HOST = os.environ.get("IDEOGRAM_STUDIO_HOST", "http://localhost:8000")


# ── small REST helpers (stdlib only) ─────────────────────────────────────────

def _post_json(host: str, path: str, payload: dict, timeout: float = 180.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        host.rstrip("/") + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"Server error {exc.code} on {path}: {body}")
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"Couldn't reach the studio at {host} ({exc.reason}). "
            f"Is it running? Start it with run.bat, or pass --host."
        )


def _get_bytes(host: str, path: str, timeout: float = 60.0) -> bytes:
    url = path if path.startswith("http") else host.rstrip("/") + path
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _read_caption_arg(value: str) -> str:
    """A --caption value may be inline JSON/text or a path to a file."""
    p = Path(value)
    if p.exists() and p.is_file():
        return p.read_text(encoding="utf-8")
    return value


# ── commands ─────────────────────────────────────────────────────────────────

def cmd_caption(args: argparse.Namespace) -> None:
    """Offline: build + validate a structured caption from a prompt-state JSON."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from caption import build_caption          # local, no GPU
    from constraints import build_constraint_clause, apply_constraints_to_caption

    state = json.loads(Path(args.state).read_text(encoding="utf-8"))
    caption_json, warnings = build_caption(state)

    if args.constraints is not None or args.custom:
        ids = [s.strip() for s in (args.constraints or "").split(",") if s.strip()] or None
        clause = build_constraint_clause(ids, args.custom or "")
        caption_json = apply_constraints_to_caption(caption_json, clause)

    print(caption_json)
    for w in warnings:
        print(f"[warn] {w}", file=sys.stderr)


def cmd_magic_prompt(args: argparse.Namespace) -> None:
    out = _post_json(args.host, "/api/magic-prompt", {
        "text": args.text, "width": args.width, "height": args.height,
    })
    print(out.get("caption_json", ""))
    for w in out.get("warnings", []):
        print(f"[warn] {w}", file=sys.stderr)


def cmd_describe(args: argparse.Namespace) -> None:
    raw = Path(args.image).read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    out = _post_json(args.host, "/api/describe-image", {"image_b64": b64})
    print(out.get("prompt", ""))


def cmd_generate(args: argparse.Namespace) -> None:
    try:
        import asyncio
        import websockets  # type: ignore
    except ImportError:
        raise SystemExit(
            "The `generate` command needs the `websockets` package:\n"
            "  pip install websockets"
        )

    prompt_json = _read_caption_arg(args.caption)
    req: dict = {
        "prompt_json": prompt_json,
        "width": args.width,
        "height": args.height,
        "sampler_preset": args.sampler,
        "seed": args.seed,
        "model_variant": args.model_variant,
    }
    if args.cfg is not None:
        req["cfg"] = args.cfg
        req["cfg_override"] = args.cfg_override
        req["cfg_override_start"] = args.cfg_override_start

    host = args.host.rstrip("/")
    ws_host = host.replace("https://", "wss://").replace("http://", "ws://")
    job_id = str(uuid.uuid4())
    ws_url = f"{ws_host}/ws/{job_id}"

    async def run() -> str | None:
        async with websockets.connect(ws_url, max_size=None) as ws:
            await ws.send(json.dumps(req))
            while True:
                msg = json.loads(await ws.recv())
                kind = msg.get("type")
                if kind == "status":
                    print(f"[status] {msg.get('message','')}", file=sys.stderr)
                elif kind == "progress":
                    print(f"\r[progress] {msg.get('step')}/{msg.get('total')}",
                          end="", file=sys.stderr, flush=True)
                elif kind == "done":
                    print("", file=sys.stderr)
                    print(f"[done] seed={msg.get('seed')} "
                          f"{msg.get('duration_ms',0)/1000:.1f}s", file=sys.stderr)
                    return msg.get("image_url")
                elif kind == "error":
                    raise SystemExit(f"Generation failed: {msg.get('message')}")

    image_url = asyncio.run(run())
    if not image_url:
        raise SystemExit("No image returned.")

    out_path = Path(args.out)
    out_path.write_bytes(_get_bytes(host, image_url))
    print(str(out_path.resolve()))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ideogram_cli",
        description="Headless companion CLI for the Ideogram 4.0 Studio.",
    )
    p.add_argument("--host", default=DEFAULT_HOST,
                   help=f"Studio server base URL (default {DEFAULT_HOST}).")
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("caption", help="Offline: build a structured caption from a prompt-state JSON.")
    c.add_argument("state", help="Path to a prompt-state JSON file.")
    c.add_argument("--constraints", default=None,
                   help="Comma-separated quality-constraint ids "
                        "(sharpness,noise,compression,color,anatomy).")
    c.add_argument("--custom", default="", help="Extra free-text constraint clause.")
    c.set_defaults(func=cmd_caption)

    m = sub.add_parser("magic-prompt", help="Expand plain text into a structured caption (server).")
    m.add_argument("text", help="Plain-text prompt to expand.")
    m.add_argument("--width", type=int, default=1024)
    m.add_argument("--height", type=int, default=1024)
    m.set_defaults(func=cmd_magic_prompt)

    d = sub.add_parser("describe", help="Reverse-prompt an image (server's vision model).")
    d.add_argument("image", help="Path to an image file.")
    d.set_defaults(func=cmd_describe)

    g = sub.add_parser("generate", help="Generate from a caption/text and save a PNG (server).")
    g.add_argument("--caption", required=True,
                   help="Caption JSON / plain text, or a path to a file containing it.")
    g.add_argument("--out", default="ideogram_out.png", help="Output PNG path.")
    g.add_argument("--width", type=int, default=1024)
    g.add_argument("--height", type=int, default=1024)
    g.add_argument("--sampler", default="V4_DEFAULT_20",
                   choices=["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"])
    g.add_argument("--seed", type=int, default=None)
    g.add_argument("--model-variant", dest="model_variant", default="nf4d",
                   choices=["fp8", "nf4", "nf4d", "bf16"])
    g.add_argument("--cfg", type=float, default=None,
                   help="Main CFG; omit to use the sampler preset's schedule.")
    g.add_argument("--cfg-override", dest="cfg_override", type=float, default=2.0)
    g.add_argument("--cfg-override-start", dest="cfg_override_start", type=float, default=0.7)
    g.set_defaults(func=cmd_generate)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
