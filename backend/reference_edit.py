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
import math
import types

import torch
from PIL import Image
from diffusers import FlowMatchEulerDiscreteScheduler
from diffusers.models.modeling_outputs import Transformer2DModelOutput
from diffusers.schedulers.scheduling_flow_match_euler_discrete import (
    FlowMatchEulerDiscreteSchedulerOutput,
)


class ResMultistepFlowScheduler(FlowMatchEulerDiscreteScheduler):
    """`res_multistep` (deterministic, eta=0) for flow matching — a faithful port
    of ComfyUI's ``sample_res_multistep``, the sampler BitPoet's reference
    workflow uses. It's a 2nd-order exponential multistep solver: it reuses the
    previous step's x0 estimate, so at the same step count it's sharper and more
    faithful than the stock Euler step (which our base pipeline uses).

    Convention matches FlowMatchEulerDiscreteScheduler: ``x0 = sample - sigma *
    model_output`` and ``d = model_output`` (so ``to_d = (x - x0)/sigma = d``).
    The first step and the final (sigma_next == 0) step fall back to Euler, as in
    the reference solver."""

    def set_timesteps(self, *args, **kwargs):
        super().set_timesteps(*args, **kwargs)
        self._old_denoised = None

    def step(self, model_output, timestep, sample, s_churn=0.0, s_tmin=0.0,
             s_tmax=float("inf"), s_noise=1.0, generator=None, return_dict=True):
        if self.step_index is None:
            self._init_step_index(timestep)
        i = self.step_index
        sigmas = self.sigmas
        sigma, sigma_next = sigmas[i], sigmas[i + 1]

        sample = sample.to(torch.float32)
        mo = model_output.to(torch.float32)
        denoised = sample - sigma * mo                      # predicted x0

        if getattr(self, "_old_denoised", None) is None or sigma_next == 0:
            prev = sample + (sigma_next - sigma) * mo       # Euler
        else:
            sigma_prev = sigmas[i - 1]
            t, t_next, t_prev = -sigma.log(), -sigma_next.log(), -sigma_prev.log()
            h = t_next - t
            c2 = (t_prev - t) / h                           # eta=0 → t_old == t
            phi1 = torch.expm1(-h) / (-h)
            phi2 = (phi1 - 1.0) / (-h)
            b1 = torch.nan_to_num(phi1 - phi2 / c2, nan=0.0)
            b2 = torch.nan_to_num(phi2 / c2, nan=0.0)
            prev = torch.exp(-h) * sample + h * (b1 * denoised + b2 * self._old_denoised)

        self._old_denoised = denoised
        self._step_index += 1
        prev = prev.to(model_output.dtype)
        if not return_dict:
            return (prev,)
        return FlowMatchEulerDiscreteSchedulerOutput(prev_sample=prev)

# Reference tokens ride along as ordinary image tokens; position-id time+1 and a
# clean timestep are what actually distinguish them (matches the trained LoRA).
OUTPUT_IMAGE_INDICATOR = 2


def extend_intermediate_sigmas(
    sigmas: torch.Tensor, steps: int = 2,
    start_at_sigma: float = 1.0, end_at_sigma: float = 0.98, spacing: str = "linear",
) -> torch.Tensor:
    """Port of ComfyUI's `ExtendIntermediateSigmas` (the LoRA workflow uses it):
    insert `steps - 1` interpolated sigmas into every gap whose upper sigma falls
    in `[end_at_sigma, start_at_sigma]`. With [2, 1, 0.98] that's one extra
    refinement step at the high-noise start, which steadies the early structure
    (anti-"blocked"-collapse). `sigmas` is decreasing (the diffusers convention,
    minus the trailing 0 that the scheduler re-appends)."""
    if start_at_sigma < 0:
        start_at_sigma = float("inf")
    interp = {
        "linear": lambda x: x,
        "cosine": lambda x: torch.sin(x * math.pi / 2),
        "sine": lambda x: 1 - torch.cos(x * math.pi / 2),
    }[spacing]
    frac = interp(torch.linspace(0, 1, steps + 1, device=sigmas.device)[1:-1])
    out: list = []
    for i in range(len(sigmas) - 1):
        cur, nxt = sigmas[i], sigmas[i + 1]
        out.append(cur)
        if end_at_sigma <= float(cur) <= start_at_sigma:
            out.extend((frac * (nxt - cur) + cur).tolist())
    if len(sigmas) > 0:
        out.append(sigmas[-1])
    return torch.tensor(out, dtype=sigmas.dtype, device=sigmas.device)


