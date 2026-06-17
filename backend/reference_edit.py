"""Reference-guided in-place editing for Ideogram 4 (the BitPoet inpaint LoRA).

Ideogram 4 is text-to-image only. The BitPoet LoRA adds *reference-latent*
conditioning: the packed transformer sequence becomes
``[text | noisy target | clean reference]``, where the reference is the
VAE-encoded ORIGINAL image. The model learns to reproduce the reference except
where the bbox JSON prompt asks for a change — i.e. precise in-place editing.

We inject this WITHOUT forking the pipeline: a context manager monkeypatches the
(LoRA-loaded) conditional transformer's ``forward`` to append the reference
tokens and strip them from the output, so the entire stock ``pipeline.__call__``
(guidance schedule, scheduler, negative pass) runs unchanged. The reference
tokens are labelled as image tokens (``OUTPUT_IMAGE_INDICATOR``) — the model
tells reference from target purely by the MRoPE time-axis (+1) and a *clean*
per-token timestep, exactly as in BitPoet's ComfyUI core change. The negative
pass uses a separate ``unconditional_transformer`` and is left alone (LoRA +
reference apply to the positive model only).
"""
from __future__ import annotations
import contextlib
import types

import torch
from PIL import Image
from diffusers.models.modeling_outputs import Transformer2DModelOutput

# Reference tokens ride along as ordinary image tokens; position-id time+1 and a
# clean timestep are what actually distinguish them (matches the trained LoRA).
OUTPUT_IMAGE_INDICATOR = 2


@contextlib.contextmanager
def reference_conditioning(pipe, reference_image: Image.Image, gen_w: int, gen_h: int):
    """Within this context, ``pipe.transformer``'s conditional forward packs the
    sequence as ``[text | noisy target | reference]`` using `reference_image`
    encoded at the (gen_w, gen_h) target grid."""
    import inpaint as _inp

    transformer = pipe.transformer
    device = pipe._execution_device

    # Encode the reference at the TARGET grid → packed, bn-normalised tokens
    # (B, N, 128) in the exact space the denoise latents live in.
    ref = reference_image.convert("RGB").resize((gen_w, gen_h), Image.LANCZOS)
    ref_t = pipe.image_processor.preprocess(ref, height=gen_h, width=gen_w).to(device)
    ref_tokens, _grid_h, _grid_w = _inp._encode_to_tokens(pipe, ref_t)
    num_ref = ref_tokens.shape[1]

    orig_forward = transformer.forward

    def patched(self, hidden_states, timestep, encoder_hidden_states,
                position_ids, segment_ids, indicator, return_dict=True, **kw):
        L0 = hidden_states.shape[1]
        B = hidden_states.shape[0]
        max_text = L0 - num_ref                      # text region length
        dev = hidden_states.device

        # Reference reuses the target image grid positions with MRoPE time +1.
        ref_pos = position_ids[:, max_text:].clone()
        ref_pos[..., 0] += 1

        rt = ref_tokens.to(hidden_states.dtype)
        if rt.shape[0] != B:
            rt = rt.expand(B, -1, -1)
        hs = torch.cat([hidden_states, rt], dim=1)
        pos = torch.cat([position_ids, ref_pos.to(position_ids.dtype)], dim=1)
        ind = torch.cat(
            [indicator, torch.full((B, num_ref), OUTPUT_IMAGE_INDICATOR,
                                   dtype=indicator.dtype, device=dev)],
            dim=1,
        )
        # Reference shares the (valid) image segment so it attends with text+target.
        seg_val = segment_ids[:, max_text:max_text + 1]
        seg = torch.cat([segment_ids, seg_val.expand(B, num_ref)], dim=1)
        # encoder_hidden_states must match the packed length; reference is image
        # (llm mask 0 there) so the padding value is irrelevant.
        enc = torch.cat(
            [encoder_hidden_states,
             torch.zeros(B, num_ref, encoder_hidden_states.shape[-1],
                         dtype=encoder_hidden_states.dtype, device=dev)],
            dim=1,
        )
        # Per-token timestep: text+target = t, reference = clean (1.0).
        if timestep.dim() == 1:
            t = timestep.unsqueeze(1).expand(B, hs.shape[1]).clone()
        else:
            t = torch.cat([timestep, timestep.new_ones(B, num_ref)], dim=1)
        t[:, L0:] = 1.0

        out = orig_forward(
            hidden_states=hs, timestep=t, encoder_hidden_states=enc,
            position_ids=pos, segment_ids=seg, indicator=ind, return_dict=False,
        )[0]
        out = out[:, :L0]                            # drop reference tokens
        if return_dict:
            return Transformer2DModelOutput(sample=out)
        return (out,)

    transformer.forward = types.MethodType(patched, transformer)
    try:
        yield
    finally:
        transformer.forward = orig_forward
