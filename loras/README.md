# LoRA adapters

Drop LoRA adapter files (`*.safetensors`) here — for example, ones you download
from [Civitai](https://civitai.com) or Hugging Face that are trained for
Ideogram 4.

They show up automatically in the **LoRA Adapters** panel in the left column of
the Generate page — but only when a **diffusers-based** model is loaded:

| Variant | LoRA support |
|---------|--------------|
| NF4·D   | ✅ yes (recommended on a 24 GB GPU) |
| BF16    | ✅ yes (needs ~22 GB VRAM) |
| NF4     | ❌ no (custom runtime, no adapter hooks) |
| FP8     | ❌ no |

If the panel isn't showing, switch your model to **NF4·D** (Settings → Model)
and reload — `fp8`/`nf4` can't attach adapters.

Adapters are applied **unfused** for inference, so you can stack several and
blend their weights live with the sliders. The actual `.safetensors` files are
git-ignored; only this README is tracked.

## Reference-edit inpaint LoRA (the editor's "Reference" tab)

The **Reference** edit tool uses [`BitPoet/Ideogram4-Inpaint-LoRA`](https://huggingface.co/BitPoet/Ideogram4-Inpaint-LoRA),
an experimental reference-latent edit LoRA. It is **NOT** a normal adapter — it
only works with the reference conditioning, and loading it onto plain generation
corrupts the output. So it lives in an internal dir
(`models/ig4-inpaint/`), **not here** — it never appears in this LoRA panel.
It's trained against the *native* Ideogram-4 layer names (fused QKV), so it must
be remapped to the diffusers layout once:

```bash
# 1. download the step-4000 checkpoint
huggingface-cli download BitPoet/Ideogram4-Inpaint-LoRA \
  IdoInpaint_2_00004000.safetensors --local-dir models/ig4-inpaint

# 2. remap native -> diffusers PEFT (prefix + split fused QKV)
python scripts/remap_inpaint_lora.py \
  models/ig4-inpaint/IdoInpaint_2_00004000.safetensors \
  models/ig4-inpaint/ido-inpaint-diffusers.safetensors
```

The Reference tab loads `models/ig4-inpaint/ido-inpaint-diffusers.safetensors`
on demand (and unloads it after). If the file is missing the tab returns a clear
error with these steps. Author's note: the LoRA is early/experimental — results
can be rough.
