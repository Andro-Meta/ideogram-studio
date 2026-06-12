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
