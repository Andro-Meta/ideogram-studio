"""Remap native Ideogram-4 LoRA weights (ai-toolkit / ComfyUI naming) to the
diffusers PEFT layout the running pipeline uses.

Community Ideogram-4 LoRAs are almost all trained with ai-toolkit, which names
layers like the native model: `diffusion_model.layers.N.attention.qkv` (a FUSED
Q/K/V projection) and `attention.o`. The diffusers transformer splits those
(`layers.N.attention.to_q/to_k/to_v`, `to_out.0`). Loaded as-is, diffusers
matches ZERO layers and the LoRA silently does nothing — so we remap on load.

Splitting a fused-QKV LoRA is exact: for `qkv = (B @ A) x` with B shape [3H, r],
the Q/K/V slices are `B[:H] @ A`, `B[H:2H] @ A`, `B[2H:] @ A` — A is shared, B is
chunked along dim 0. The other modules (feed_forward.w1/w2/w3, adaln_modulation)
already share names; only the top prefix changes.
"""
from __future__ import annotations


def adapter_format(state_dict: dict) -> str:
    """Classify the adapter weights: 'lora' (LoRA A/B), 'lokr' (Kronecker),
    'loha' (Hadamard), or 'unknown'. We can only remap+load plain LoRA onto the
    diffusers pipeline; LoKr/LoHa trained on the native fused-QKV model can't be
    split into the diffusers' separate q/k/v projections."""
    keys = " ".join(state_dict.keys())
    if "lokr_w" in keys:
        return "lokr"
    if "hada_w" in keys:
        return "loha"
    if "lora_A" in keys or "lora_B" in keys or "lora_down" in keys or "lora_up" in keys:
        return "lora"
    return "unknown"


def extract_triggers(metadata: dict | None) -> list[str]:
    """Pull trigger / activation words out of a LoRA's safetensors metadata
    (kohya/ai-toolkit `ss_tag_frequency`, Civitai `trainedWords`, etc.) so the UI
    can suggest what to add to the prompt. Best-effort, de-duplicated, capped."""
    if not metadata:
        return []
    import json

    out: list[str] = []
    tf = metadata.get("ss_tag_frequency")
    if tf:
        try:
            d = json.loads(tf) if isinstance(tf, str) else tf
            for sub in (d.values() if isinstance(d, dict) else []):
                if isinstance(sub, dict):
                    out.extend(sub.keys())
        except Exception:
            pass  # malformed metadata — just skip the tag-frequency source
    for key in ("trigger", "ss_trigger_words", "activation_text", "trainedWords",
                "trained_words", "instance_prompt"):
        v = metadata.get(key)
        if isinstance(v, str) and v.strip():
            try:
                parsed = json.loads(v)
                v = parsed if isinstance(parsed, list) else v
            except Exception:
                pass  # not JSON — treat the raw string as the trigger text below
        if isinstance(v, str):
            out.extend(p.strip() for p in v.split(",") if p.strip())
        elif isinstance(v, list):
            out.extend(str(x).strip() for x in v if str(x).strip())

    seen: list[str] = []
    for t in out:
        t = t.strip()
        if t and len(t) <= 60 and t not in seen:
            seen.append(t)
    return seen[:8]


def is_native_ideogram4_lora(state_dict: dict) -> bool:
    """True if the LoRA uses the native (fused-QKV) naming that diffusers can't
    match directly — i.e. it needs remapping."""
    return any(
        k.startswith("diffusion_model.") or ".attention.qkv." in k or ".attention.o." in k
        for k in state_dict
    )


def remap_native_to_diffusers(state_dict: dict) -> dict:
    """Return a new state dict with native keys remapped to the diffusers PEFT
    layout (`transformer.layers.N....lora_A/lora_B.weight`). Non-native keys pass
    through unchanged (already-diffusers LoRAs are returned as-is)."""
    out: dict = {}
    for key, w in state_dict.items():
        k = key
        if k.startswith("diffusion_model."):
            k = k[len("diffusion_model."):]
        base = k if k.startswith("transformer.") else f"transformer.{k}"

        if ".attention.qkv." in k:
            kind = "lora_A" if "lora_A" in k else "lora_B" if "lora_B" in k else None
            if kind is None:
                out[base] = w
                continue
            for idx, proj in enumerate(("to_q", "to_k", "to_v")):
                tgt = base.replace(".attention.qkv.", f".attention.{proj}.")
                if kind == "lora_A":
                    out[tgt] = w.clone()                          # shared down-proj
                else:
                    h = w.shape[0] // 3
                    out[tgt] = w[idx * h:(idx + 1) * h].clone()   # chunked up-proj
        elif ".attention.o." in k:
            out[base.replace(".attention.o.", ".attention.to_out.0.")] = w
        else:
            out[base] = w
    return out