def extend_sigmas_and_guidance(
    sigmas: torch.Tensor, guidance: list[float], steps: int = 2,
    start_at_sigma: float = 1.0, end_at_sigma: float = 0.98, spacing: str = "linear",
) -> tuple[torch.Tensor, list[float]]:
    """EIS, but extends the per-step guidance schedule in LOCKSTEP with the sigma
    schedule, so res_multistep + EIS work for a non-constant CFG curve (e.g. the
    7→3 generation curve). res_multistep WITHOUT EIS makes sparse prompts collapse
    to the 'image blocked' card — they must be used together."""
    if start_at_sigma < 0:
        start_at_sigma = float("inf")
    interp = {
        "linear": lambda x: x,
        "cosine": lambda x: torch.sin(x * math.pi / 2),
        "sine": lambda x: 1 - torch.cos(x * math.pi / 2),
    }[spacing]
    frac = interp(torch.linspace(0, 1, steps + 1, device=sigmas.device)[1:-1])
    out_s: list[float] = []
    out_g: list[float] = []
    n = len(sigmas)
    for i in range(n - 1):
        cur, nxt = sigmas[i], sigmas[i + 1]
        out_s.append(float(cur))
        out_g.append(float(guidance[i]))
        if end_at_sigma <= float(cur) <= start_at_sigma:
            out_s.extend((frac * (nxt - cur) + cur).tolist())
            gi = float(guidance[i])
            gj = float(guidance[min(i + 1, len(guidance) - 1)])
            out_g.extend((frac * (gj - gi) + gi).tolist())
    out_s.append(float(sigmas[-1]))
    out_g.append(float(guidance[-1]))
    return torch.tensor(out_s, dtype=sigmas.dtype, device=sigmas.device), out_g


@contextlib.contextmanager
def sampler_context(pipe, sampler: str, detail: bool, num_steps: int,
                    mu: float, std: float, guidance: list[float], gen_w: int, gen_h: int):
    """Apply the chosen sampler for a single `pipe.__call__`, yielding the
    EFFECTIVE (num_inference_steps, guidance_schedule) the caller must pass.

    - sampler 'res_multistep' swaps in `ResMultistepFlowScheduler` (sharper).
    - 'detail' (ExtendIntermediateSigmas) is paired with res_multistep: it adds a
      high-noise step that stops sparse prompts collapsing to the "image blocked"
      card. It only applies when res_multistep is on (EIS alone does nothing).
    - 'euler' with detail off is the stock behaviour (no-op)."""
    use_res = sampler == "res_multistep"
    use_eis = bool(detail) and use_res
    if not use_res:
        yield num_steps, list(guidance)
        return

    ext_sigmas = None
    eff_steps, eff_guidance = num_steps, list(guidance)
    if use_eis:
        from diffusers.pipelines.ideogram4 import pipeline_ideogram4 as _pi
        dev = pipe._execution_device
        smu = _pi._resolution_aware_mu(height=gen_h, width=gen_w, base_mu=mu)
        base = _pi._logit_normal_sigmas(num_steps, smu, std=std, device=dev)
        ext_sigmas, eff_guidance = extend_sigmas_and_guidance(
            base, list(guidance), steps=2, start_at_sigma=1.0, end_at_sigma=0.98, spacing="linear"
        )
        eff_steps = len(ext_sigmas)

    orig_scheduler = pipe.scheduler
    pipe.scheduler = ResMultistepFlowScheduler.from_config(orig_scheduler.config)
    try:
        if ext_sigmas is not None:
            with extended_sigma_schedule(ext_sigmas):
                yield eff_steps, eff_guidance
        else:
            yield eff_steps, eff_guidance
    finally:
        pipe.scheduler = orig_scheduler


@contextlib.contextmanager
def extended_sigma_schedule(ext_sigmas: torch.Tensor):
    """Make Ideogram4Pipeline.__call__ use `ext_sigmas` for this run (it computes
    its schedule via the module-level `_logit_normal_sigmas`). The caller passes
    `num_inference_steps=len(ext_sigmas)` so the per-step guidance length matches
    the extended schedule — letting EIS work through the stock denoise loop
    instead of a hand-rolled one."""
    from diffusers.pipelines.ideogram4 import pipeline_ideogram4 as _pi
    orig = _pi._logit_normal_sigmas
    _pi._logit_normal_sigmas = lambda *a, **k: ext_sigmas.to(k.get("device") or ext_sigmas.device)
    try:
        yield
    finally:
        _pi._logit_normal_sigmas = orig


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
