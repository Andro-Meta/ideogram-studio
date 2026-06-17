"""Remap the BitPoet Ideogram4 inpaint LoRA (native `diffusion_model.layers.N.*`
naming, fused QKV) into the diffusers PEFT layout our pipeline can load
(`transformer.layers.N.*`, split to_q/to_k/to_v + to_out.0).

The diffusers Ideogram4 transformer mirrors the native module tree (same
`layers.N`, `attention`, `feed_forward.w1/w2/w3`, `adaln_modulation`); only the
attention projections differ: native fuses Q/K/V into one `attention.qkv` Linear
and calls the output `attention.o`, while diffusers splits them
(`attention.to_q/to_k/to_v`, `attention.to_out.0`).

Splitting a fused-QKV LoRA is exact: for `qkv = (B @ A) x` with B shape
[3H, r], A shape [r, in], the Q/K/V slices are `B[:H] @ A`, `B[H:2H] @ A`,
`B[2H:] @ A` — i.e. A is shared and B is chunked along dim 0.

Usage: python scripts/remap_inpaint_lora.py <in.safetensors> <out.safetensors>
"""
from __future__ import annotations
import sys
from safetensors.torch import load_file, save_file


def remap(in_path: str, out_path: str) -> None:
    sd = load_file(in_path)
    out: dict = {}
    n_q_split = 0
    passthrough = 0
    for key, w in sd.items():
        # Drop the native top prefix; diffusers loads into the `transformer.` module.
        k = key
        if k.startswith("diffusion_model."):
            k = k[len("diffusion_model."):]
        base = f"transformer.{k}"

        if ".attention.qkv." in k:
            # Fused QKV → split. A is shared; B chunks into q/k/v along dim 0.
            kind = "lora_A" if "lora_A" in k else "lora_B" if "lora_B" in k else None
            if kind is None:
                out[base] = w
                continue
            for proj in ("to_q", "to_k", "to_v"):
                tgt = base.replace(".attention.qkv.", f".attention.{proj}.")
                if kind == "lora_A":
                    out[tgt] = w.clone()                         # shared down-proj
                else:
                    H = w.shape[0] // 3
                    idx = {"to_q": 0, "to_k": 1, "to_v": 2}[proj]
                    out[tgt] = w[idx * H:(idx + 1) * H].clone()  # chunked up-proj
            if kind == "lora_B":
                n_q_split += 1
        elif ".attention.o." in k:
            out[base.replace(".attention.o.", ".attention.to_out.0.")] = w
            passthrough += 1
        else:
            # feed_forward.w1/w2/w3, adaln_modulation, etc. — names already match.
            out[base] = w
            passthrough += 1

    save_file(out, out_path)
    print(f"remapped {len(sd)} -> {len(out)} tensors  (qkv blocks split: {n_q_split}, passthrough: {passthrough})")
    print(f"wrote {out_path}")
    # Show a few target keys for sanity.
    for k in sorted(out)[:6]:
        print("  ", k, tuple(out[k].shape))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    remap(sys.argv[1], sys.argv[2])
